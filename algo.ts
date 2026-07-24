// Single 256-entry byte->hex table. Replaces the two 65536-entry word tables
// (HEX16 / HEX16_VIEW) that previously interned ~131k strings at import — far
// past the heap budget of constrained MCUs (ESP8266 has ~40-80KB free). A
// 16-bit word formats as HEX8[hi] + HEX8[lo], byte-identical to the old tables.
// 256-entry byte->hex table. Always present (~256 tiny strings), it is the only
// hex table a constrained host ("lean" footprint) ever allocates.
const HEX8: string[] = Array.from({ length: 256 }, (_, i) =>
  i.toString(16).padStart(2, "0"),
)

// Optional 65536-entry big-endian word->hex table (HEX8[hi] + HEX8[lo]). It is
// ~2x faster to format with (8 lookups/UUID instead of 16) but costs ~131k
// interned strings — far past an ESP8266's heap. It is therefore built LAZILY
// on first use and can be disabled/freed via configureFootprint("lean") so a
// constrained host never allocates it. Default is "fast" (build on demand).
let _wordTable: string[] | null = null
let _leanFootprint = false

function wordTable(): string[] | null {
  if (_leanFootprint) return null
  if (_wordTable === null) {
    const w = new Array<string>(65536)
    for (let i = 0; i < 65536; i++) w[i] = HEX8[i >> 8] + HEX8[i & 0xff]
    _wordTable = w
  }
  return _wordTable
}

/**
 * Select the hex-formatting footprint.
 *   "fast" (default) — lazily build a 65536-entry word table; ~2x faster
 *                      formatting, ~131k interned strings of resident memory.
 *   "lean"           — never build the word table (free it if already built);
 *                      format from the 256-entry byte table only. Required on
 *                      heap-constrained hosts (ESP8266-class). Call it once,
 *                      before the first ID is generated.
 * Output is byte-identical in both modes — this trades memory for speed only.
 */
export function configureFootprint(mode: "fast" | "lean"): void {
  if (mode === "lean") {
    _leanFootprint = true
    _wordTable = null
  } else {
    _leanFootprint = false
  }
}

export function toUuidString(b: Uint8Array): string {
  if (b.length < 16) throw new Error(`toUuidString: expected 16 bytes, got ${b.length}`)
  const w = wordTable()
  if (w) {
    return (
      w[(b[0] << 8) | b[1]] + w[(b[2] << 8) | b[3]] +
      "-" +
      w[(b[4] << 8) | b[5]] +
      "-" +
      w[(b[6] << 8) | b[7]] +
      "-" +
      w[(b[8] << 8) | b[9]] +
      "-" +
      w[(b[10] << 8) | b[11]] + w[(b[12] << 8) | b[13]] + w[(b[14] << 8) | b[15]]
    )
  }
  const t = HEX8
  return (
    t[b[0]] + t[b[1]] + t[b[2]] + t[b[3]] +
    "-" +
    t[b[4]] + t[b[5]] +
    "-" +
    t[b[6]] + t[b[7]] +
    "-" +
    t[b[8]] + t[b[9]] +
    "-" +
    t[b[10]] + t[b[11]] + t[b[12]] + t[b[13]] + t[b[14]] + t[b[15]]
  )
}

export function genV4Native(): string {
  return crypto.randomUUID()
}

// --- Injectable CSPRNG ------------------------------------------------------
// Every GenoID entropy draw flows through this single sink. It defaults to Web
// Crypto (crypto.getRandomValues) on Node/Deno/Bun/browsers. Hosts without Web
// Crypto — ESP8266/ESP32 firmware, MicroPython, bare embedded runtimes — inject
// a platform CSPRNG via configureRandom() before generating any ID. The entropy
// contract is unchanged (fill the whole buffer with secure random bytes), so
// output distribution and collision guarantees are identical; only the byte
// source changes. On a host without Web Crypto, module import no longer eagerly
// draws entropy (the pre-warms below are guarded), so importing never throws —
// the first generate call after configureRandom() does the first fill.
export type RandomFill = (buf: Uint8Array) => void

const _hasWebCrypto =
  typeof crypto !== "undefined" && typeof crypto.getRandomValues === "function"

const _webCryptoFill: RandomFill = (buf) => {
  // getRandomValues rejects SharedArrayBuffer-backed views; all GenoID buffers
  // are ArrayBuffer-backed, so narrow the widened public Uint8Array type here.
  crypto.getRandomValues(buf as Uint8Array<ArrayBuffer>)
}

const _noRngFill: RandomFill = () => {
  throw new Error(
    "GenoID: no CSPRNG available — Web Crypto (crypto.getRandomValues) was not found on this host. " +
      "Call configureRandom(fn) with a platform CSPRNG (e.g. os.urandom on MicroPython, esp_fill_random on ESP-IDF) before generating IDs.",
  )
}

