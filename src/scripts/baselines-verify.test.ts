/// <reference types="node" />

import {
  andBits,
  orBits,
  shiftLeftBits,
  shiftRightBits,
  xorBits,
} from "../shared/bitwise.ts"

import {
  extractPgUuidV8Timestamp,
  genKsuid,
  genPgUuidV8,
  genSnowflake,
  genUlid,
  genUlidV8,
  uuidToBytes,
} from "./baselines.ts"

import assert from "node:assert/strict"

import { fromAny } from "@total-typescript/shoehorn"

import { need } from "../shared/need.ts"

import { test } from "node:test"

// Fixed constant mirrored from baselines.ts (verification oracle only).

const KSUID_EPOCH = 1_400_000_000

const SF_EPOCH = 1_288_834_974_657n

const PG_KEY_48 = andBits(0x9E_37_79_B9_7F_4An, 0xFF_FF_FF_FF_FF_FFn)

const CROCKFORD = "0123456789ABCDEFGHJKMNPQRSTVWXYZ"

// Replace the CSPRNG with a deterministic, reproducible fill so generated

// Output is fully determined by (timestamp, pattern) — enabling known-answer

// Comparison against external reference implementations.

const withRandom = (pattern: readonly number[], fn: () => void): void => {
  const c = fromAny<{
    getRandomValues: (a: Uint8Array) => Uint8Array
  }, unknown>(globalThis.crypto)

  const orig = c.getRandomValues

  c.getRandomValues = (arr: Uint8Array): Uint8Array => {
    for (let i = 0; i < arr.length; i += 1) {
      arr[i] = need(pattern[i % pattern.length])
    }

    return arr
  }

  try {
    fn()
  } finally {
    c.getRandomValues = orig
  }
}

const bytesToTimestamp = (b: Readonly<Uint8Array>, n = 6): number => {
  let ts = 0n

  for (let i = 0; i < n; i += 1) {
    ts = orBits(shiftLeftBits(ts, 8n), BigInt(need(b[i])))
  }

  return Number(ts)
}

const decodeUlidTimestamp = (ulid: string): number => {
  let ts = 0n

  for (let i = 0; i < 10; i += 1) {
    const digit = BigInt(CROCKFORD.indexOf(need(ulid[i])))
    ts = orBits(shiftLeftBits(ts, 5n), digit)
  }

  return Number(ts)
}

const ksuidDecode = (s: string): Uint8Array => {
  const BASE62 =
    "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz"

  let num = 0n

  for (const ch of s) {
    const d = BASE62.indexOf(ch)

    if (d === -1) {
      throw new Error(`ksuid char ${ch} not in base62 alphabet`)
    }

    num = num * 62n + BigInt(d)
  }

  const payload = new Uint8Array(20)

  for (let i = 19; i >= 0; i -= 1) {
    payload[i] = Number(andBits(num, 0xFFn))

    num = shiftRightBits(num, 8n)
  }

  return payload
}

void test("genUlid matches the published ULID spec vector (t=1469918176385, zero random)", () => {
  // ULID spec: encodeTime(1469918176385) = "01ARYZ6S41", zero randomness = 16 '0'.

  withRandom(
    Array.from({ length: 256 }, () => 0),
    () => {
      assert.equal(genUlid(1_469_918_176_385), "01ARYZ6S410000000000000000")
    },
  )
})

void test("genUlid embeds 48-bit ms timestamp and the injected random bytes (round-trip)", () => {
  const pattern = Array.from({ length: 256 }, (_, i) => i)

  withRandom(pattern, () => {
    const t = 1_700_000_000_000

    const s = genUlid(t)

    assert.equal(decodeUlidTimestamp(s), t)

    const negative = genUlid(-1)

    assert.equal(negative.length, 26)

    assert.equal(decodeUlidTimestamp(negative), 2 ** 50 - 1)

    // Random portion must equal the injected 10 bytes, encoded big-endian.

    let r = 0n

    for (let i = 0; i < 10; i += 1) {
      r = orBits(shiftLeftBits(r, 8n), BigInt(need(pattern[i])))
    }

    let decoded = 0n

    for (let i = 10; i < 26; i += 1) {
      const digit = BigInt(CROCKFORD.indexOf(need(s[i])))
      decoded = orBits(shiftLeftBits(decoded, 5n), digit)
    }

    assert.equal(decoded, r)
  })
})

