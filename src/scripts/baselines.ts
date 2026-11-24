import { xorByte } from "../shared/bitwise.ts"
// Comparison baselines for the GenoID evaluation (Phase A).

//

// Implements four structured-ID generators used as baselines:

//  - genPgUuidV8  : pg_uuid_v8 (ineron, 2026) — closest prior art; UUID v4-compatible

//                  Steganographic embedding of an encrypted 48-bit microsecond timestamp.

//  - genUlid      : ULID — 48-bit ms timestamp + 80-bit randomness, Crockford base32.

//  - genUlidV8    : ULID bits mapped into a UUIDv8 for apples-to-apples randomness/collision.

//  - genKsuid     : Segment KSUID — 160-bit (32-bit s timestamp + 128-bit random), base62.

//  - genSnowflake : Twitter-style Snowflake — 64-bit (41-bit ms ts + 10-bit worker + 12-bit seq).

//

// UUID-shaped baselines reuse a local 16-byte formatter so the module is self-contained

// (it does not depend on the compiled GenoID core, keeping the comparison independent).

const randomBytes = (n: number): Uint8Array => {
  const b = new Uint8Array(n)

  crypto.getRandomValues(b)

  return b
}

const HEX: string[] = Array.from({ length: 256 }, (_, i) =>
  i.toString(16).padStart(2, "0")
)

