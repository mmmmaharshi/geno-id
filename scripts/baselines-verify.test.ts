import { test } from "node:test"
import assert from "node:assert/strict"
import {
  genUlid,
  genUlidV8,
  genPgUuidV8,
  extractPgUuidV8Timestamp,
  genKsuid,
  genSnowflake,
  uuidToBytes,
} from "./baselines.ts"

// Fixed constant mirrored from baselines.ts (verification oracle only).
const KSUID_EPOCH = 1_400_000_000
const SF_EPOCH = 1_288_834_974_657n
const PG_KEY_48 = 0x9e3779b97f4an & 0xffffffffffffn
const CROCKFORD = "0123456789ABCDEFGHJKMNPQRSTVWXYZ"

// Replace the CSPRNG with a deterministic, reproducible fill so generated
// output is fully determined by (timestamp, pattern) — enabling known-answer
// comparison against external reference implementations.
function withRandom(pattern: number[], fn: () => void): void {
  const c = globalThis.crypto as unknown as {
    getRandomValues: (a: Uint8Array) => Uint8Array
  }
  const orig = c.getRandomValues
  c.getRandomValues = (arr: Uint8Array) => {
    for (let i = 0; i < arr.length; i++) arr[i] = pattern[i % pattern.length]!
    return arr
  }
  try {
    fn()
  } finally {
    c.getRandomValues = orig
  }
}

function bytesToTimestamp(b: Uint8Array, n = 6): number {
  let ts = 0n
  for (let i = 0; i < n; i++) ts = (ts << 8n) | BigInt(b[i]!)
  return Number(ts)
}

function decodeUlidTimestamp(ulid: string): number {
  let ts = 0n
  for (let i = 0; i < 10; i++) ts = (ts << 5n) | BigInt(CROCKFORD.indexOf(ulid[i]!))
  return Number(ts)
}

function ksuidDecode(s: string): Uint8Array {
  const BASE62 = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz"
  let num = 0n
  for (const ch of s) {
    const d = BASE62.indexOf(ch)
    if (d === -1) throw new Error(`ksuid char ${ch} not in base62 alphabet`)
    num = num * 62n + BigInt(d)
  }
  const payload = new Uint8Array(20)
  for (let i = 19; i >= 0; i--) {
    payload[i] = Number(num & 0xffn)
    num >>= 8n
  }
  return payload
}

test("genUlid matches the published ULID spec vector (t=1469918176385, zero random)", () => {
  // ULID spec: encodeTime(1469918176385) = "01ARYZ6S41", zero randomness = 16 '0'.
  withRandom(Array.from({ length: 256 }, () => 0), () => {
    assert.equal(genUlid(1_469_918_176_385), "01ARYZ6S410000000000000000")
  })
})

test("genUlid embeds 48-bit ms timestamp and the injected random bytes (round-trip)", () => {
  const pattern = Array.from({ length: 256 }, (_, i) => i)
  withRandom(pattern, () => {
    const t = 1_700_000_000_000
    const s = genUlid(t)
    assert.equal(decodeUlidTimestamp(s), t)
    // random portion must equal the injected 10 bytes, encoded big-endian.
    let r = 0n
    for (let i = 0; i < 10; i++) r = (r << 8n) | BigInt(pattern[i]!)
    let decoded = 0n
    for (let i = 10; i < 26; i++)
      decoded = (decoded << 5n) | BigInt(CROCKFORD.indexOf(s[i]!))
    assert.equal(decoded, r)
  })
})

test("genPgUuidV8 is v4/variant-correct and embeds the timestamp (XOR)", () => {
  const t = 1_234_567_890_123n
  const uuid = genPgUuidV8(t)
  const b = uuidToBytes(uuid)
  assert.equal((b[6]! >> 4) & 0xf, 4)
  assert.equal((b[8]! >> 6) & 0b11, 0b10)
  // timestamp bytes = (ts ^ KEY) big-endian
  const expected = t ^ PG_KEY_48
  assert.equal(bytesToTimestamp(b, 6), Number(expected))
  // and round-trips exactly (timestamp fits in 48 bits)
  assert.equal(extractPgUuidV8Timestamp(uuid), t)
})

test("genUlidV8 is v8/variant-correct and embeds the 48-bit ms timestamp", () => {
  const t = 1_700_000_000_000
  const uuid = genUlidV8(t)
  const b = uuidToBytes(uuid)
  assert.equal((b[6]! >> 4) & 0xf, 8)
  assert.equal((b[8]! >> 6) & 0b11, 0b10)
  assert.equal(bytesToTimestamp(b, 6), t)
})

test("genKsuid round-trips timestamp + random payload via base62 decode", () => {
  const pattern = Array.from({ length: 256 }, (_, i) => i)
  withRandom(pattern, () => {
    const nowSec = 1_700_000_000
    const s = genKsuid(nowSec)
    assert.equal(s.length, 27)
    const payload = ksuidDecode(s)
    const tsField =
      (payload[0]! << 24) | (payload[1]! << 16) | (payload[2]! << 8) | payload[3]!
    assert.equal(tsField, nowSec - KSUID_EPOCH)
    for (let i = 0; i < 16; i++) assert.equal(payload[4 + i]!, pattern[i]!)
  })
})

test("genSnowflake embeds 41-bit ts + worker and increments sequence monotonically", () => {
  const worker = 5n
  const t = 1_700_000_000_000
  const id1 = BigInt(genSnowflake(worker, t))
  const id2 = BigInt(genSnowflake(worker, t))
  assert.equal(Number(id1 >> 22n), t - Number(SF_EPOCH))
  assert.equal(Number((id1 >> 12n) & 0x3ffn), Number(worker))
  const seq1 = Number(id1 & 0xfffn)
  const seq2 = Number(id2 & 0xfffn)
  assert.equal(seq2, (seq1 + 1) & 0xfff)
})

test("all timestamped baselines embed the exact injected timestamp", () => {
  const tMs = 1_700_000_000_000
  // tUs must fit in 48 bits (< 2^48) so pg_uuid_v8 does not wrap.
  const tUs = 170_000_000_000_000n
  const tSec = Math.floor(tMs / 1000)

  assert.equal(decodeUlidTimestamp(genUlid(tMs)), tMs)
  assert.equal(bytesToTimestamp(uuidToBytes(genUlidV8(tMs)), 6), tMs)
  assert.equal(extractPgUuidV8Timestamp(genPgUuidV8(tUs)), tUs)
  const kp = ksuidDecode(genKsuid(tSec))
  const kTs = (kp[0]! << 24) | (kp[1]! << 16) | (kp[2]! << 8) | kp[3]!
  assert.equal(kTs, tSec - KSUID_EPOCH)
  assert.equal(Number(BigInt(genSnowflake(1n, tMs)) >> 22n), tMs - Number(SF_EPOCH))
})