let _fillRandom: RandomFill = _hasWebCrypto ? _webCryptoFill : _noRngFill

function fillRandom(buf: Uint8Array): void {
  _fillRandom(buf)
}

/**
 * Inject the platform CSPRNG used for every GenoID entropy draw. Required on
 * runtimes without Web Crypto (embedded firmware, MicroPython). `fn` must fill
 * the ENTIRE passed byte range with cryptographically-secure random bytes — a
 * weak source silently degrades collision/uniformity guarantees. Pass `null` to
 * restore the Web Crypto default (throws on first use if Web Crypto is absent).
 *
 * @example
 * // Embedded host bridge (bytes supplied by the platform RNG)
 * configureRandom((buf) => { for (let i = 0; i < buf.length; i++) buf[i] = platformRandomByte() })
 */
export function configureRandom(fn: RandomFill | null): void {
  if (fn === null) {
    _fillRandom = _hasWebCrypto ? _webCryptoFill : _noRngFill
    return
  }
  if (typeof fn !== "function") {
    throw new TypeError("configureRandom: expected a function (buf: Uint8Array) => void, or null to reset")
  }
  _fillRandom = fn
}

const _v7Rnd = new Uint8Array(10)
const _v7Bytes = new Uint8Array(16)

export function genV7(): string {
  fillRandom(_v7Rnd)
  const ts = Date.now()
  const bytes = _v7Bytes
  bytes[0] = (ts / 2 ** 40) & 0xff
  bytes[1] = (ts / 2 ** 32) & 0xff
  bytes[2] = (ts / 2 ** 24) & 0xff
  bytes[3] = (ts / 2 ** 16) & 0xff
  bytes[4] = (ts / 2 ** 8) & 0xff
  bytes[5] = ts & 0xff
  bytes.set(_v7Rnd, 6)
  bytes[6] = (bytes[6] & 0x0f) | 0x70
  bytes[8] = (bytes[8] & 0x3f) | 0x80
  return toUuidString(bytes)
}

export function genMathRandom(): string {
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(
    /[xy]/g,
    (c: string) => {
      const r = Math.trunc(Math.random() * 16)
      const v = c === "x" ? r : (r & 0x3) | 0x8
      return v.toString(16)
    },
  )
}

export async function genHashUUID(): Promise<string> {
  const seed = new Uint8Array(32)
  fillRandom(seed)
  let digest: ArrayBuffer
  try {
    digest = await crypto.subtle.digest("SHA-256", seed)
  } catch (error) {
    throw new Error(`genHashUUID: SubtleCrypto unavailable — ${(error as Error).message}`, { cause: error })
  }
  const bytes = new Uint8Array(digest).slice(0, 16)
  bytes[6] = (bytes[6] & 0x0f) | 0x50
  bytes[8] = (bytes[8] & 0x3f) | 0x80
  return toUuidString(bytes)
}

const GENO_ENTRY_BYTES = 34
// Default pool sizes. Runtime-tunable via configurePools() so a constrained
// host (e.g. an ESP8266 with ~40-80KB free heap) can trade batch size for RAM:
// the simple pool holds GENO_ENTRY_BYTES*N bytes + N interned strings; each
// structured layout holds STRUCT_ENTRY*N bytes + N strings. Shrinking N only
// changes refill granularity — per-ID generation and emitted output are
// byte-identical at any pool size.
const GENO_POOL_DEFAULT = 256
const STRUCT_POOL_DEFAULT = 1024
let _genoPoolN = GENO_POOL_DEFAULT
let _genoPool = new Uint8Array(GENO_ENTRY_BYTES * _genoPoolN)
let _genoStrs = new Array<string>(_genoPoolN)
let _genoIdx = _genoPoolN
const _child = new Uint8Array(16)

function refillGenoPool(): void {
  const t = HEX8, w = wordTable(), g = _genoPool, e = GENO_ENTRY_BYTES
  fillRandom(g)
  for (let i = 0; i < _genoPoolN; i++) {
    const off = i * e
    const cut = g[off + 32] & 15
    const mutPos = g[off + 33] & 15
    let j = 0
    for (; j < cut; j++) _child[j] = g[off + j]
    for (; j < 16; j++) _child[j] = g[off + 16 + j]
    _child[mutPos] ^= g[off + ((mutPos + 1) & 15)]
    _child[6] = (_child[6] & 0x0f) | 0x80
    _child[8] = (_child[8] & 0x3f) | 0x80
    const c = _child
    _genoStrs[i] = w
      ? w[(c[0] << 8) | c[1]] + w[(c[2] << 8) | c[3]] + "-" +
        w[(c[4] << 8) | c[5]] + "-" +
        w[(c[6] << 8) | c[7]] + "-" +
        w[(c[8] << 8) | c[9]] + "-" +
        w[(c[10] << 8) | c[11]] + w[(c[12] << 8) | c[13]] + w[(c[14] << 8) | c[15]]
      : t[c[0]] + t[c[1]] + t[c[2]] + t[c[3]] + "-" +
        t[c[4]] + t[c[5]] + "-" +
        t[c[6]] + t[c[7]] + "-" +
        t[c[8]] + t[c[9]] + "-" +
        t[c[10]] + t[c[11]] + t[c[12]] + t[c[13]] + t[c[14]] + t[c[15]]
  }
  _genoIdx = 0
}

