import { test } from "node:test"
import assert from "node:assert/strict"
import path from "node:path"

// oxlint false-positive: it does not track `import type` usage inside `as` casts.
// oxlint-disable-next-line no-unused-vars
import type { V8Field, V8Layout } from "../dist/algo.js"

const __dirname = import.meta.dirname
const root = path.resolve(__dirname, "..")
const algo = await import(path.resolve(root, "dist/algo.js"))
const {
  completeLayout,
  readStructured,
  genStructuredGenoID,
  uuidToBytes,
} = algo as {
  completeLayout: (name: string, core: V8Field[]) => V8Layout
  readStructured: (uuid: string, layout: V8Layout) => Record<string, number>
  genStructuredGenoID: (l: V8Layout) => string
  uuidToBytes: (uuid: string) => Uint8Array
}

// Independent uuid<->bytes codec (does NOT use algo) so expected values are
// derived from an external source of truth, not recomputed by the code under test.
function bytesToUuid(b: Uint8Array): string {
  const h = [...b].map((x) => x.toString(16).padStart(2, "0")).join("")
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20, 32)}`
}

test("readStructured returns each field's integer value from a crafted UUID", () => {
  const layout = completeLayout("one", [
    { name: "x", start: 0, length: 16, type: "random" },
  ])
  const bytes = new Uint8Array(16)
  bytes[0] = 0x12
  bytes[1] = 0x34
  const got = readStructured(bytesToUuid(bytes), layout)
  assert.equal(got.x, 0x1234)
})

test("readStructured reads full >32-bit fields (regression guard for truncation)", () => {
  const layout = completeLayout("wide", [
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

test("readStructured keys match field names and respect constraints on real UUIDs", () => {
  const layout = completeLayout("dbkey", [
    { name: "timestamp", start: 0, length: 48, type: "timestamp-ms" },
    { name: "shard", start: 52, length: 8, type: "shard", constraint: { allowed: [1, 2, 3, 4, 5] } },
    { name: "counter", start: 66, length: 16, type: "counter", constraint: { monotonic: true } },
  ])
  const uuid = genStructuredGenoID(layout)
  const got = readStructured(uuid, layout)
  assert.deepEqual(Object.keys(got).toSorted(), layout.fields.map((f) => f.name).toSorted())
  assert.ok([1, 2, 3, 4, 5].includes(got.shard))
  assert.ok(Number.isInteger(got.counter) && got.counter >= 0)
  // version nibble must be 8 (RFC 9562 v8)
  assert.equal((uuidToBytes(uuid)[6] >> 4) & 0xf, 8)
})
