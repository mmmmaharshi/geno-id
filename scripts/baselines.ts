// Comparison baselines for the GenoID evaluation (Phase A).
//
// Implements four structured-ID generators used as baselines:
//  - genPgUuidV8  : pg_uuid_v8 (ineron, 2026) — closest prior art; UUID v4-compatible
//                  steganographic embedding of an encrypted 48-bit microsecond timestamp.
//  - genUlid      : ULID — 48-bit ms timestamp + 80-bit randomness, Crockford base32.
//  - genUlidV8    : ULID bits mapped into a UUIDv8 for apples-to-apples randomness/collision.
//  - genKsuid     : Segment KSUID — 160-bit (32-bit s timestamp + 128-bit random), base62.
//  - genSnowflake : Twitter-style Snowflake — 64-bit (41-bit ms ts + 10-bit worker + 12-bit seq).
//
// UUID-shaped baselines reuse a local 16-byte formatter so the module is self-contained
// (it does not depend on the compiled GenoID core, keeping the comparison independent).

function randomBytes(n: number): Uint8Array {
  const b = new Uint8Array(n)
  crypto.getRandomValues(b)
  return b
}

const HEX: string[] = Array.from({ length: 256 }, (_, i) => i.toString(16).padStart(2, "0"))

export function bytesToUuid(b: Uint8Array): string {
  const h = Array.from(b, (x) => HEX[x]).join("")
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20, 32)}`
}

export function uuidToBytes(uuid: string): Uint8Array {
  const h = uuid.replaceAll("-", "")
  const b = new Uint8Array(16)
  for (let j = 0; j < 16; j++) b[j] = Number.parseInt(h.slice(j * 2, j * 2 + 2), 16)
  return b
}

function forceV8(b: Uint8Array): void {
  b[6] = (b[6] & 0x0f) | 0x80
  b[8] = (b[8] & 0x3f) | 0x80
}

// ---------------------------------------------------------------------------
// pg_uuid_v8 — UUID v4-compatible steganographic timestamp (XOR mode).
// 48-bit encrypted microsecond timestamp occupies the leading 48 bits; the
// remaining 80 bits are CSPRNG random; version=4, RFC 9562 variant.
// ---------------------------------------------------------------------------

// fixed 48-bit XOR key (baseline)
const PG_KEY_48 = 0x9e3779b97f4an & 0xffffffffffffn

export function genPgUuidV8(nowUs: bigint = BigInt(Date.now()) * 1000n): string {
  // 48-bit microsecond field (wraps past ~1979 epoch)
  const ts = nowUs & 0xffffffffffffn

  const enc = ts ^ PG_KEY_48
  const b = randomBytes(16)
  for (let i = 0; i < 6; i++) b[i] = Number((enc >> BigInt(8 * (5 - i))) & 0xffn)
  // version 4
  b[6] = (b[6] & 0x0f) | 0x40
  // RFC 9562 variant
  b[8] = (b[8] & 0x3f) | 0x80
  return bytesToUuid(b)
}

export function extractPgUuidV8Timestamp(uuid: string): bigint {
  const b = uuidToBytes(uuid)
  let enc = 0n
  for (let i = 0; i < 6; i++) enc = (enc << 8n) | BigInt(b[i])
  return (enc ^ PG_KEY_48) & 0xffffffffffffn
}

// ---------------------------------------------------------------------------
// ULID — 26-char Crockford base32 (48-bit ms timestamp + 80-bit randomness).
// Also provided in UUIDv8-mapped form for fair randomness/collision comparison.
// ---------------------------------------------------------------------------

const CROCKFORD = "0123456789ABCDEFGHJKMNPQRSTVWXYZ"

export function genUlid(nowMs: number = Date.now()): string {
  const ts = BigInt(nowMs)
  const tsChars = new Array<string>(10)
  let t = ts
  for (let i = 9; i >= 0; i--) {
    tsChars[i] = CROCKFORD[Number(t & 31n)]
    t >>= 5n
  }
  const rnd = randomBytes(10)
  let r = 0n
  for (const x of rnd) r = (r << 8n) | BigInt(x)
  const rndChars = new Array<string>(16)
  for (let i = 15; i >= 0; i--) {
    rndChars[i] = CROCKFORD[Number(r & 31n)]
    r >>= 5n
  }
  return tsChars.join("") + rndChars.join("")
}

export function genUlidV8(nowMs: number = Date.now()): string {
  const b = randomBytes(16)
  const ts = BigInt(nowMs)
  for (let i = 0; i < 6; i++) b[i] = Number((ts >> BigInt(8 * (5 - i))) & 0xffn)
  forceV8(b)
  return bytesToUuid(b)
}

// ---------------------------------------------------------------------------
// KSUID (Segment) — 160-bit: 32-bit second-granularity timestamp + 128-bit random,
// encoded as 27 base62 characters. Native form (not UUID-shaped).
// ---------------------------------------------------------------------------

const BASE62 = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz"
// 2014-05-13T00:00:00Z
const KSUID_EPOCH = 1400000000

export function genKsuid(nowSec: number = Math.floor(Date.now() / 1000)): string {
  const ts = BigInt(nowSec - KSUID_EPOCH)
  const payload = new Uint8Array(20)
  for (let i = 0; i < 4; i++) payload[i] = Number((ts >> BigInt(8 * (3 - i))) & 0xffn)
  payload.set(randomBytes(16), 4)
  let num = 0n
  for (const x of payload) num = (num << 8n) | BigInt(x)
  const chars = new Array<string>(27)
  for (let i = 26; i >= 0; i--) {
    chars[i] = BASE62[Number(num % 62n)]
    num /= 62n
  }
  return chars.join("")
}

// ---------------------------------------------------------------------------
// Snowflake — 64-bit: 41-bit ms timestamp + 10-bit worker + 12-bit sequence.
// Native decimal-string form (not UUID-shaped). Sequence is monotonic per worker.
// ---------------------------------------------------------------------------

let sfSeq = 0n
// Twitter snowflake epoch (ms)
const SF_EPOCH = 1288834974657n

export function genSnowflake(
  workerId = 1n,
  nowMs: number = Date.now(),
  epoch: bigint = SF_EPOCH,
): string {
  const ts = BigInt(nowMs) - epoch
  const id = (ts << 22n) | ((workerId & 0x3ffn) << 12n) | (sfSeq & 0xfffn)
  sfSeq = (sfSeq + 1n) & 0xfffn
  return id.toString()
}

// Extract only the *random* bits of a timestamped UUID (v4/v8-compatible layout):
// skip [0,48) timestamp, [48,52) version nibble, [64,66) variant bits. Returns
// the remaining bits as a 0/1 array. Used for payload-only uniformity (monobit),
// since a whole-UUID histogram is invalid for timestamped identifiers.
export function extractRandomBits(uuid: string, fixed: [number, number][]): number[] {
  const b = uuidToBytes(uuid)
  const bits: number[] = []
  for (let i = 0; i < 128; i++) {
    if (fixed.some(([s, e]) => i >= s && i < e)) continue
    const byte = b[i >> 3]
    const bit = 7 - (i & 7)
    bits.push((byte >> bit) & 1)
  }
  return bits
}

// Fixed-bit ranges for UUID-shaped timestamped baselines (timestamp + version + variant).
export const TIMESTAMPED_FIXED: [number, number][] = [
  [0, 48],
  [48, 52],
  [64, 66],
]