// Pre-warm the GenoID pool at module init so the first call is never cold.
// Guarded: on a host without Web Crypto this would throw at import; there we
// defer the first fill to the first genGenoID() (after configureRandom()), so
// _genoIdx stays at _genoPoolN and the next call refills.
if (_hasWebCrypto) refillGenoPool()

export function genGenoID(): string {
  if (_genoIdx >= _genoPoolN) {
    refillGenoPool()
  }
  return _genoStrs[_genoIdx++]
}

// ---------- Structured RFC 9562 v8 composition framework ----------
//
// GenoID's GA operators are repurposed as a *composition + repair* framework:
//   - crossover  = field-boundary composition operator (merges structured
//                  fields from two complementary parents into one valid v8 UUID)
//   - mutation   = constraint-repair operator (flips field bits to satisfy
//                  per-field constraints without regenerating the whole UUID)
// The version nibble (bits 48-51 = 0x8) and variant (bits 64-65 = 10xx) are
// auto-forced at emit; layouts need not declare them.

export type FieldType =
  | "timestamp-ms"
  | "timestamp-us"
  | "counter"
  | "shard"
  | "node"
  | "process"
  | "fixed"
  | "random"

export interface V8FieldConstraint {
  allowed?: number[]
  min?: number
  max?: number
  monotonic?: boolean
}

export interface V8Field {
  name: string
  // bit index, MSB-first, 0..127
  start: number
  // bits, > 0
  length: number
  type: FieldType
  constraint?: V8FieldConstraint
  // for "fixed"
  value?: number
}

export interface V8Layout {
  name: string
  fields: V8Field[]
}

const MAX_FIELD_BITS = 48
const NIBBLE_BITS = new Set([48, 49, 50, 51, 64, 65])

export function validateLayout(layout: V8Layout): void {
  const covered = new Array<boolean>(128).fill(false)
  for (const f of layout.fields) {
    if (f.start < 0 || f.start + f.length > 128) {
      throw new Error(`layout ${layout.name}: field ${f.name} out of range`)
    }
    if (f.length <= 0) {
      throw new Error(`layout ${layout.name}: field ${f.name} length<=0`)
    }
    if (f.type !== "random" && f.type !== "fixed" && f.length > MAX_FIELD_BITS) {
      throw new Error(
        `layout ${layout.name}: structured field ${f.name} length ${f.length} > ${MAX_FIELD_BITS}`,
      )
    }
    for (let i = 0; i < f.length; i++) {
      const bit = f.start + i
      // The version nibble (bits 48-51) and variant (bits 64-65) are
      // reserved by RFC 9562 and auto-forced at emit — fields must not
      // overlap them, or composition would corrupt the v8 marker.
      if (NIBBLE_BITS.has(bit)) {
        throw new Error(
          `layout ${layout.name}: field ${f.name} overlaps reserved v8 nibble bit ${bit}`,
        )
      }
      covered[bit] = true
    }
  }
  for (let i = 0; i < 128; i++) {
    if (!covered[i] && !NIBBLE_BITS.has(i)) {
      throw new Error(`layout ${layout.name}: bit ${i} not covered by any field`)
    }
  }
}

export function getFieldValue(bytes: Uint8Array, f: V8Field): bigint {
  if (f.start + f.length > 128) throw new Error(`getFieldValue: field ${f.name} exceeds 128-bit UUID`)
  let v = 0n
  for (let i = 0; i < f.length; i++) {
    const pos = f.start + i
    const bitIdx = 7 - (pos & 7)
    v = (v << 1n) | BigInt((bytes[pos >> 3] >> bitIdx) & 1)
  }
  return v
}

interface WritePlanEntry {
  byte: number
  clearMask: number
  writeMask: number
  divisor: number
  bitOffset: number
}

const _fieldWritePlans = new WeakMap<V8Field, WritePlanEntry[]>()

function computeWritePlan(f: V8Field): WritePlanEntry[] {
  const s = f.start, l = f.length, e = s + l
  const entries: WritePlanEntry[] = []
  for (let b = s >> 3; b < (e + 7) >> 3; b++) {
    const first = Math.max(s, b << 3)
    const last = Math.min(e - 1, (b << 3) | 7)
    const n = last - first + 1
    const bit2 = 7 - (last & 7)
    const writeMask = ((1 << n) - 1) << bit2
    entries.push({
      byte: b,
      clearMask: ~writeMask & 0xff,
      writeMask,
      divisor: 2 ** (e - 1 - last),
      bitOffset: bit2,
    })
  }
  return entries
}