export const bytesToUuid = (b: Uint8Array): string => {
  const h = Array.from(b, (x) => HEX[x]).join("")

  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20, 32)}`
}

export const uuidToBytes = (uuid: string): Uint8Array => {
  const h = uuid.replaceAll("-", "")

  const b = new Uint8Array(16)

  for (let j = 0; j < 16; j += 1) {
    b[j] = Number.parseInt(h.slice(j * 2, j * 2 + 2), 16)
  }

  return b
}

const forceV8 = (b: Uint8Array): void => {
  b[6] = (b[6] % 16) + 0x80

  b[8] = (b[8] % 64) + 0x80
}

// ---------------------------------------------------------------------------

// Pg_uuid_v8 — UUID v4-compatible steganographic timestamp (XOR mode).

// 48-bit encrypted microsecond timestamp occupies the leading 48 bits; the

// Remaining 80 bits are CSPRNG random; version=4, RFC 9562 variant.

// ---------------------------------------------------------------------------

// Fixed 48-bit XOR key (baseline)

const positiveMod = (value: bigint, modulus: bigint): bigint => {
  const remainder = value % modulus
  if (remainder < 0n) {
    return remainder + modulus
  }
  return remainder
}

const PG_KEY_BYTES = [0x9e, 0x37, 0x79, 0xb9, 0x7f, 0x4a]

const xorTimestamp = (value: bigint): bigint => {
  let result = 0n
  for (let index = 0; index < PG_KEY_BYTES.length; index += 1) {
    const shift = BigInt(8 * (PG_KEY_BYTES.length - 1 - index))
    const byte = Number((value / 2n ** shift) % 256n)
    result = result * 256n + BigInt(xorByte(byte, PG_KEY_BYTES[index]))
  }
  return result
}

// 48-bit microsecond field (wraps past ~1979 epoch).

export const genPgUuidV8 = (
  nowUs: bigint = BigInt(Date.now()) * 1000n
): string => {
  const ts = positiveMod(nowUs, 2n ** 48n)

  const enc = xorTimestamp(ts)

  const b = randomBytes(16)

  for (let i = 0; i < 6; i += 1) {
    const shift = BigInt(8 * (5 - i))

    b[i] = Number((enc / 2n ** shift) % 256n)
  }

  // Version 4

  b[6] = (b[6] % 16) + 0x40

  // RFC 9562 variant

  b[8] = (b[8] % 64) + 0x80

  return bytesToUuid(b)
}

export const extractPgUuidV8Timestamp = (uuid: string): bigint => {
  const b = uuidToBytes(uuid)

  let enc = 0n

  for (let i = 0; i < 6; i += 1) {
    enc = enc * 256n + BigInt(b[i])
  }

  return xorTimestamp(enc)
}

// ---------------------------------------------------------------------------

// ULID — 26-char Crockford base32 (48-bit ms timestamp + 80-bit randomness).

// Also provided in UUIDv8-mapped form for fair randomness/collision comparison.

// ---------------------------------------------------------------------------

const CROCKFORD = "0123456789ABCDEFGHJKMNPQRSTVWXYZ"

export const genUlid = (nowMs: number = Date.now()): string => {
  const tsChars = Array.from<string>({ length: 10 })

  let t = positiveMod(BigInt(nowMs), 2n ** 50n)

  for (let i = 9; i >= 0; i -= 1) {
    tsChars[i] = CROCKFORD[Number(t % 32n)]

    t /= 32n
  }

  const rnd = randomBytes(10)

  let r = 0n

  for (const x of rnd) {
    r = r * 256n + BigInt(x)
  }

  const rndChars = Array.from<string>({ length: 16 })

  for (let i = 15; i >= 0; i -= 1) {
    rndChars[i] = CROCKFORD[Number(r % 32n)]

    r /= 32n
  }

  return tsChars.join("") + rndChars.join("")
}

export const genUlidV8 = (nowMs: number = Date.now()): string => {
  if (!Number.isInteger(nowMs)) {
    throw new RangeError("genUlidV8: nowMs must be an integer")
  }

  const b = randomBytes(16)

  for (let i = 0; i < 6; i += 1) {
    b[i] = Math.floor(nowMs / 2 ** (8 * (5 - i))) % 256
  }

  forceV8(b)

  return bytesToUuid(b)
}

// ---------------------------------------------------------------------------

// KSUID (Segment) — 160-bit: 32-bit second-granularity timestamp + 128-bit random,

// Encoded as 27 base62 characters. Native form (not UUID-shaped).

// ---------------------------------------------------------------------------

const BASE62 = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz"

// 2014-05-13T00:00:00Z

const KSUID_EPOCH = 1_400_000_000

export const genKsuid = (
  nowSec: number = Math.floor(Date.now() / 1000)
): string => {
  if (!Number.isInteger(nowSec)) {
    throw new RangeError("genKsuid: nowSec must be an integer")
  }

  const ts = nowSec - KSUID_EPOCH

  const payload = new Uint8Array(20)

  for (let i = 0; i < 4; i += 1) {
    payload[i] = Math.floor(ts / 2 ** (8 * (3 - i))) % 256
  }

  payload.set(randomBytes(16), 4)

  let num = 0n

  for (const x of payload) {
    num = num * 256n + BigInt(x)
  }

  const chars = Array.from<string>({ length: 27 })

  for (let i = 26; i >= 0; i -= 1) {
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

const SF_EPOCH = 1_288_834_974_657n

export const genSnowflake = (
  workerId = 1n,

  nowMs: number = Date.now(),

  epoch: bigint = SF_EPOCH
): string => {
  const ts = BigInt(nowMs) - epoch

  const worker = positiveMod(workerId, 1024n) * 4096n

  const sequence = sfSeq % 4096n

  const id = ts * 2n ** 22n + worker + sequence

  sfSeq = (sfSeq + 1n) % 4096n

  return id.toString()
}

// Extract only the *random* bits of a timestamped UUID (v4/v8-compatible layout):

// Skip [0,48) timestamp, [48,52) version nibble, [64,66) variant bits. Returns

// The remaining bits as a 0/1 array. Used for payload-only uniformity (monobit),

// Since a whole-UUID histogram is invalid for timestamped identifiers.

export const extractRandomBits = (
  uuid: string,
  fixed: [number, number][]
): number[] => {
  const b = uuidToBytes(uuid)

  const bits: number[] = []

  for (let i = 0; i < 128; i += 1) {
    if (!fixed.some(([s, e]) => i >= s && i < e)) {
      const byte = b[Math.floor(i / 8)]

      const bit = 7 - (i % 8)

      bits.push(Math.floor(byte / 2 ** bit) % 2)
    }
  }

  return bits
}

// Fixed-bit ranges for UUID-shaped timestamped baselines (timestamp + version + variant).

export const TIMESTAMPED_FIXED: [number, number][] = [
  [0, 48],

  [48, 52],

  [64, 66],
]
