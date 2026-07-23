import { test } from "node:test"
import assert from "node:assert/strict"
import { pathToFileURL } from "node:url"
import path from "node:path"

// oxlint false-positive: it does not track `import type` usage inside `as` casts.
// oxlint-disable-next-line no-unused-vars
import type { V8Field, V8Layout } from "../dist/algo.js"

const __dirname = import.meta.dirname
const root = path.resolve(__dirname, "..")
const algo = await import(pathToFileURL(path.resolve(root, "dist/algo.js")).href)
const {
  completeLayout,
  composeStructured,
  genStructuredParent,
  repairConstraints,
  getFieldValue,
  uuidToBytes,
  uuidToRandomBits,
  genStructuredGenoID,
  DBKEY_LAYOUT,
} = algo as {
  completeLayout: (name: string, core: V8Field[]) => V8Layout
  composeStructured: (l: V8Layout, a: Uint8Array, b: Uint8Array, fs: number) => Uint8Array
  genStructuredParent: (l: V8Layout, mask: number[]) => Uint8Array
  repairConstraints: (l: V8Layout, b: Uint8Array) => number
  getFieldValue: (b: Uint8Array, f: V8Field) => bigint
  uuidToBytes: (uuid: string) => Uint8Array
  uuidToRandomBits: (uuid: string, layout: V8Layout) => string
  genStructuredGenoID: (l: V8Layout) => string
  DBKEY_LAYOUT: V8Layout
}

const dbkey = DBKEY_LAYOUT

const totalBits = dbkey.fields
  .filter((f) => f.type === "random")
  .reduce((s, f) => s + f.length, 0)

test("completeLayout covers all 128 bits and leaves reserved nibbles as gaps", () => {
  const covered = new Array<boolean>(128).fill(false)
  for (const f of dbkey.fields) {
    for (let i = 0; i < f.length; i++) covered[f.start + i] = true
  }
  // 128 bits minus the 6 reserved v8 nibble bits (48-51, 64-65) are covered
  // by declared + random-filler fields.
  assert.equal(covered.filter(Boolean).length, 122)
  for (const r of [48, 49, 50, 51, 64, 65]) assert.equal(covered[r], false)
  assert.ok(dbkey.fields.some((f) => f.type === "random"))
})

test("composeStructured inherits each structured field from exactly one parent", () => {
  const structIdx = dbkey.fields
    .map((f, i) => ({ f, i }))
    .filter(({ f }) => f.type !== "random")
    .map(({ i }) => i)
  const A = genStructuredParent(dbkey, structIdx)
  const B = genStructuredParent(dbkey, structIdx)
  for (let fs = 0; fs < 64; fs++) {
    const child = composeStructured(dbkey, A, B, fs)
    for (const [fi, f] of dbkey.fields.entries()) {
      if (f.type === "random") continue
      const src = ((fs >> fi) & 1) ? A : B
      assert.equal(getFieldValue(child, f), getFieldValue(src, f))
    }
  }
})

test("repairConstraints fixes violations and reports repair count", () => {
  const layout = completeLayout("k2", [
    { name: "c0", start: 0, length: 8, type: "random", constraint: { allowed: [0, 1, 2, 3] } },
    { name: "c1", start: 8, length: 8, type: "random", constraint: { allowed: [0, 1, 2, 3] } },
  ])
  for (let t = 0; t < 200; t++) {
    const bytes = new Uint8Array(16)
    crypto.getRandomValues(bytes)
    bytes[0] = 200
    bytes[1] = 200
    const repairs = repairConstraints(layout, bytes)
    assert.ok(repairs >= 1 && repairs <= 2)
    assert.ok([0, 1, 2, 3].includes(Number(getFieldValue(bytes, layout.fields[0]))))
    assert.ok([0, 1, 2, 3].includes(Number(getFieldValue(bytes, layout.fields[1]))))
  }
})

test("getFieldValue reads the leading field bits as an exact BigInt", () => {
  const layout = completeLayout("f", [
    { name: "x", start: 0, length: 16, type: "random" },
  ])
  const b = uuidToBytes("1a2b3c4d-0000-8000-8000-000000000000")
  assert.equal(getFieldValue(b, layout.fields[0]), 0x1a2bn)
})

test("uuidToBytes decodes the canonical UUID byte order", () => {
  const b = uuidToBytes("1a2b3c4d-0000-8000-8000-000000000000")
  assert.equal(b[0], 0x1a)
  assert.equal(b[1], 0x2b)
  assert.equal(b[2], 0x3c)
  assert.equal(b[3], 0x4d)
  assert.equal(b.length, 16)
})

test("uuidToRandomBits emits only random-field bits, produces correct-length output", () => {
  const bits = uuidToRandomBits(genStructuredGenoID(dbkey), dbkey)
  assert.equal(bits.length, totalBits)
  assert.match(bits, /^[01]+$/)
  const again = uuidToRandomBits(genStructuredGenoID(dbkey), dbkey)
  assert.equal(again.length, totalBits)
})