function getFieldWritePlan(f: V8Field): WritePlanEntry[] {
  let p = _fieldWritePlans.get(f)
  if (p) return p
  p = computeWritePlan(f)
  _fieldWritePlans.set(f, p)
  return p
}

function writeFieldValue(bytes: Uint8Array, f: V8Field, value: number): void {
  if (f.start + f.length > 128) throw new Error(`writeFieldValue: field ${f.name} exceeds 128-bit UUID`)
  const plan = getFieldWritePlan(f)
  for (const e of plan) {
    bytes[e.byte] = (bytes[e.byte] & e.clearMask) | ((Math.floor(value / e.divisor) << e.bitOffset) & e.writeMask)
  }
}

// Copy field `f` from `src` into `dst` bit-for-bit using only byte/bit
// Number ops (no BigInt allocation). Used on the hot composition path where
// fields can exceed 32 bits — this is what keeps crossover cheap.
export function copyField(
  dst: Uint8Array,
  src: Uint8Array,
  f: V8Field,
): void {
  if (f.start + f.length > 128) throw new Error(`copyField: field ${f.name} exceeds 128-bit UUID`)
  const end = f.start + f.length
  const startByte = f.start >> 3
  const endByte = (end + 7) >> 3
  const leadBits = f.start & 7
  const trailBits = end & 7

  // Leading partial byte
  if (leadBits !== 0) {
    const count = Math.min(8 - leadBits, f.length)
    for (let i = 0; i < count; i++) {
      const pos = f.start + i
      const bit = (src[pos >> 3] >> (7 - (pos & 7))) & 1
      const dByte = pos >> 3
      const dBit = 7 - (pos & 7)
      if (bit) dst[dByte] |= 1 << dBit
      else dst[dByte] &= ~(1 << dBit)
    }
  }

  // Bulk-copy full middle bytes
  const midStart = startByte + (leadBits !== 0 ? 1 : 0)
  const midEnd = endByte - (trailBits !== 0 ? 1 : 0)
  if (midEnd > midStart) {
    if (dst.buffer === src.buffer && dst.byteOffset !== src.byteOffset) {
      for (let i = midStart; i < midEnd; i++) dst[i] = src[i]
    } else {
      dst.set(src.subarray(midStart, midEnd), midStart)
    }
  }

  // Trailing partial byte
  if (trailBits !== 0) {
    const startBitInField = f.length - trailBits
    for (let i = startBitInField; i < f.length; i++) {
      const pos = f.start + i
      const bit = (src[pos >> 3] >> (7 - (pos & 7))) & 1
      const dByte = pos >> 3
      const dBit = 7 - (pos & 7)
      if (bit) dst[dByte] |= 1 << dBit
      else dst[dByte] &= ~(1 << dBit)
    }
  }
}

export function forceVersionVariant(bytes: Uint8Array): void {
  if (bytes.length < 9) throw new Error(`forceVersionVariant: expected ≥9 bytes, got ${bytes.length}`)
  bytes[6] = (bytes[6] & 0x0f) | 0x80
  bytes[8] = (bytes[8] & 0x3f) | 0x80
}

// Precomputed per-byte masks for a field (cached per V8Field). Each entry says
// "within byte `byte`, these bits (mask) belong to this field." Used to assemble
// a child UUID by masking+ORing parent bytes — replaces the per-bit copyField
// loop on the composition hot path with a small fixed number of byte ops.
interface ByteMask {
  byte: number
  mask: number
}
const _fieldByteMasks = new WeakMap<V8Field, ByteMask[]>()
function fieldByteMasks(f: V8Field): ByteMask[] {
  let m = _fieldByteMasks.get(f)
  if (m) return m
  m = []
  const start = f.start
  const end = f.start + f.length
  const endByte = (end + 7) >> 3
  for (let b = start >> 3; b < endByte; b++) {
    let mask = 0
    for (let bit = 0; bit < 8; bit++) {
      const pos = b * 8 + bit
      if (pos >= start && pos < end) mask |= 1 << (7 - bit)
    }
    if (mask) m.push({ byte: b, mask })
  }
  _fieldByteMasks.set(f, m)
  return m
}

export function uuidToBytes(uuid: string): Uint8Array {
  const h = uuid.replaceAll("-", "")
  if (!/^[0-9a-fA-F]{32}$/.test(h)) {
    throw new Error(`uuidToBytes: invalid UUID hex string "${uuid}"`)
  }
  const b = new Uint8Array(16)
  for (let j = 0; j < 16; j++) b[j] = Number.parseInt(h.slice(j * 2, j * 2 + 2), 16)
  return b
}

