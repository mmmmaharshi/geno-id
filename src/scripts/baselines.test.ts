/// <reference types="node" />

import { bytesToUuid, genUlid, uuidToBytes } from "./baselines.ts"

import { andBits } from "../shared/bitwise.ts"

import assert from "node:assert/strict"

import { test } from "node:test"

const CROCKFORD = /^[0-9A-HJKMNP-TV-Z]{26}$/u

void test("genUlid produces 26 Crockford chars and sorts chronologically", () => {
  const a = genUlid(1000)

  const b = genUlid(2000)

  assert.match(a, CROCKFORD)

  assert.match(b, CROCKFORD)

  assert.ok(a < b, "ULIDs must sort by time (lexicographic)")
})

const randomProbe = (): Uint8Array => {
  const b = new Uint8Array(16)

  for (let i = 0; i < 16; i += 1) {
    b[i] = andBits(i * 37 + 11, 0xFF)
  }

  return b
}

void test("bytesToUuid / uuidToBytes are inverse for all 16 bytes", () => {
  const b = randomProbe()

  const s = bytesToUuid(b)

  const back = uuidToBytes(s)

  assert.deepEqual([...back], [...b])
})
