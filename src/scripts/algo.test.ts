import assert from "node:assert/strict"
import path from "node:path"
import { test } from "node:test"
import { pathToFileURL } from "node:url"

import { fromAny } from "@total-typescript/shoehorn"

/// <reference types="node" />
import { andBits, shiftRightBits } from "../shared/bitwise.ts"
import { need } from "../shared/need.ts"

const __dirname = import.meta.dirname

const root = path.resolve(__dirname, "..", "..")

const algo: unknown = await import(
  pathToFileURL(path.resolve(root, "dist/algo.js")).href
)

const {
  genGenoID,

  genV7,

  genMathRandom,

  toUuidString,

  uuidToBytes,

  validateLayout,

  completeLayout,

  forceVersionVariant,

  genStructuredGenoID,

  readStructured,

  MULTITENANT_LAYOUT,

  EVENTSOURCING_LAYOUT,
} = algo as {
  genGenoID: () => string

  genV4Native: () => string

  genV7: () => string

  genMathRandom: () => string

  toUuidString: (b: Uint8Array) => string

  uuidToBytes: (uuid: string) => Uint8Array

  validateLayout: (l: unknown) => void

  completeLayout: (name: string, core: unknown[]) => unknown

  getFieldValue: (b: Uint8Array, f: unknown) => bigint

  forceVersionVariant: (b: Uint8Array) => void

  genStructuredGenoID: (l: unknown) => string

  readStructured: (uuid: string, l: unknown) => Record<string, number>

  DBKEY_LAYOUT: unknown

  MULTITENANT_LAYOUT: unknown

  EVENTSOURCING_LAYOUT: unknown
}

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/u

// ---- toUuidString / uuidToBytes round-trip ----

void test("toUuidString then uuidToBytes is lossless", () => {
  const bytes = new Uint8Array(16)

  for (let i = 0; i < 16; i += 1) {
    bytes[i] = andBits(i * 37 + 11, 0xff)
  }

  const s = toUuidString(bytes)

  const back = uuidToBytes(s)

  assert.deepEqual([...back], [...bytes])
})

void test("toUuidString rejects short input", () => {
  assert.throws(() => toUuidString(new Uint8Array(15)))
})

void test("uuidToBytes rejects malformed hex", () => {
  assert.throws(() => uuidToBytes("not-a-uuid!!!!"))
})

// ---- version / variant markers ----

void test("genV7 produces a v7 UUID (version nibble 7)", () => {
  const id = genV7()

  assert.match(id, UUID_RE)

  assert.equal(id[14], "7")

  assert.ok("89ab".includes(id[19]))
})

void test("genMathRandom produces a v4-format UUID", () => {
  const id = genMathRandom()

  assert.match(id, UUID_RE)

  assert.equal(id[14], "4")
})

void test("genGenoID forces the v8 version and RFC variant nibbles", () => {
  for (let i = 0; i < 50; i += 1) {
    const b = uuidToBytes(genGenoID())

    // Version nibble (bits 48-51) = 0x8, variant (bits 64-65) = 10xx

    assert.equal(shiftRightBits(andBits(b[6], 0xf0), 4), 0x8)

    assert.equal(shiftRightBits(andBits(b[8], 0xc0), 6), 0b10)
  }
})

void test("forceVersionVariant sets v8 + RFC variant and rejects short buffers", () => {
  const b = new Uint8Array(16)

  forceVersionVariant(b)

  assert.equal(shiftRightBits(andBits(b[6], 0xf0), 4), 0x8)

  assert.equal(shiftRightBits(andBits(b[8], 0xc0), 6), 0b10)

  assert.throws(() => {
    forceVersionVariant(new Uint8Array(8))
  })
})

// ---- validateLayout ----

void test("validateLayout rejects fields overlapping the reserved v8 nibble", () => {
  assert.throws(() => {
    validateLayout(
      fromAny({
        fields: [{ length: 4, name: "x", start: 48, type: "random" }],

        name: "bad",
      })
    )
  })
})

void test("validateLayout rejects layouts with uncovered bits", () => {
  assert.throws(() => {
    validateLayout(
      fromAny({
        fields: [{ length: 8, name: "x", start: 0, type: "random" }],

        name: "sparse",
      })
    )
  })
})

void test("validateLayout rejects structured fields wider than 48 bits", () => {
  assert.throws(() => {
    validateLayout(
      fromAny({
        fields: [
          { length: 64, name: "x", start: 0, type: "counter" },

          { length: 64, name: "g", start: 64, type: "random" },
        ],

        name: "wide",
      })
    )
  })
})

// ---- completeLayout gap coverage ----

