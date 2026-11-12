// Shared-helper regression net: the deduplicated helpers in cli-utils.ts
// and export-bits.ts must keep their exact behavior, since ~10 call sites
// depend on byte-identical semantics (seeded streams, hex decoding, v8 format).
import assert from "node:assert/strict"
import { test } from "node:test"
import { mulberry32 } from "./shared/cli-utils.ts"
import { hexVal, genRawV8 } from "./shared/export-bits.ts"

test("mulberry32: deterministic stream pinned to known values", () => {
  const r = mulberry32(99)
  assert.equal(r().toPrecision(17), "0.26046581240370870")
  assert.equal(r().toPrecision(17), "0.80482276552356780")
  assert.equal(r().toPrecision(17), "0.54087153496220708")
})

test("mulberry32: different seeds diverge immediately", () => {
  assert.notEqual(mulberry32(1)(), mulberry32(2)())
})

test("hexVal: decodes 0-9a-f, rejects everything else as 0", () => {
  assert.equal(hexVal(48), 0)
  assert.equal(hexVal(57), 9)
  assert.equal(hexVal(97), 10)
  assert.equal(hexVal(102), 15)
  assert.equal(hexVal(65), 0)
  assert.equal(hexVal(45), 0)
})

test("genRawV8: emits v8-formatted UUIDs", () => {
  for (let i = 0; i < 10; i++) {
    assert.match(genRawV8(), /^[0-9a-f]{8}-[0-9a-f]{4}-8[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/)
  }
})
