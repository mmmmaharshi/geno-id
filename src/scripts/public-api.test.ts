import { test } from "node:test"
import assert from "node:assert/strict"
import { fromAny } from "@total-typescript/shoehorn"
import { pathToFileURL } from "node:url"
import path from "node:path"

import {
  genGenoID,
  genStructuredGenoID,
  completeLayout,
  readStructured,
  uuidToBytes,
  compileDatabaseLayout,
  getStructuredGenerationMode,
  configureRandom,
  DBKEY_LAYOUT,
  MULTITENANT_LAYOUT,
  EVENTSOURCING_LAYOUT,
} from "../../dist/index.js"

import type {
  Layout,
  LayoutCompilerInput,
} from "../../dist/index.js"

const __dirname = import.meta.dirname
const root = path.resolve(__dirname, "..", "..")

// Independent codec (does NOT use the package) so expected values are derived
// from an external source of truth, not recomputed by the code under test.
function bytesToUuid(b: Uint8Array): string {
  const h = [...b].map((x) => x.toString(16).padStart(2, "0")).join("")
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20, 32)}`
}

const UUID_V8_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-8[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u

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
  for (let i = 0; i < n; i += 1) {seen.add(genGenoID())}
  assert.equal(seen.size, n)
})

test("completeLayout covers all 128 bits and leaves reserved v8 nibbles as gaps", () => {
  const layout: Layout = completeLayout("dbkey", [
    { length: 48, name: "timestamp", start: 0, type: "timestamp-ms" },
    { constraint: { allowed: [1, 2, 3, 4, 5] }, length: 8, name: "shard", start: 52, type: "shard" },
    { constraint: { monotonic: true }, length: 16, name: "counter", start: 66, type: "counter" },
  ])
  const covered = Array.from<boolean>({ length: 128 }).fill(false)
  for (const f of layout.fields) {
    for (let i = 0; i < f.length; i += 1) {covered[f.start + i] = true}
  }
  // 128 bits minus the 6 reserved v8 nibble bits (48-51, 64-65) are covered.
  assert.equal(covered.filter(Boolean).length, 122)
  for (const r of [48, 49, 50, 51, 64, 65]) {assert.equal(covered[r], false)}
  assert.ok(layout.fields.some((f) => f.type === "random"))
})

test("genStructuredGenoID is v8 and round-trips through readStructured", () => {
  const layout: Layout = completeLayout("dbkey", [
    { length: 48, name: "timestamp", start: 0, type: "timestamp-ms" },
    { constraint: { allowed: [1, 2, 3, 4, 5] }, length: 8, name: "shard", start: 52, type: "shard" },
    { constraint: { monotonic: true }, length: 16, name: "counter", start: 66, type: "counter" },
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
    { length: 40, name: "big", start: 0, type: "random" },
  ])
  const bytes = new Uint8Array(16)
  bytes[0] = 0x01
  bytes[1] = 0x00
  bytes[2] = 0xab
  bytes[3] = 0xcd
  bytes[4] = 0xef
  const got = readStructured(bytesToUuid(bytes), layout)
  // 0x0100ABCDEF = 4306226671; a 32-bit truncation would yield 0x00ABCDEF.
  assert.equal(got.big, 0x01_00_ab_cd_ef)
})

test("compileDatabaseLayout places locality fields first for offset-free schemas", () => {
  const input: LayoutCompilerInput = {
    schema: {
      fields: [
        { length: 48, name: "timestamp", type: "timestamp-ms" },
        { constraint: { allowed: [1, 2, 3, 4, 5] }, length: 8, name: "shard", type: "shard" },
        { constraint: { monotonic: true }, length: 16, name: "counter", type: "counter" },
      ],
      name: "dbkey",
    },
    workload: {
      fields: [
        { name: "shard", role: "partition" },
        { name: "counter", role: "lookup" },
      ],
      readWeight: 0.25,
      writeWeight: 0.75,
    },
  }
  const result = compileDatabaseLayout(input)
  const byName = new Map(result.layout.fields.map((field) => [field.name, field]))

  assert.deepEqual(compileDatabaseLayout(input), result)
  assert.equal(byName.get("shard")?.start, 0)
  assert.equal(byName.get("counter")?.start, 8)
  const timestamp = byName.get("timestamp")
  if (!timestamp) {throw new Error("timestamp field missing from compiled layout")}
  assert.equal(timestamp.start % 8, 0)
  assert.ok(timestamp.start > 8)
})

test("compileDatabaseLayout keeps explicit offsets hard while placing remaining fields", () => {
  const result = compileDatabaseLayout({
    schema: {
      fields: [
        { length: 8, name: "tenant", start: 0, type: "shard" },
        { length: 8, name: "lookup", type: "process" },
      ],
      name: "mixed",
    },
    workload: {
      fields: [
        { name: "tenant", role: "partition" },
        { name: "lookup", role: "lookup" },
      ],
      readWeight: 1,
      writeWeight: 1,
    },
  })
  const byName = new Map(result.layout.fields.map((field) => [field.name, field]))
  assert.equal(byName.get("tenant")?.start, 0)
  assert.equal(byName.get("lookup")?.start, 8)
})

test("compileDatabaseLayout preserves wide fields and RFC 9562 markers", () => {
  const allowed = [0x1_00_00_00_00, 0x1_00_00_00_01]
  const result = compileDatabaseLayout({
    schema: {
      fields: [{ constraint: { allowed }, length: 40, name: "trace", type: "process" }],
      name: "wide",
    },
    workload: {
      fields: [{ name: "trace", role: "lookup" }],
      readWeight: 1,
      writeWeight: 1,
    },
  })
  for (let index = 0; index < 16; index += 1) {
    const uuid = genStructuredGenoID(result)
    const values = readStructured(uuid, result.layout)
    assert.match(uuid, UUID_V8_RE)
    assert.ok(allowed.includes(values.trace))
  }
})

test("compileDatabaseLayout rejects an empty workload field list", () => {
  const input = fromAny<LayoutCompilerInput, unknown>({
    schema: { fields: [{ length: 8, name: "shard", start: 0, type: "shard" }], name: "key" },
    workload: { fields: [], readWeight: 1, writeWeight: 1 },
  })

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
      fields: [
        { length: 48, name: "timestamp", start: 0, type: "timestamp-ms" },
        {
          constraint: { allowed: [1, 2, 3, 4, 5] },
          length: 8,
          name: "shard",
          start: 52,
          type: "shard",
        },
        { constraint: { monotonic: true }, length: 16, name: "counter", start: 66, type: "counter" },
      ],
      name: "dbkey",
    },
    workload: {
      fields: [
        { name: "shard", role: "partition", selectivity: 0.8 },
        { name: "counter", readWeight: 1, role: "lookup", writeWeight: 1 },
      ],
      readWeight: 0.25,
      writeWeight: 0.75,
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
    allowedSet: "index-modulo",
    fixed: "deterministic",
    monotonic: "stateful",
    name: "canonical-v1",
    range: "clamp",
  })
  assert.deepEqual(result.generationPlan.fieldSemantics.shard, {
    constraints: ["allowed-set"],
    type: "shard",
  })
  assert.deepEqual(result.generationPlan.fieldSemantics.counter, {
    constraints: ["monotonic"],
    type: "counter",
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
      fields: [{ constraint: { allowed: [1, 2, 3, 4, 5] }, length: 8, name: "shard", start: 0, type: "shard" }],
      name: "shardonly",
    },
    workload: {
      fields: [{ name: "shard", role: "partition" }],
      readWeight: 1,
      writeWeight: 1,
    },
  })
  const uuid = genStructuredGenoID(result)
  const values = readStructured(uuid, result.layout)
  assert.match(uuid, UUID_V8_RE)
  assert.ok("shard" in values && [1, 2, 3, 4, 5].includes(values.shard))
})

test("compileDatabaseLayout rejects reserved schema bits with stable field errors", () => {
  const input: LayoutCompilerInput = {
    schema: { fields: [{ length: 1, name: "version", start: 48, type: "fixed", value: 1 }], name: "key" },
    workload: {
      fields: [{ name: "version", role: "lookup" }],
      readWeight: 1,
      writeWeight: 1,
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
    schema: { fields: [{ length: 8, name: "shard", start: 0, type: "shard" }], name: "key" },
    workload: {
      fields: [{ name: "missing", role: "partition" }],
      readWeight: 1,
      writeWeight: 1,
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
      fields: [
        { length: 8, name: "first", start: 0, type: "shard" },
        { length: 8, name: "second", start: 4, type: "shard" },
      ],
      name: "key",
    },
    workload: {
      fields: [{ name: "first", role: "partition" }],
      readWeight: 1,
      writeWeight: 1,
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
  const input = fromAny<LayoutCompilerInput, unknown>({
    schema: { fields: [{ length: 8, name: "shard", start: 0, type: "shard" }], name: "key" },
    workload: {
      fields: [{ name: "shard", role: "partition" }],
      writeWeight: 1,
    },
  })

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
      fields: [
        { length: 8, name: "marker", type: "fixed", value: 5 },
        { constraint: { allowed: [1, 2, 3] }, length: 8, name: "shard", type: "shard" },
        { constraint: { monotonic: true }, length: 16, name: "counter", type: "counter" },
        { length: 40, name: "trace", type: "process" },
      ],
      name: "modes",
    },
    workload: {
      fields: [
        { name: "marker", role: "lookup" },
        { name: "shard", role: "partition" },
        { name: "counter", role: "lookup" },
        { name: "trace", role: "cluster" },
      ],
      readWeight: 1,
      writeWeight: 1,
    },
  })
  const checkMode = (injected: boolean): void => {
    configureRandom(injected ? (buf) => buf.fill(7) : null)
    try {
      for (let index = 0; index < 32; index += 1) {
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