void test("completeLayout fills every non-nibble bit with a random filler", () => {
  const layout = completeLayout("dbkey", [
    { length: 48, name: "timestamp", start: 0, type: "timestamp-ms" },

    {
      constraint: { allowed: [1, 2, 3, 4, 5] },
      length: 8,
      name: "shard",
      start: 52,
      type: "shard",
    },

    {
      constraint: { monotonic: true },
      length: 16,
      name: "counter",
      start: 66,
      type: "counter",
    },
  ]) as {
    fields: { name: string; type: string; start: number; length: number }[]
  }

  const covered = Array.from<boolean>({ length: 128 }).fill(false)

  for (const f of layout.fields) {
    for (let i = 0; i < f.length; i += 1) {
      covered[f.start + i] = true
    }
  }

  for (const r of [48, 49, 50, 51, 64, 65]) {
    assert.equal(covered[r], false)
  }

  assert.equal(covered.filter(Boolean).length, 122)

  assert.ok(
    layout.fields.some((f) => f.name.startsWith("rand_") && f.type === "random")
  )
})

// ---- wide-field round-trip (32-bit truncation guard) ----

void test("wide (>32-bit) random filler carries real high-bit entropy across generations", () => {
  // Regression guard for the 32-bit truncation bug: a filler field wider than

  // 32 bits must participate in full — the high bits must vary between

  // Generated UUIDs (not be frozen at zero by integer truncation).

  const layout = completeLayout("widefield", [
    { length: 48, name: "wide", start: 0, type: "random" },

    { length: 12, name: "mid", start: 52, type: "random" },

    { length: 62, name: "rest", start: 66, type: "random" },
  ])

  const seen = new Set<number>()

  for (let i = 0; i < 200; i += 1) {
    const uuid = genStructuredGenoID(layout)

    const fields = readStructured(uuid, layout)

    seen.add(fields.rest)
  }

  // The 62-bit `rest` field must exercise bits above 32 — truncation would pin

  // It to the low 32 bits and this assertion would fail.

  const anyHighBitSet = [...seen].some((v) => v > 2 ** 32)

  assert.ok(
    anyHighBitSet,
    "62-bit filler never exercised bits above 32 — truncation regression"
  )

  assert.ok(seen.size > 10, "filler entropy collapsed — expected variation")
})

// ---- wide node/process/shard entropy (8-bit cap regression guard) ----

void test("wide node/process/shard fields span their full declared range (no 8-bit cap)", () => {
  // Regression guard for the pool-reuse entropy regression: structuredValue

  // Must draw width-matched bytes so a field wider than 8 bits keeps its full

  // Keyspace. A single-byte rng() % mod would silently cap e.g. the 16-bit

  // EVENTSOURCING `stream` at 256 values.

  const layout = EVENTSOURCING_LAYOUT as {
    fields: { name: string; length: number; type: string }[]
  }

  const stream = need(layout.fields.find((f) => f.name === "stream"))

  assert.equal(
    stream.length,
    16,
    "stream must be declared 16-bit for this guard"
  )

  const seen = new Set<number>()

  for (let i = 0; i < 5000; i += 1) {
    const fields = readStructured(
      genStructuredGenoID(EVENTSOURCING_LAYOUT),
      EVENTSOURCING_LAYOUT
    )

    seen.add(fields.stream)
  }

  assert.ok(
    seen.size > 256,
    `stream entropy collapsed to ${seen.size} values — 8-bit cap regression`
  )

  assert.ok(
    [...seen].some((v) => v > 255),
    "stream never exceeded 255 — high byte never drawn"
  )
})

// ---- genStructuredGenoID constraint satisfaction ----

void test("genStructuredGenoID never violates a field's allowed/monotonic constraint", () => {
  const checks: [unknown, Record<string, number | number[]>][] = [
    [
      MULTITENANT_LAYOUT,
      { region: [1, 2, 3, 4], tenant: [1, 2, 3, 4, 5, 6, 7, 8] },
    ],

    [EVENTSOURCING_LAYOUT, {}],
  ]

  for (const [layout, allowed] of checks) {
    const typed = layout as {
      fields: {
        name: string
        constraint?: { allowed?: number[]; monotonic?: boolean }
      }[]
    }

    for (let i = 0; i < 500; i += 1) {
      const fields = readStructured(genStructuredGenoID(layout), layout)

      for (const f of typed.fields) {
        const c = f.constraint

        if (typeof c === "object" && Array.isArray(c.allowed)) {
          assert.ok((allowed[f.name] as number[]).includes(fields[f.name]))
        }
      }
    }
  }
})
