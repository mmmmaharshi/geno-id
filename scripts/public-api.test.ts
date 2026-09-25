import { test } from "node:test"
import assert from "node:assert/strict"
import { pathToFileURL } from "node:url"
import path from "node:path"

import {
  genGenoID,
  genStructuredGenoID,
  completeLayout,
  readStructured,
  toUuidString,
  uuidToBytes,
  compileLayout,
  compileDatabaseLayout,
  getStructuredGenerationMode,
  configureRandom,
  DBKEY_LAYOUT,
  MULTITENANT_LAYOUT,
  EVENTSOURCING_LAYOUT,
} from "../dist/index.js"

import type {
  Layout,
  Field,
  FieldConstraint,
  FieldType,
  CompiledLayout,
  LayoutCompilerInput,
} from "../dist/index.js"

const __dirname = import.meta.dirname
const root = path.resolve(__dirname, "..")

// Independent codec (does NOT use the package) so expected values are derived
// from an external source of truth, not recomputed by the code under test.
function bytesToUuid(b: Uint8Array): string {
  const h = [...b].map((x) => x.toString(16).padStart(2, "0")).join("")
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20, 32)}`
}

const UUID_V8_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-8[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/

test("genGenoID emits a valid RFC 9562 v8 UUID", () => {
  const uuid = genGenoID()
  assert.match(uuid, UUID_V8_RE)
  const b = uuidToBytes(uuid)
  assert.equal((b[6] >> 4) & 0xf, 8, "version nibble must be 8")
  assert.equal((b[8] >> 6) & 0b10, 0b10, "variant bits must be 10xx")
})

test("genGenoID produces no collisions across 100k samples", () => {
  const n = 100_000
  const seen = new Set<string>()
  for (let i = 0; i < n; i++) seen.add(genGenoID())
  assert.equal(seen.size, n)
})

test("completeLayout covers all 128 bits and leaves reserved v8 nibbles as gaps", () => {
  const layout: Layout = completeLayout("dbkey", [
    { name: "timestamp", start: 0, length: 48, type: "timestamp-ms" },
    { name: "shard", start: 52, length: 8, type: "shard", constraint: { allowed: [1, 2, 3, 4, 5] } },
    { name: "counter", start: 66, length: 16, type: "counter", constraint: { monotonic: true } },
  ])
  const covered = new Array<boolean>(128).fill(false)
  for (const f of layout.fields) {
    for (let i = 0; i < f.length; i++) covered[f.start + i] = true
  }
  // 128 bits minus the 6 reserved v8 nibble bits (48-51, 64-65) are covered.
  assert.equal(covered.filter(Boolean).length, 122)
  for (const r of [48, 49, 50, 51, 64, 65]) assert.equal(covered[r], false)
  assert.ok(layout.fields.some((f) => f.type === "random"))
})

test("genStructuredGenoID is v8 and round-trips through readStructured", () => {
  const layout: Layout = completeLayout("dbkey", [
    { name: "timestamp", start: 0, length: 48, type: "timestamp-ms" },
    { name: "shard", start: 52, length: 8, type: "shard", constraint: { allowed: [1, 2, 3, 4, 5] } },
    { name: "counter", start: 66, length: 16, type: "counter", constraint: { monotonic: true } },
  ])
  const uuid = genStructuredGenoID(layout)
  assert.match(uuid, UUID_V8_RE)
  const got = readStructured(uuid, layout)
  assert.deepEqual(
    Object.keys(got).toSorted(),
    layout.fields.map((f) => f.name).toSorted(),
  )
  assert.ok([1, 2, 3, 4, 5].includes(got.shard))
  assert.ok(Number.isInteger(got.counter) && got.counter >= 0)
})

test("readStructured reads full >32-bit fields (truncation regression guard)", () => {
  const layout: Layout = completeLayout("wide", [
    { name: "big", start: 0, length: 40, type: "random" },
  ])
  const bytes = new Uint8Array(16)
  bytes[0] = 0x01
  bytes[1] = 0x00
  bytes[2] = 0xab
  bytes[3] = 0xcd
  bytes[4] = 0xef
  const got = readStructured(bytesToUuid(bytes), layout)
  // 0x0100ABCDEF = 4306226671; a 32-bit truncation would yield 0x00ABCDEF.
  assert.equal(got.big, 0x0100abcdef)
})

test("uuidToBytes <-> toUuidString is an identity round-trip", () => {
  const uuid = "1a2b3c4d-0000-8000-8000-000000000000"
  const back = toUuidString(uuidToBytes(uuid))
  assert.equal(back, uuid)
  const b = uuidToBytes(uuid)
  assert.equal(b[0], 0x1a)
  assert.equal(b.length, 16)
})

test("public type aliases resolve for the layout API", () => {
  const ft: FieldType = "counter"
  const fc: FieldConstraint = { allowed: [1] }
  const field: Field = { name: "x", start: 0, length: 48, type: ft, constraint: fc }
  const layout: Layout = completeLayout("alias", [field])
  assert.equal(layout.name, "alias")
  assert.equal(layout.fields[0].name, "x")
  // exercise the alias types end-to-end through the public generators
  const uuid = genStructuredGenoID(layout)
  assert.match(uuid, UUID_V8_RE)
})

test("compileLayout produces a CompiledLayout shape and its source round-trips through genStructuredGenoID", () => {
  const cl: CompiledLayout = compileLayout(DBKEY_LAYOUT)
  assert.ok(typeof cl.source === "string" && cl.source.length > 0)
  assert.ok(typeof cl.fn === "function")
  // genStructuredGenoID uses the compiled path when Web Crypto is available.
  // Verify it produces valid UUIDs that readStructured can decode.
  for (let i = 0; i < 5; i++) {
    const uuid = genStructuredGenoID(DBKEY_LAYOUT)
    assert.match(uuid, UUID_V8_RE)
    const got = readStructured(uuid, DBKEY_LAYOUT)
    assert.ok("shard" in got && "counter" in got && "timestamp" in got)
  }
})

test("compileDatabaseLayout places locality fields first for offset-free schemas", () => {
  const input: LayoutCompilerInput = {
    schema: {
      name: "dbkey",
      fields: [
        { name: "timestamp", length: 48, type: "timestamp-ms" },
        { name: "shard", length: 8, type: "shard", constraint: { allowed: [1, 2, 3, 4, 5] } },
        { name: "counter", length: 16, type: "counter", constraint: { monotonic: true } },
      ],
    },
    workload: {
      readWeight: 0.25,
      writeWeight: 0.75,
      fields: [
        { name: "shard", role: "partition" },
        { name: "counter", role: "lookup" },
      ],
    },
  }
  const result = compileDatabaseLayout(input)
  const byName = new Map(result.layout.fields.map((field) => [field.name, field]))

  assert.deepEqual(compileDatabaseLayout(input), result)
  assert.equal(byName.get("shard")?.start, 0)
  assert.equal(byName.get("counter")?.start, 8)
  const timestamp = byName.get("timestamp")
  if (!timestamp) throw new Error("timestamp field missing from compiled layout")
  assert.equal(timestamp.start % 8, 0)
  assert.ok(timestamp.start > 8)
})

test("compileDatabaseLayout keeps explicit offsets hard while placing remaining fields", () => {
  const result = compileDatabaseLayout({
    schema: {
      name: "mixed",
      fields: [
        { name: "tenant", start: 0, length: 8, type: "shard" },
        { name: "lookup", length: 8, type: "process" },
      ],
    },
    workload: {
      readWeight: 1,
      writeWeight: 1,
      fields: [
        { name: "tenant", role: "partition" },
        { name: "lookup", role: "lookup" },
      ],
    },
  })
  const byName = new Map(result.layout.fields.map((field) => [field.name, field]))
  assert.equal(byName.get("tenant")?.start, 0)
  assert.equal(byName.get("lookup")?.start, 8)
})

test("compileDatabaseLayout preserves wide fields and RFC 9562 markers", () => {
  const allowed = [0x100000000, 0x100000001]
  const result = compileDatabaseLayout({
    schema: {
      name: "wide",
      fields: [{ name: "trace", length: 40, type: "process", constraint: { allowed } }],
    },
    workload: {
      readWeight: 1,
      writeWeight: 1,
      fields: [{ name: "trace", role: "lookup" }],
    },
  })
  for (let index = 0; index < 16; index++) {
    const uuid = genStructuredGenoID(result)
    const values = readStructured(uuid, result.layout)
    assert.match(uuid, UUID_V8_RE)
    assert.ok(allowed.includes(values.trace))
  }
})

test("compileDatabaseLayout rejects an empty workload field list", () => {
  const input = {
    schema: { name: "key", fields: [{ name: "shard", start: 0, length: 8, type: "shard" }] },
    workload: { readWeight: 1, writeWeight: 1, fields: [] },
  } as unknown as LayoutCompilerInput

  assert.throws(
    () => compileDatabaseLayout(input),
    (error: unknown) => {
      assert.ok(error instanceof Error)
      assert.equal((error as Error & { code?: string }).code, "invalid-workload")
      return true
    },
  )
})

test("compileDatabaseLayout returns a named, deterministic contract", () => {
  const input: LayoutCompilerInput = {
    schema: {
      name: "dbkey",
      fields: [
        { name: "timestamp", start: 0, length: 48, type: "timestamp-ms" },
        {
          name: "shard",
          start: 52,
          length: 8,
          type: "shard",
          constraint: { allowed: [1, 2, 3, 4, 5] },
        },
        { name: "counter", start: 66, length: 16, type: "counter", constraint: { monotonic: true } },
      ],
    },
    workload: {
      readWeight: 0.25,
      writeWeight: 0.75,
      fields: [
        { name: "shard", role: "partition", selectivity: 0.8 },
        { name: "counter", role: "lookup", readWeight: 1, writeWeight: 1 },
      ],
    },
  }
  const originalFields = JSON.stringify(input.schema.fields)
  const result = compileDatabaseLayout(input)
  const repeated = compileDatabaseLayout(input)

  assert.deepEqual(repeated, result)

  assert.equal(result.layout.name, "dbkey")
  assert.equal(result.generationPlan.name, "compiled-direct-v8")
  assert.equal(result.generationPlan.entropySource, "web-crypto")
  assert.equal(result.generationPlan.poolMode, "direct")
  assert.equal(result.generationPlan.repairMode, "canonical")
  assert.deepEqual(result.repairPolicy, {
    name: "canonical-v1",
    allowedSet: "index-modulo",
    range: "clamp",
    monotonic: "stateful",
    fixed: "deterministic",
  })
  assert.deepEqual(result.generationPlan.fieldSemantics.shard, {
    type: "shard",
    constraints: ["allowed-set"],
  })
  assert.deepEqual(result.generationPlan.fieldSemantics.counter, {
    type: "counter",
    constraints: ["monotonic"],
  })
  assert.equal(result.costReport.objective, "hard-constraints-first")
  assert.equal(result.costReport.structuredBits, 72)
  assert.equal(result.costReport.randomBits, 50)
  assert.equal(result.costReport.constrainedFields, 2)
  assert.equal(result.costReport.localityFields, 1)
  assert.equal(result.costReport.lookupFields, 1)
  assert.equal(JSON.stringify(input.schema.fields), originalFields)
})

test("compiled database layouts remain consumable through the structured API", () => {
  const result = compileDatabaseLayout({
    schema: {
      name: "dbkey",
      fields: [{ name: "shard", start: 0, length: 8, type: "shard", constraint: { allowed: [1, 2, 3, 4, 5] } }],
    },
    workload: {
      readWeight: 1,
      writeWeight: 1,
      fields: [{ name: "shard", role: "partition" }],
    },
  })
  const uuid = genStructuredGenoID(result)
  const values = readStructured(uuid, result.layout)
  assert.match(uuid, UUID_V8_RE)
  assert.ok("shard" in values && [1, 2, 3, 4, 5].includes(values.shard))
})

test("compileDatabaseLayout rejects reserved schema bits with stable field errors", () => {
  const input: LayoutCompilerInput = {
    schema: { name: "key", fields: [{ name: "version", start: 48, length: 1, type: "fixed", value: 1 }] },
    workload: {
      readWeight: 1,
      writeWeight: 1,
      fields: [{ name: "version", role: "lookup" }],
    },
  }

  assert.throws(
    () => compileDatabaseLayout(input),
    (error: unknown) => {
      assert.ok(error instanceof Error)
      assert.equal((error as Error & { code?: string }).code, "invalid-schema")
      assert.equal((error as Error & { field?: string }).field, "schema.fields[0]")
      return true
    },
  )
})

test("compileDatabaseLayout rejects unknown workload fields with stable field errors", () => {
  const input: LayoutCompilerInput = {
    schema: { name: "key", fields: [{ name: "shard", start: 0, length: 8, type: "shard" }] },
    workload: {
      readWeight: 1,
      writeWeight: 1,
      fields: [{ name: "missing", role: "partition" }],
    },
  }

  assert.throws(
    () => compileDatabaseLayout(input),
    (error: unknown) => {
      assert.ok(error instanceof Error)
      assert.equal((error as Error & { code?: string }).code, "unknown-workload-field")
      assert.equal((error as Error & { field?: string }).field, "missing")
      return true
    },
  )
})

test("compileDatabaseLayout rejects overlapping schema fields with stable errors", () => {
  const input: LayoutCompilerInput = {
    schema: {
      name: "key",
      fields: [
        { name: "first", start: 0, length: 8, type: "shard" },
        { name: "second", start: 4, length: 8, type: "shard" },
      ],
    },
    workload: {
      readWeight: 1,
      writeWeight: 1,
      fields: [{ name: "first", role: "partition" }],
    },
  }

  assert.throws(
    () => compileDatabaseLayout(input),
    (error: unknown) => {
      assert.ok(error instanceof Error)
      assert.equal((error as Error & { code?: string }).code, "invalid-schema")
      assert.equal((error as Error & { field?: string }).field, "schema.fields[1]")
      return true
    },
  )
})

test("compileDatabaseLayout requires workload weights", () => {
  const input = {
    schema: { name: "key", fields: [{ name: "shard", start: 0, length: 8, type: "shard" }] },
    workload: {
      writeWeight: 1,
      fields: [{ name: "shard", role: "partition" }],
    },
  } as unknown as LayoutCompilerInput

  assert.throws(
    () => compileDatabaseLayout(input),
    (error: unknown) => {
      assert.ok(error instanceof Error)
      assert.equal((error as Error & { code?: string }).code, "invalid-workload")
      assert.equal((error as Error & { field?: string }).field, "workload.readWeight")
      return true
    },
  )
})

test("getStructuredGenerationMode names compiled and injected paths", () => {
  assert.equal(getStructuredGenerationMode(), "compiled-direct-v8")
  configureRandom((buf) => buf.fill(7))
  try {
    assert.equal(getStructuredGenerationMode(), "single-parent-pooled")
  } finally {
    configureRandom(null)
  }
  assert.equal(getStructuredGenerationMode(), "compiled-direct-v8")
})

test("named generation modes preserve public field semantics", () => {
  const result = compileDatabaseLayout({
    schema: {
      name: "modes",
      fields: [
        { name: "marker", length: 8, type: "fixed", value: 5 },
        { name: "shard", length: 8, type: "shard", constraint: { allowed: [1, 2, 3] } },
        { name: "counter", length: 16, type: "counter", constraint: { monotonic: true } },
        { name: "trace", length: 40, type: "process" },
      ],
    },
    workload: {
      readWeight: 1,
      writeWeight: 1,
      fields: [
        { name: "marker", role: "lookup" },
        { name: "shard", role: "partition" },
        { name: "counter", role: "lookup" },
        { name: "trace", role: "cluster" },
      ],
    },
  })
  const checkMode = (injected: boolean): void => {
    configureRandom(injected ? (buf) => buf.fill(7) : null)
    try {
      for (let index = 0; index < 32; index++) {
        const values = readStructured(genStructuredGenoID(result), result.layout)
        assert.equal(values.marker, 5)
        assert.ok([1, 2, 3].includes(values.shard))
        assert.ok(Number.isInteger(values.counter))
        assert.ok(Number.isInteger(values.trace))
      }
    } finally {
      configureRandom(null)
    }
  }
  checkMode(false)
  checkMode(true)
})

test("DBKEY_LAYOUT round-trips through genStructuredGenoID and readStructured", () => {
  const uuid = genStructuredGenoID(DBKEY_LAYOUT)
  assert.match(uuid, UUID_V8_RE)
  const got = readStructured(uuid, DBKEY_LAYOUT)
  assert.ok("timestamp" in got && "shard" in got && "counter" in got)
  assert.ok([1, 2, 3, 4, 5].includes(got.shard))
  assert.ok(Number.isInteger(got.counter) && got.counter >= 0)
})

test("MULTITENANT_LAYOUT round-trips through genStructuredGenoID and readStructured", () => {
  const uuid = genStructuredGenoID(MULTITENANT_LAYOUT)
  assert.match(uuid, UUID_V8_RE)
  const got = readStructured(uuid, MULTITENANT_LAYOUT)
  assert.ok("tenant" in got && "region" in got)
  assert.ok([1, 2, 3, 4, 5, 6, 7, 8].includes(got.tenant))
  assert.ok([1, 2, 3, 4].includes(got.region))
})

test("EVENTSOURCING_LAYOUT round-trips through genStructuredGenoID and readStructured", () => {
  const uuid = genStructuredGenoID(EVENTSOURCING_LAYOUT)
  assert.match(uuid, UUID_V8_RE)
  const got = readStructured(uuid, EVENTSOURCING_LAYOUT)
  assert.ok("stream" in got && "seq" in got)
  assert.ok(Number.isInteger(got.seq) && got.seq >= 0)
  assert.ok(Number.isInteger(got.stream) && got.stream >= 0)
})

test("public barrel does NOT leak research/internal symbols", async () => {
  const pkg = await import(pathToFileURL(path.resolve(root, "dist/index.js")).href)
  const leaked = [
    "uuidToRandomBits",
    "genV4Native",
    "genV7",
    "genMathRandom",
    "genHashUUID",
    "copyField",
    "forceVersionVariant",
    "composeStructured",
    "repairConstraints",
    "validateLayout",
    "getFieldValue",
    "genStructuredParent",
  ]
  for (const name of leaked) {
    assert.equal(
      (pkg as Record<string, unknown>)[name],
      undefined,
      `public barrel must not export ${name}`,
    )
  }
})