// Extract only the layout's `random`-type bits from a UUID, as an ordered
// "0/1" string (field order, MSB-first per byte). Used for NIST bit-stream
// export; the canonical home keeps layout-aware extraction in one place.
export function uuidToRandomBits(uuid: string, layout: V8Layout): string {
  const b = uuidToBytes(uuid)
  let bits = ""
  for (const f of layout.fields) {
    if (f.type !== "random") continue
    for (let bit = 0; bit < f.length; bit++) {
      const pos = f.start + bit
      bits += ((b[pos >> 3] >> (7 - (pos & 7))) & 1).toString()
    }
  }
  return bits
}

// Inverse of the structured generators: read each field's integer value from a
// UUID string, keyed by field name. Uses `getFieldValue` (exact BigInt), so it
// is safe for fields wider than 32 bits — the same path the truncation bug
// lived on, now exercised by the test suite.
export function readStructured(uuid: string, layout: V8Layout): Record<string, number> {
  const b = uuidToBytes(uuid)
  const out: Record<string, number> = {}
  for (const f of layout.fields) {
    out[f.name] = Number(getFieldValue(b, f))
  }
  return out
}

/**
 * Fill any gaps left by the caller's declared fields (including the reserved
 * v8 nibble bits) with `random`-type filler fields so the layout covers all
 * 128 UUID bits. Returns a new layout; the input is not mutated.
 */
export function completeLayout(name: string, fields: V8Field[]): V8Layout {
  const covered = new Array<boolean>(128).fill(false)
  for (const f of fields) {
    for (let i = 0; i < f.length; i++) covered[f.start + i] = true
  }
  for (const i of NIBBLE_BITS) covered[i] = true
  const out: V8Field[] = [...fields]
  let i = 0
  while (i < 128) {
    if (covered[i]) {
      i++
      continue
    }
    let j = i
    while (j < 128 && !covered[j]) j++
    out.push({ name: `rand_${i}`, start: i, length: j - i, type: "random" })
    i = j
  }
  return { name, fields: out }
}

function csprngInt(maxExclusive: number): number {
  if (maxExclusive <= 256) {
    if (_csprngPos >= _csprngBuf.length) {
      fillRandom(_csprngBuf)
      _csprngPos = 0
    }
    return _csprngBuf[_csprngPos++] % maxExclusive
  }
  const need = maxExclusive <= 65536 ? 2 : 6
  if (_csprngPos + need > _csprngBuf.length) {
    fillRandom(_csprngBuf)
    _csprngPos = 0
  }
  let v = 0
  for (let i = 0; i < need; i++) v = v * 256 + _csprngBuf[_csprngPos++]
  return v % maxExclusive
}

const _counters = new Map<string, number>()
const _lastValues = new Map<string, number>()
const _csprngBuf = new Uint8Array(256)
// Position starts at the end so csprngInt() triggers the first fillRandom()
// refill lazily. Only pre-fill eagerly when Web Crypto is present (embedded
// hosts inject their CSPRNG via configureRandom() before the first draw).
let _csprngPos = _csprngBuf.length
if (_hasWebCrypto) {
  fillRandom(_csprngBuf)
  _csprngPos = 0
}

// Entropy source abstraction for structured-field population. The pool refill
// path reuses the ALREADY-CSPRNG pool bytes (one getRandomValues per 256 IDs)
// instead of issuing a fresh syscall per field — same entropy, no per-field
// syscall. genStructuredParent (no pool) falls back to the csprng buffer.
type Rng = () => number

function poolRng(buf: Uint8Array, start: number, end: number): Rng {
  let i = start
  return () => {
    if (i >= end) i = start
    return buf[i++]
  }
}

// Draw a width-matched unsigned integer from `rng` in [0, mod). Consumes
// ceil(log2(mod)/8) bytes so a 16-bit field gets 2 bytes, a 24-bit field 3,
// etc. — preserving the FULL declared field entropy (the original per-field
// csprngInt path did the same). A single-byte rng() would silently cap any
// field > 8 bits at 256 values, so we always accumulate enough bytes.
function drawValue(rng: Rng, mod: number): number {
  if (mod <= 256) return rng() % mod
  let need = 1
  while ((1 << (need * 8)) < mod) need++
  let v = 0
  for (let i = 0; i < need; i++) v = v * 256 + rng()
  return v % mod
}

// Unbiased pick from a small `allowed` set (Lemire-style, avoids modulo bias
// when allowed.length does not divide the byte range).
// Unbiased pick from a small `allowed` set via rejection debiasing: discard the
// top of the byte range that does not divide evenly by n, so every member is
// equiprobable. One byte per draw plus a rare reject when n ∤ 256.
//
// Replaces a Lemire-style variant that collapsed ~98% of draws onto allowed[0]
// — i.e. shard/tenant fields were effectively constant. Pinned by INV-11 in
// scripts/research-invariants.test.ts (allowed-set uniformity).
function pickFrom(rng: Rng, allowed: number[]): number {
  const n = allowed.length
  if (n === 1) return allowed[0]
  const limit = 256 - (256 % n)
  let x = rng()
  while (x >= limit) x = rng()
  return allowed[x % n]
}

