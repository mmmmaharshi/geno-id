import { test } from "node:test"
import assert from "node:assert/strict"
import {
  genPgUuidV8,
  extractPgUuidV8Timestamp,
  genUlid,
  genUlidV8,
  genKsuid,
  genSnowflake,
  bytesToUuid,
  uuidToBytes,
} from "./baselines.ts"

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/
const CROCKFORD = /^[0-9A-HJKMNP-TV-Z]{26}$/
const BASE62 = /^[0-9A-Za-z]{27}$/

test("genPgUuidV8 produces a v4-format UUID and round-trips its timestamp", () => {
  const nowUs = BigInt(Date.now()) * 1000n
  const uuid = genPgUuidV8(nowUs)
  assert.match(uuid, UUID_RE)
  // version 4
  assert.equal(uuid[14], "4")
  // RFC 9562 variant
  assert.ok("89ab".includes(uuid[19]))
  assert.equal(extractPgUuidV8Timestamp(uuid), nowUs & 0xffffffffffffn)
})

test("genUlid produces 26 Crockford chars and sorts chronologically", () => {
  const a = genUlid(1000)
  const b = genUlid(2000)
  assert.match(a, CROCKFORD)
  assert.match(b, CROCKFORD)
  assert.ok(a < b, "ULIDs must sort by time (lexicographic)")
})

test("genUlidV8 produces a v8 UUID carrying the timestamp in the leading 48 bits", () => {
  const nowMs = 1_700_000_000_000
  const uuid = genUlidV8(nowMs)
  assert.match(uuid, UUID_RE)
  // version 8
  assert.equal(uuid[14], "8")
  const b = uuidToBytes(uuid)
  let ts = 0n
  for (let i = 0; i < 6; i++) ts = (ts << 8n) | BigInt(b[i])
  assert.equal(Number(ts), nowMs)
})

test("genKsuid produces 27 base62 chars", () => {
  const k = genKsuid()
  assert.match(k, BASE62)
  assert.equal(k.length, 27)
})

test("genSnowflake produces a 64-bit integer string and is monotonic per worker", () => {
  const a = genSnowflake(1n, 1_000_000)
  const b = genSnowflake(1n, 1_000_000)
  const c = genSnowflake(2n, 1_000_000)
  assert.ok(BigInt(b) > BigInt(a), "sequence must increment within the same ms")
  assert.ok(BigInt(c) > BigInt(a), "different workers produce distinct ranges")
})

test("bytesToUuid / uuidToBytes are inverse for all 16 bytes", () => {
  const b = randomProbe()
  const s = bytesToUuid(b)
  const back = uuidToBytes(s)
  assert.deepEqual([...back], [...b])
})

function randomProbe(): Uint8Array {
  const b = new Uint8Array(16)
  crypto.getRandomValues(b)
  return b
}
