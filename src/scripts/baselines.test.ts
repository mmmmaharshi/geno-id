import { test } from "node:test"
import assert from "node:assert/strict"
import { genUlid, bytesToUuid, uuidToBytes } from "./baselines.ts"

const CROCKFORD = /^[0-9A-HJKMNP-TV-Z]{26}$/u

test("genUlid produces 26 Crockford chars and sorts chronologically", () => {
  const a = genUlid(1000)
  const b = genUlid(2000)
  assert.match(a, CROCKFORD)
  assert.match(b, CROCKFORD)
  assert.ok(a < b, "ULIDs must sort by time (lexicographic)")
})

test("bytesToUuid / uuidToBytes are inverse for all 16 bytes", () => {
  const b = randomProbe()
  const s = bytesToUuid(b)
  const back = uuidToBytes(s)
  assert.deepEqual([...back], [...b])
})

function randomProbe(): Uint8Array {
  const b = new Uint8Array(16)
  for (let i = 0; i < 16; i += 1) {b[i] = (i * 37 + 11) & 0xff}
  return b
}
