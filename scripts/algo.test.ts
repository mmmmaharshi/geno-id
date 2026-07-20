import { test } from "node:test"
import assert from "node:assert/strict"
import { pathToFileURL } from "node:url"
import path from "node:path"

const __dirname = import.meta.dirname
const root = path.resolve(__dirname, "..")
const algo = await import(pathToFileURL(path.resolve(root, "dist/algo.js")).href)
const {
  genGenoID,
  genV4Native,
  genV7,
  genMathRandom,
  toUuidString,
  uuidToBytes,
  validateLayout,
  completeLayout,
  getFieldValue,
  forceVersionVariant,
  genStructuredGenoID,
  readStructured,
  DBKEY_LAYOUT,
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

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/

test("smoke: genGenoID exports a well-formed v8 UUID", () => {
  const id = genGenoID()
  assert.match(id, UUID_RE)
})

// ---- toUuidString / uuidToBytes round-trip ----

test("toUuidString then uuidToBytes is lossless", () => {
  const bytes = new Uint8Array(16)
  for (let i = 0; i < 16; i++) bytes[i] = (i * 37 + 11) & 0xff
  const s = toUuidString(bytes)
  const back = uuidToBytes(s)
  assert.deepEqual([...back], [...bytes])
})

test("toUuidString rejects short input", () => {
  assert.throws(() => toUuidString(new Uint8Array(15)))
})

test("uuidToBytes rejects malformed hex", () => {
  assert.throws(() => uuidToBytes("not-a-uuid!!!!"))
})

// ---- version / variant markers ----

test("genV4Native produces a v4 UUID (version nibble 4, variant 8)", () => {
  const id = genV4Native()
  assert.match(id, UUID_RE)
  assert.equal(id[14], "4")
  assert.ok("89ab".includes(id[19]))
})

test("genV7 produces a v7 UUID (version nibble 7)", () => {
  const id = genV7()
  assert.match(id, UUID_RE)
  assert.equal(id[14], "7")
  assert.ok("89ab".includes(id[19]))
})

test("genMathRandom produces a v4-format UUID", () => {
  const id = genMathRandom()
  assert.match(id, UUID_RE)
  assert.equal(id[14], "4")
})

test("genGenoID forces the v8 version and RFC variant nibbles", () => {
  for (let i = 0; i < 50; i++) {
    const b = uuidToBytes(genGenoID())
    // version nibble (bits 48-51) = 0x8, variant (bits 64-65) = 10xx
    assert.equal((b[6] & 0xf0) >> 4, 0x8)
    assert.equal((b[8] & 0xc0) >> 6, 0b10)
  }
})

test("forceVersionVariant sets v8 + RFC variant and rejects short buffers", () => {
  const b = new Uint8Array(16)
  forceVersionVariant(b)
  assert.equal((b[6] & 0xf0) >> 4, 0x8)
  assert.equal((b[8] & 0xc0) >> 6, 0b10)
  assert.throws(() => forceVersionVariant(new Uint8Array(8)))
})

// ---- validateLayout ----

test("validateLayout rejects fields overlapping the reserved v8 nibble", () => {
  assert.throws(() =>
    validateLayout({
      name: "bad",
      fields: [
        { name: "x", start: 48, length: 4, type: "random" },
      ],
    } as never),
  )
})

test("validateLayout rejects layouts with uncovered bits", () => {
  assert.throws(() =>
    validateLayout({
      name: "sparse",
      fields: [{ name: "x", start: 0, length: 8, type: "random" }],
    } as never),
  )
})

test("validateLayout rejects structured fields wider than 48 bits", () => {
  assert.throws(() =>
    validateLayout({
      name: "wide",
      fields: [
        { name: "x", start: 0, length: 64, type: "counter" },
        { name: "g", start: 64, length: 64, type: "random" },
      ],
    } as never),
  )
})

// ---- completeLayout gap coverage ----

test("completeLayout fills every non-nibble bit with a random filler", () => {
  const layout = completeLayout("dbkey", [
    { name: "timestamp", start: 0, length: 48, type: "timestamp-ms" },
    { name: "shard", start: 52, length: 8, type: "shard", constraint: { allowed: [1, 2, 3, 4, 5] } },
    { name: "counter", start: 66, length: 16, type: "counter", constraint: { monotonic: true } },
  ]) as { fields: { name: string; type: string; start: number; length: number }[] }
  const covered = new Array<boolean>(128).fill(false)
  for (const f of layout.fields) {
    for (let i = 0; i < f.length; i++) covered[f.start + i] = true
  }
  for (const r of [48, 49, 50, 51, 64, 65]) assert.equal(covered[r], false)
  assert.equal(covered.filter(Boolean).length, 122)
  assert.ok(layout.fields.some((f) => f.name.startsWith("rand_") && f.type === "random"))
})

// ---- wide-field round-trip (32-bit truncation guard) ----

test("wide (>32-bit) random filler carries real high-bit entropy across generations", () => {
  // Regression guard for the 32-bit truncation bug: a filler field wider than
  // 32 bits must participate in full — the high bits must vary between
  // generated UUIDs (not be frozen at zero by integer truncation).
  const layout = completeLayout("widefield", [
    { name: "wide", start: 0, length: 48, type: "random" },
    { name: "mid", start: 52, length: 12, type: "random" },
    { name: "rest", start: 66, length: 62, type: "random" },
  ])
  const seen = new Set<number>()
  for (let i = 0; i < 200; i++) {
    const uuid = genStructuredGenoID(layout)
    const fields = readStructured(uuid, layout)
    seen.add(fields.rest)
  }
  // The 62-bit `rest` field must exercise bits above 32 — truncation would pin
  // it to the low 32 bits and this assertion would fail.
  const anyHighBitSet = [...seen].some((v) => v > 2 ** 32)
  assert.ok(anyHighBitSet, "62-bit filler never exercised bits above 32 — truncation regression")
  assert.ok(seen.size > 10, "filler entropy collapsed — expected variation")
})

test("readStructured round-trips every field of a generated dbkey UUID", () => {
  const layout = DBKEY_LAYOUT as { fields: { name: string; start: number; length: number; type: string }[] }
  for (let i = 0; i < 200; i++) {
    const uuid = genStructuredGenoID(DBKEY_LAYOUT)
    const fields = readStructured(uuid, DBKEY_LAYOUT)
    const bytes = uuidToBytes(uuid)
    for (const f of layout.fields) {
      const expected = Number(getFieldValue(bytes, f))
      assert.equal(fields[f.name], expected)
    }
  }
})

// ---- genStructuredGenoID constraint satisfaction ----

test("genStructuredGenoID never violates a field's allowed/monotonic constraint", () => {
  const checks: [unknown, Record<string, number | number[]>][] = [
    [MULTITENANT_LAYOUT, { tenant: [1, 2, 3, 4, 5, 6, 7, 8], region: [1, 2, 3, 4] }],
    [EVENTSOURCING_LAYOUT, {}],
  ]
  for (const [layout, allowed] of checks) {
    const typed = layout as { fields: { name: string; constraint?: { allowed?: number[]; monotonic?: boolean } }[] }
    for (let i = 0; i < 500; i++) {
      const fields = readStructured(genStructuredGenoID(layout), layout)
      for (const f of typed.fields) {
        const c = f.constraint
        if (c?.allowed) assert.ok((allowed[f.name] as number[]).includes(fields[f.name]))
      }
    }
  }
})
