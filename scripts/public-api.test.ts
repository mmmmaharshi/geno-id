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
} from "../dist/index.js"

import type {
  Layout,
  Field,
  FieldConstraint,
  FieldType,
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
