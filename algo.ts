const HEX16: string[] = Array.from({ length: 65536 }, (_, i) =>
  i.toString(16).padStart(4, "0"),
)

export function toUuidString(b: Uint8Array): string {
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

export function genV7(): string {
  const rnd = new Uint8Array(10)
  crypto.getRandomValues(rnd)
  const ts = Date.now()
  const bytes = new Uint8Array(16)
  bytes[0] = (ts / 2 ** 40) & 0xff
  bytes[1] = (ts / 2 ** 32) & 0xff
  bytes[2] = (ts / 2 ** 24) & 0xff
  bytes[3] = (ts / 2 ** 16) & 0xff
  bytes[4] = (ts / 2 ** 8) & 0xff
  bytes[5] = ts & 0xff
  bytes.set(rnd, 6)
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
  const digest = await crypto.subtle.digest("SHA-256", seed)
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
const HEX16_VIEW: string[] = Array.from({ length: 65536 })
{
  const probe = new Uint8Array(2)
  const probeView = new Uint16Array(probe.buffer)
  for (let hi = 0; hi < 256; hi++) {
    for (let lo = 0; lo < 256; lo++) {
      probe[0] = hi
      probe[1] = lo
      HEX16_VIEW[probeView[0]] =
        hi.toString(16).padStart(2, "0") + lo.toString(16).padStart(2, "0")
    }
  }
}

export function genGenoID(): string {
  if (_genoIdx >= GENO_POOL_N) {
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
  for (let i = 0; i < f.length; i++) {
    const sp = f.start + i
    const bit = (src[sp >> 3] >> (7 - (sp & 7))) & 1
    const dp = f.start + i
    const dByte = dp >> 3
    const dBit = 7 - (dp & 7)
    if (bit) dst[dByte] |= 1 << dBit
    else dst[dByte] &= ~(1 << dBit)
  }
}

export function forceVersionVariant(bytes: Uint8Array): void {
  bytes[6] = (bytes[6] & 0x0f) | 0x80
  bytes[8] = (bytes[8] & 0x3f) | 0x80
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
  if (_csprngPos + 6 > _csprngBuf.length) {
    crypto.getRandomValues(_csprngBuf)
    _csprngPos = 0
  }
  let v = 0
  for (let i = 0; i < 6; i++) v = v * 256 + _csprngBuf[_csprngPos++]
  return v % maxExclusive
}

const _counters = new Map<string, number>()
const _lastValues = new Map<string, number>()
const _csprngBuf = new Uint8Array(256)
let _csprngPos = 0

// All structured field values fit in a Number (< 2^53; validateLayout caps
// structured fields at 48 bits), so plain Number arithmetic is exact and far
// cheaper than BigInt on the generation hot path.
function structuredValue(layout: V8Layout, f: V8Field): number {
  const mod = Math.pow(2, f.length)
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
      if (a && a.length > 0) return a[csprngInt(a.length)] % mod
      return csprngInt(mod)
    }
    case "node":
    case "process": {
      return csprngInt(mod)
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
  const maskSet = new Set(mask)
  for (const [fi, f] of layout.fields.entries()) {
    if (!maskSet.has(fi)) continue
    if (f.type === "fixed") setFieldBytes(bytes, f, f.value ?? 0)
    else setFieldBytes(bytes, f, structuredValue(layout, f))
  }
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
const _structPools = new Map<
  string,
  { pool: Uint8Array<ArrayBuffer>; strs: string[]; idx: number }
>()

function getStructPool(layout: V8Layout) {
  let p = _structPools.get(layout.name)
  if (!p) {
    p = {
      pool: new Uint8Array(STRUCT_ENTRY * STRUCT_POOL_N),
      strs: new Array(STRUCT_POOL_N),
      idx: STRUCT_POOL_N,
    }
    _structPools.set(layout.name, p)
  }
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
  // crossover can never violate them.
  const needsRepair = layout.fields.some(
    (f) => f.type === "random" && f.constraint,
  )
  if (p.idx >= STRUCT_POOL_N) {
    crypto.getRandomValues(p.pool)
    for (let n = 0; n < STRUCT_POOL_N; n++) {
      const off = n * STRUCT_ENTRY
      const A = p.pool.subarray(off, off + 16)
      const B = p.pool.subarray(off + 16, off + 32)
      const fieldSelect = p.pool[off + 32] | (p.pool[off + 33] << 8)
      for (const f of layout.fields) {
        if (f.type === "fixed") {
          setFieldBytes(A, f, f.value ?? 0)
          setFieldBytes(B, f, f.value ?? 0)
        } else if (f.type !== "random") {
          // Independent structured value in each parent.
          setFieldBytes(A, f, structuredValue(layout, f))
          setFieldBytes(B, f, structuredValue(layout, f))
        }
      }
      const child = new Uint8Array(16)
      for (const [fi, f] of layout.fields.entries()) {
        const takeA = ((fieldSelect >> fi) & 1) === 1
        copyField(child, takeA ? A : B, f)
      }
      if (needsRepair) repairConstraints(layout, child)
      forceVersionVariant(child)
      p.strs[n] = toUuidString(child)
    }
    p.idx = 0
  }
  return p.strs[p.idx++]
}