void test("genPgUuidV8 is v4/variant-correct and embeds the timestamp (XOR)", () => {
  const t = 1_234_567_890_123n

  const uuid = genPgUuidV8(t)

  const b = uuidToBytes(uuid)

  const versionByte = need(b[6])

  const variantByte = need(b[8])

  const versionNibble = shiftRightBits(versionByte, 4)

  const variantBits = shiftRightBits(variantByte, 6)

  assert.equal(andBits(versionNibble, 0xF), 4)

  assert.equal(andBits(variantBits, 0b11), 0b10)

  // Timestamp bytes = (ts ^ KEY) big-endian

  const expected = xorBits(t, PG_KEY_48)

  assert.equal(bytesToTimestamp(b, 6), Number(expected))

  // And round-trips exactly (timestamp fits in 48 bits)

  assert.equal(extractPgUuidV8Timestamp(uuid), t)

  assert.equal(extractPgUuidV8Timestamp(genPgUuidV8(-1n)), 2n ** 48n - 1n)
})

void test("genUlidV8 is v8/variant-correct and embeds the 48-bit ms timestamp", () => {
  const t = 1_700_000_000_000

  const uuid = genUlidV8(t)

  const b = uuidToBytes(uuid)

  const versionByte = need(b[6])

  const variantByte = need(b[8])

  const versionNibble = shiftRightBits(versionByte, 4)

  const variantBits = shiftRightBits(variantByte, 6)

  assert.equal(andBits(versionNibble, 0xF), 8)

  assert.equal(andBits(variantBits, 0b11), 0b10)

  assert.equal(bytesToTimestamp(b, 6), t)

  assert.throws(() => genUlidV8(1.5), RangeError)
})

void test("genKsuid round-trips timestamp + random payload via base62 decode", () => {
  const pattern = Array.from({ length: 256 }, (_, i) => i)

  withRandom(pattern, () => {
    const nowSec = 1_700_000_000

    const s = genKsuid(nowSec)

    assert.throws(() => genKsuid(nowSec + 0.5), RangeError)

    assert.equal(s.length, 27)

    const payload = ksuidDecode(s)

    const byte0 = need(payload[0])

    const byte1 = need(payload[1])

    const byte2 = need(payload[2])

    const byte3 = need(payload[3])

    const high = orBits(shiftLeftBits(byte0, 24), shiftLeftBits(byte1, 16))

    const low = orBits(shiftLeftBits(byte2, 8), byte3)

    const tsField = need(orBits(high, low))

    assert.equal(tsField, nowSec - KSUID_EPOCH)

    for (let i = 0; i < 16; i += 1) {
      assert.equal(need(payload[4 + i]), need(pattern[i]))
    }
  })
})

void test("genSnowflake embeds 41-bit ts + worker and increments sequence monotonically", () => {
  const worker = 5n

  const t = 1_700_000_000_000

  const id1 = BigInt(genSnowflake(worker, t))

  const id2 = BigInt(genSnowflake(worker, t))

  assert.equal(Number(shiftRightBits(id1, 22n)), t - Number(SF_EPOCH))

  const workerBits = andBits(shiftRightBits(id1, 12n), 0x3_FFn)

  assert.equal(Number(workerBits), Number(worker))

  const seq1 = Number(andBits(id1, 0xF_FFn))

  const seq2 = Number(andBits(id2, 0xF_FFn))

  assert.equal(seq2, andBits(seq1 + 1, 0xF_FF))

  assert.equal((BigInt(genSnowflake(-1n, t)) / 4096n) % 1024n, 1023n)
})