const _fieldMod = new WeakMap<V8Field, number>()

function fieldMod(f: V8Field): number {
  let m = _fieldMod.get(f)
  if (m === undefined) {
    m = f.length < 32 ? 1 << f.length : 2 ** f.length
    _fieldMod.set(f, m)
  }
  return m
}

// All structured field values fit in a Number (< 2^53; validateLayout caps
// structured fields at 48 bits), so plain Number arithmetic is exact and far
// cheaper than BigInt on the generation hot path.
function structuredValue(layout: V8Layout, f: V8Field, rng: Rng): number {
  const mod = fieldMod(f)
  switch (f.type) {
    case "timestamp-ms": {
      return Date.now() % mod
    }
    case "timestamp-us": {
      return (Date.now() * 1000) % mod
    }
    case "counter": {
      const key = layout.name + ":" + f.name
      const cur = (_counters.get(key) ?? 0) + 1
      _counters.set(key, cur)
      return cur % mod
    }
    case "shard": {
      const a = f.constraint?.allowed
      if (a && a.length > 0) return pickFrom(rng, a) % mod
      return drawValue(rng, mod)
    }
    case "node":
    case "process": {
      return drawValue(rng, mod)
    }
    default: {
      return 0
    }
  }
}

const _validated = new Set<string>()

function ensureValidated(layout: V8Layout): void {
  if (!_validated.has(layout.name)) {
    validateLayout(layout)
    _validated.add(layout.name)
  }
}

// Populate every structured/fixed field of `bytes` per its declared type.
// When `mask` is supplied, only the named field indices are written (the
// buffer is assumed pre-filled with CSPRNG bytes — used by single-parent
// construction); when omitted, all non-random fields are written (used by the
// pool refill, where both parents must carry independent structured values).
function applyStructuredFields(
  bytes: Uint8Array,
  layout: V8Layout,
  mask?: number[],
  rng: Rng = () => csprngInt(256),
): void {
  const fields = layout.fields
  const nf = fields.length
  if (mask) {
    for (let fi = 0; fi < nf; fi++) {
      const f = fields[fi]
      if (!mask.includes(fi)) continue
      if (f.type === "fixed") writeFieldValue(bytes, f, f.value ?? 0)
      else if (f.type !== "random") writeFieldValue(bytes, f, structuredValue(layout, f, rng))
    }
  } else {
    for (let fi = 0; fi < nf; fi++) {
      const f = fields[fi]
      if (f.type === "fixed") writeFieldValue(bytes, f, f.value ?? 0)
      else if (f.type !== "random") writeFieldValue(bytes, f, structuredValue(layout, f, rng))
    }
  }
}

/**
 * Build one valid v8 UUID parent. Fields whose index is in `mask` are
 * populated per their declared type; all other fields receive CSPRNG bytes.
 */
export function genStructuredParent(
  layout: V8Layout,
  mask: number[],
): Uint8Array {
  ensureValidated(layout)
  const bytes = new Uint8Array(16)
  fillRandom(bytes)
  applyStructuredFields(bytes, layout, mask)
  forceVersionVariant(bytes)
  return bytes
}

/**
 * Compose a child v8 UUID from two parents using field-boundary crossover.
 * `fieldSelect` bit i selects whether field i is taken from parentA (1) or
 * parentB (0). Because each structured field lives in exactly one parent,
 * the child inherits every structured field from one source — no field is
 * ever split across parents.
 */
export function composeStructured(
  layout: V8Layout,
  parentA: Uint8Array,
  parentB: Uint8Array,
  fieldSelect: number,
): Uint8Array {
  ensureValidated(layout)
  const child = new Uint8Array(16)
  for (const [fi, f] of layout.fields.entries()) {
    const takeA = ((fieldSelect >> fi) & 1) === 1
    copyField(child, takeA ? parentA : parentB, f)
  }
  forceVersionVariant(child)
  return child
}

function hamming(a: number, b: number, bits: number): number {
  let d = 0
  for (let i = 0; i < bits; i++) {
    if (((a >> i) ^ (b >> i)) & 1) d++
  }
  return d
}

/**
 * Repair per-field constraint violations in place. Returns the number of
 * fields repaired. Cost is O(sum of constrained field lengths) — independent
 * of how many other fields exist, unlike rejection sampling.
 */
