const HEX16: string[] = Array.from({ length: 65536 }, (_, i) =>
  i.toString(16).padStart(4, "0"),
)

export function toUuidString(b: Uint8Array): string {
  if (b.length < 16) throw new Error(`toUuidString: expected 16 bytes, got ${b.length}`)
  const w0 = (b[0] << 8) | b[1],
    w1 = (b[2] << 8) | b[3],
    w2 = (b[4] << 8) | b[5],
    w3 = (b[6] << 8) | b[7],
    w4 = (b[8] << 8) | b[9],
    w5 = (b[10] << 8) | b[11],
    w6 = (b[12] << 8) | b[13],
    w7 = (b[14] << 8) | b[15]
  return (
    HEX16[w0] +
    HEX16[w1] +
    "-" +
    HEX16[w2] +
    "-" +
    HEX16[w3] +
    "-" +
    HEX16[w4] +
    "-" +
    HEX16[w5] +
    HEX16[w6] +
    HEX16[w7]
  )
}

export function genV4Native(): string {
  return crypto.randomUUID()
}

const _v7Rnd = new Uint8Array(10)
const _v7Bytes = new Uint8Array(16)

export function genV7(): string {
  crypto.getRandomValues(_v7Rnd)
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
  crypto.getRandomValues(seed)
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

const GENO_POOL_N = 256
const GENO_ENTRY_BYTES = 34
const _genoPool = new Uint8Array(GENO_ENTRY_BYTES * GENO_POOL_N)
const _genoStrs = new Array<string>(GENO_POOL_N)
let _genoIdx = GENO_POOL_N
const _child = new Uint8Array(16)
const _child16 = new Uint16Array(_child.buffer)
const HEX16_VIEW: string[] = Array.from({ length: 65536 }, (_, i) =>
  (i & 0xff).toString(16).padStart(2, "0") + ((i >> 8) & 0xff).toString(16).padStart(2, "0"),
)

function refillGenoPool(): void {
  const t = HEX16_VIEW, g = _genoPool, e = GENO_ENTRY_BYTES
  crypto.getRandomValues(g)
  for (let i = 0; i < GENO_POOL_N; i++) {
    const off = i * e
    const cut = g[off + 32] & 15
    const mutPos = g[off + 33] & 15
    let j = 0
    for (; j < cut; j++) _child[j] = g[off + j]
    for (; j < 16; j++) _child[j] = g[off + 16 + j]
    _child[mutPos] ^= g[off + ((mutPos + 1) & 15)]
    _child[6] = (_child[6] & 0x0f) | 0x80
    _child[8] = (_child[8] & 0x3f) | 0x80
    const v = _child16
    _genoStrs[i] =
      t[v[0]] + t[v[1]] + "-" +
      t[v[2]] + "-" +
      t[v[3]] + "-" +
      t[v[4]] + "-" +
      t[v[5]] + t[v[6]] + t[v[7]]
  }
  _genoIdx = 0
}

// Pre-warm the GenoID pool at module init so the first call is never cold.
// Same pattern as _csprngBuf pre-fill.
refillGenoPool()

export function genGenoID(): string {
  if (_genoIdx >= GENO_POOL_N) {
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

// Write a non-negative integer `value` (assumed to fit in < 2^53 and within
// the field's bit width) into field `f` of `bytes`, bit-by-bit with plain
// Number arithmetic. Avoids BigInt so the structured-field population step on
// the generation hot path stays cheap.
function setFieldBytes(
  bytes: Uint8Array,
  f: V8Field,
  value: number,
): void {
  if (f.start + f.length > 128) throw new Error(`setFieldBytes: field ${f.name} exceeds 128-bit UUID`)
  let v = value
  const n = f.length
  for (let k = 0; k < n; k++) {
    const bit = v & 1
    const pos = f.start + (n - 1 - k)
    const byteIdx = pos >> 3
    const bitIdx = 7 - (pos & 7)
    if (bit) bytes[byteIdx] |= 1 << bitIdx
    else bytes[byteIdx] &= ~(1 << bitIdx)
    v = Math.floor(v / 2)
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
      crypto.getRandomValues(_csprngBuf)
      _csprngPos = 0
    }
    return _csprngBuf[_csprngPos++] % maxExclusive
  }
  const need = maxExclusive <= 65536 ? 2 : 6
  if (_csprngPos + need > _csprngBuf.length) {
    crypto.getRandomValues(_csprngBuf)
    _csprngPos = 0
  }
  let v = 0
  for (let i = 0; i < need; i++) v = v * 256 + _csprngBuf[_csprngPos++]
  return v % maxExclusive
}

const _counters = new Map<string, number>()
const _lastValues = new Map<string, number>()
const _csprngBuf = new Uint8Array(256)
crypto.getRandomValues(_csprngBuf)
let _csprngPos = 0

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
function pickFrom(rng: Rng, allowed: number[]): number {
  const n = allowed.length
  if (n === 1) return allowed[0]
  const frac = 0.00392156862745098
  let x = rng()
  let prod = frac
  let i = 256
  while (true) {
    if (x < i * n * prod) return allowed[Math.floor((x / (i * prod)) | 0)]
    x = (x - i * n * prod) * 256
    i *= 256
    prod *= frac
  }
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
      if (f.type === "fixed") setFieldBytes(bytes, f, f.value ?? 0)
      else if (f.type !== "random") setFieldBytes(bytes, f, structuredValue(layout, f, rng))
    }
  } else {
    for (let fi = 0; fi < nf; fi++) {
      const f = fields[fi]
      if (f.type === "fixed") setFieldBytes(bytes, f, f.value ?? 0)
      else if (f.type !== "random") setFieldBytes(bytes, f, structuredValue(layout, f, rng))
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
  crypto.getRandomValues(bytes)
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
      setFieldBytes(bytes, f, v)
      repairs++
    }
  }
  return repairs
}