export function repairConstraints(layout: V8Layout, bytes: Uint8Array): number {
  let repairs = 0
  for (const f of layout.fields) {
    const c = f.constraint
    if (!c) continue
    let v = Number(getFieldValue(bytes, f))
    let changed = false
    if (c.allowed && c.allowed.length > 0 && !c.allowed.includes(v)) {
      let best = c.allowed[0]
      let bestD = Infinity
      for (const a of c.allowed) {
        const d = hamming(v, a, f.length)
        if (d < bestD) {
          bestD = d
          best = a
        }
      }
      v = best
      changed = true
    }
    if (c.min !== undefined && v < c.min) {
      v = c.min
      changed = true
    }
    if (c.max !== undefined && v > c.max) {
      v = c.max
      changed = true
    }
    if (c.monotonic) {
      const key = layout.name + ":" + f.name
      const last = _lastValues.get(key) ?? 0
      if (v < last) {
        v = last
        changed = true
      }
      _lastValues.set(key, v)
    }
    if (changed) {
      writeFieldValue(bytes, f, v)
      repairs++
    }
  }
  return repairs
}

let _structPoolN = STRUCT_POOL_DEFAULT
const STRUCT_ENTRY = 34
const _structChild = new Uint8Array(16)
// Snapshot buffers for the pooled structured-field entropy source. The parent
// buffers A/B double as both the CSPRNG entropy and the write target; a field
// written earlier (e.g. timestamp) would otherwise clobber the very bytes a
// later allowed-field (e.g. shard) reads as its randomness — collapsing that
// field to a constant. We copy the original CSPRNG bytes here and draw from the
// copy, so writes never poison downstream draws.
const _rngA = new Uint8Array(16)
const _rngB = new Uint8Array(16)
const _structPools = new Map<
  string,
  {
    pool: Uint8Array<ArrayBuffer>
    strs: string[]
    idx: number
    size: number
    needsRepair: boolean
    plan: ByteMask[][]
  }
>()

function getStructPool(layout: V8Layout): {
  pool: Uint8Array<ArrayBuffer>
  strs: string[]
  idx: number
  size: number
  needsRepair: boolean
  plan: ByteMask[][]
} {
  const existing = _structPools.get(layout.name)
  if (existing) return existing
  // Snapshot the current configured size into the pool entry so an in-flight
  // pool keeps a consistent size even if configurePools() runs later (it clears
  // the map, so the next getStructPool rebuilds at the new size).
  const size = _structPoolN
  const p = {
    pool: new Uint8Array(STRUCT_ENTRY * size),
    strs: new Array(size),
    idx: size,
    size,
    needsRepair: layout.fields.some((f) => f.type === "random" && f.constraint),
    // Precomputed per-field byte masks — built once per layout, reused for all
    // pool entries so the hot child-assembly loop never touches bits.
    plan: layout.fields.map(fieldByteMasks),
  }
  _structPools.set(layout.name, p)
  return p
}

/**
 * Production API: pool of structured parents + field-boundary crossover +
 * constraint repair. Every structured field is populated in BOTH pooled
 * parents (each independently generated) so that per-field crossover can pick
 * either parent without ever producing an unpopulated/garbage field. Random
 * fields stay CSPRNG in both parents and are what crossover actually mixes.
 */
export function genStructuredGenoID(layout: V8Layout): string {
  ensureValidated(layout)
  const p = getStructPool(layout)
  // Repair only matters for random fields that carry a constraint (allowed /
  // min / max) — structured fields are generated valid in both parents, so
  // crossover can never violate them. needsRepair is cached in the pool entry.
  if (p.idx >= p.size) {
    const fields = layout.fields
    const nf = fields.length
    const w = wordTable()
    fillRandom(p.pool)
    for (let n = 0; n < p.size; n++) {
      const off = n * STRUCT_ENTRY
      const A = p.pool.subarray(off, off + 16)
      const B = p.pool.subarray(off + 16, off + 32)
      const fieldSelect = p.pool[off + 32] | (p.pool[off + 33] << 8)
      // Every structured field populated independently in both parents, so
      // field-boundary crossover can pick either without producing garbage.
      // Entropy comes from the ALREADY-CSPRNG pool bytes (one getRandomValues
      // per 256 IDs) via disjoint cursor regions per parent — no per-field
      // syscall, same entropy as before.
      // Snapshot the original CSPRNG bytes so structured writes into A/B can't
      // poison the entropy that later fields draw (see _rngA/_rngB note).
      _rngA.set(A)
      _rngB.set(B)
      applyStructuredFields(A, layout, undefined, poolRng(_rngA, 0, 16))
      applyStructuredFields(B, layout, undefined, poolRng(_rngB, 0, 16))
      // Assemble the child by masking+ORing parent bytes per precomputed field
      // plan — replaces the per-bit copyField loop with a fixed set of byte ops.
      const child = _structChild
      child.fill(0)
      for (let fi = 0; fi < nf; fi++) {
        const src = ((fieldSelect >> fi) & 1) === 1 ? A : B
        for (const mk of p.plan[fi]) {
          child[mk.byte] |= src[mk.byte] & mk.mask
        }
      }
      if (p.needsRepair) repairConstraints(layout, child)
      forceVersionVariant(child)
      const c = _structChild, t = HEX8
      p.strs[n] = w
        ? w[(c[0] << 8) | c[1]] + w[(c[2] << 8) | c[3]] + "-" +
          w[(c[4] << 8) | c[5]] + "-" +
          w[(c[6] << 8) | c[7]] + "-" +
          w[(c[8] << 8) | c[9]] + "-" +
          w[(c[10] << 8) | c[11]] + w[(c[12] << 8) | c[13]] + w[(c[14] << 8) | c[15]]
        : t[c[0]] + t[c[1]] + t[c[2]] + t[c[3]] + "-" +
          t[c[4]] + t[c[5]] + "-" +
          t[c[6]] + t[c[7]] + "-" +
          t[c[8]] + t[c[9]] + "-" +
          t[c[10]] + t[c[11]] + t[c[12]] + t[c[13]] + t[c[14]] + t[c[15]]
    }
    p.idx = 0
  }
  return p.strs[p.idx++]
}