const STRUCT_POOL_N = 256
const STRUCT_ENTRY = 34
const _structChild = new Uint8Array(16)
const _structPools = new Map<
  string,
  {
    pool: Uint8Array<ArrayBuffer>
    strs: string[]
    idx: number
    needsRepair: boolean
    plan: ByteMask[][]
  }
>()

function getStructPool(layout: V8Layout): {
  pool: Uint8Array<ArrayBuffer>
  strs: string[]
  idx: number
  needsRepair: boolean
  plan: ByteMask[][]
} {
  const existing = _structPools.get(layout.name)
  if (existing) return existing
  const p = {
    pool: new Uint8Array(STRUCT_ENTRY * STRUCT_POOL_N),
    strs: new Array(STRUCT_POOL_N),
    idx: STRUCT_POOL_N,
    needsRepair: layout.fields.some((f) => f.type === "random" && f.constraint),
    // Precomputed per-field byte masks — built once per layout, reused for all
    // 256 pool entries so the hot child-assembly loop never touches bits.
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
  if (p.idx >= STRUCT_POOL_N) {
    const fields = layout.fields
    const nf = fields.length
    crypto.getRandomValues(p.pool)
    for (let n = 0; n < STRUCT_POOL_N; n++) {
      const off = n * STRUCT_ENTRY
      const A = p.pool.subarray(off, off + 16)
      const B = p.pool.subarray(off + 16, off + 32)
      const fieldSelect = p.pool[off + 32] | (p.pool[off + 33] << 8)
      // Every structured field populated independently in both parents, so
      // field-boundary crossover can pick either without producing garbage.
      // Entropy comes from the ALREADY-CSPRNG pool bytes (one getRandomValues
      // per 256 IDs) via disjoint cursor regions per parent — no per-field
      // syscall, same entropy as before.
      applyStructuredFields(A, layout, undefined, poolRng(p.pool, off, off + 16))
      applyStructuredFields(B, layout, undefined, poolRng(p.pool, off + 16, off + 32))
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
      p.strs[n] = toUuidString(child)
    }
    p.idx = 0
  }
  return p.strs[p.idx++]
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