export interface PoolConfig {
  /** Simple genGenoID() pool size (IDs generated per CSPRNG refill). Default 256. */
  simplePoolSize?: number
  /** Per-layout genStructuredGenoID() pool size. Default 1024. */
  structuredPoolSize?: number
}

/**
 * Tune the generation pool sizes at runtime. Smaller pools cut resident memory
 * for constrained hosts — an ESP8266-class chip cannot spare the ~34KB byte
 * buffer plus ~1024 interned strings the default structured pool holds per
 * layout; larger pools amortize the CSPRNG refill over more IDs. Output is
 * byte-identical at any size — only the refill granularity changes, so there is
 * NO accuracy impact (distribution, constraints, and monotonic counters are
 * preserved because per-ID generation and the persisted `_lastValues` state are
 * unchanged).
 *
 * Sizes must be positive integers. Reconfiguring rebuilds the affected pools:
 * the simple pool is reallocated immediately; structured pools are cleared and
 * lazily rebuilt at the new size on the next genStructuredGenoID() call.
 *
 * @example
 * // ESP8266-class budget: tiny pools
 * configurePools({ simplePoolSize: 16, structuredPoolSize: 8 })
 */
export function configurePools(cfg: PoolConfig): void {
  if (cfg.simplePoolSize !== undefined) {
    const n = cfg.simplePoolSize
    if (!Number.isInteger(n) || n < 1) {
      throw new Error(`configurePools: simplePoolSize must be a positive integer, got ${n}`)
    }
    _genoPoolN = n
    _genoPool = new Uint8Array(GENO_ENTRY_BYTES * n)
    _genoStrs = new Array<string>(n)
    // force a refill on the next genGenoID()
    _genoIdx = n
  }
  if (cfg.structuredPoolSize !== undefined) {
    const n = cfg.structuredPoolSize
    if (!Number.isInteger(n) || n < 1) {
      throw new Error(`configurePools: structuredPoolSize must be a positive integer, got ${n}`)
    }
    _structPoolN = n
    // rebuilt lazily at the new size, per layout
    _structPools.clear()
  }
}

/** Current effective pool sizes — useful for tests and memory budgeting. */
export function getPoolConfig(): { simplePoolSize: number; structuredPoolSize: number } {
  return { simplePoolSize: _genoPoolN, structuredPoolSize: _structPoolN }
}

// ---------------------------------------------------------------------------
// Canonical structured layouts (single source of truth).
//
// These are the layouts used across the benchmark/export/research scripts and
// the browser runner. They are defined once here — the module that owns
// `completeLayout` and the structured framework — so every consumer imports
// the identical object instead of re-declaring it inline (the dbkey layout was
// previously copy-pasted into 11 sites).
// ---------------------------------------------------------------------------

/** 48-bit timestamp + 8-bit shard (1-5) + 16-bit monotonic counter. */
export const DBKEY_LAYOUT: V8Layout = completeLayout("dbkey", [
  { name: "timestamp", start: 0, length: 48, type: "timestamp-ms" },
  { name: "shard", start: 52, length: 8, type: "shard", constraint: { allowed: [1, 2, 3, 4, 5] } },
  { name: "counter", start: 66, length: 16, type: "counter", constraint: { monotonic: true } },
])

/** 12-bit tenant (1-8) + 8-bit region (1-4). */
export const MULTITENANT_LAYOUT: V8Layout = completeLayout("multitenant", [
  { name: "tenant", start: 0, length: 12, type: "shard", constraint: { allowed: [1, 2, 3, 4, 5, 6, 7, 8] } },
  { name: "region", start: 52, length: 8, type: "shard", constraint: { allowed: [1, 2, 3, 4] } },
])

/** 16-bit stream node + 24-bit monotonic sequence. */
export const EVENTSOURCING_LAYOUT: V8Layout = completeLayout("eventsourcing", [
  { name: "stream", start: 0, length: 16, type: "node" },
  { name: "seq", start: 66, length: 24, type: "counter", constraint: { monotonic: true } },
])
