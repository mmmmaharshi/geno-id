import {
  andBits,
  orBits,
  shiftLeftBits,
  shiftRightBits,
  shiftRightUnsignedBits,
  xor32,
  xorByte,
} from "./shared/bitwise.js"
import {
  absentValue,
  isArray,
  isMissing,
  isRecord,
  need,
  nullValue,
} from "./shared/need.js"

export { and32, or32, xor32 } from "./shared/bitwise.js"
// Single 256-entry byte->hex table. Replaces the two 65536-entry word tables

// (HEX16 / HEX16_VIEW) that previously interned ~131k strings at import — far

// Past the heap budget of constrained MCUs (ESP8266 has ~40-80KB free). A

// 16-bit word formats as HEX8[hi] + HEX8[lo], byte-identical to the old tables.

// 256-entry byte->hex table. Always present (~256 tiny strings), it is the only

// Hex table a constrained host ("lean" footprint) ever allocates.

export const HEX8: string[] = Array.from({ length: 256 }, (_, i) =>
  i.toString(16).padStart(2, "0")
)

// Optional 65536-entry big-endian word->hex table (HEX8[hi] + HEX8[lo]). It is

// ~2x faster to format with (8 lookups/UUID instead of 16) but costs ~131k

// Interned strings — far past an ESP8266's heap. It is therefore built LAZILY

// On first use and can be disabled/freed via configureFootprint("lean") so a

// Constrained host never allocates it. Default is "fast" (build on demand).

let _wordTable: string[] | null = nullValue

let _leanFootprint = false

export const wordTable = (): string[] | null => {
  if (_leanFootprint) {
    return nullValue
  }

  if (_wordTable === nullValue) {
    const w = Array.from<string>({ length: 65_536 })

    for (let i = 0; i < 65_536; i += 1) {
      w[i] = HEX8[Math.trunc(i / 256)] + HEX8[i % 256]
    }

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
 *
 * @param {"fast" | "lean"} mode - Formatting footprint: `fast` or `lean`.
 */

export const configureFootprint = (mode: "fast" | "lean"): void => {
  if (mode === "lean") {
    _leanFootprint = true

    _wordTable = nullValue
  } else {
    _leanFootprint = false
  }
}

const formatUuidBytes = (
  b: Readonly<Uint8Array>,
  w: string[] | null,
  t: string[],
  o = 0
): string => {
  if (w) {
    return `${w[b[o] * 256 + b[o + 1]]}${w[b[o + 2] * 256 + b[o + 3]]}-${w[b[o + 4] * 256 + b[o + 5]]}-${w[b[o + 6] * 256 + b[o + 7]]}-${w[b[o + 8] * 256 + b[o + 9]]}-${w[b[o + 10] * 256 + b[o + 11]]}${w[b[o + 12] * 256 + b[o + 13]]}${w[b[o + 14] * 256 + b[o + 15]]}`
  }

  return `${t[b[o]]}${t[b[o + 1]]}${t[b[o + 2]]}${t[b[o + 3]]}-${t[b[o + 4]]}${t[b[o + 5]]}-${t[b[o + 6]]}${t[b[o + 7]]}-${t[b[o + 8]]}${t[b[o + 9]]}-${t[b[o + 10]]}${t[b[o + 11]]}${t[b[o + 12]]}${t[b[o + 13]]}${t[b[o + 14]]}${t[b[o + 15]]}`
}

export const toUuidString = (b: Readonly<Uint8Array>): string => {
  if (b.length < 16) {
    throw new Error(`toUuidString: expected 16 bytes, got ${b.length}`)
  }

  return formatUuidBytes(b, wordTable(), HEX8)
}

const freezeWaitSnippet = "while(Date.now()<=_tick){}"

const waitForNextTick = (lastTick: number): number => {
  // §6.2 freeze-and-wait: stall until the clock advances past the last tick.

  // Twin: genLayoutSource emits freezeWaitSnippet into compiled output.

  while (Date.now() <= lastTick) {
    // Intentional busy-wait
  }

  return Date.now()
}

export const genV4Native = (): string => crypto.randomUUID()

// --- Injectable CSPRNG ------------------------------------------------------

// Every GenoID entropy draw flows through this single sink. It defaults to Web

// Crypto (crypto.getRandomValues) on Node/Deno/Bun/browsers. Hosts without Web

// Crypto — ESP8266/ESP32 firmware, MicroPython, bare embedded runtimes — inject

// A platform CSPRNG via configureRandom() before generating any ID. The entropy

// Contract is unchanged (fill the whole buffer with secure random bytes), so

// Output distribution and collision guarantees are identical; only the byte

// Source changes. On a host without Web Crypto, module import no longer eagerly

// Draws entropy (the pre-warms below are guarded), so importing never throws —

// The first generate call after configureRandom() does the first fill.

export type RandomFill = (buf: Uint8Array) => void

const _hasWebCrypto =
  typeof crypto !== "undefined" && typeof crypto.getRandomValues === "function"

const _webCryptoFill: RandomFill = (buf) => {
  // GetRandomValues rejects SharedArrayBuffer-backed views; all GenoID buffers

  // Are ArrayBuffer-backed, so narrow the widened public Uint8Array type here.

  crypto.getRandomValues(buf as Uint8Array<ArrayBuffer>)
}

const _noRngFill: RandomFill = () => {
  throw new TypeError(
    "GenoID: no CSPRNG available — Web Crypto (crypto.getRandomValues) was not found on this host. " +
      "Call configureRandom(fn) with a platform CSPRNG (e.g. os.urandom on MicroPython, esp_fill_random on ESP-IDF) before generating IDs."
  )
}

const defaultRandomFill = (): RandomFill => {
  if (_hasWebCrypto) {
    return _webCryptoFill
  }

  return _noRngFill
}

let _fillRandom: RandomFill = defaultRandomFill()

let _injectedEntropy = false

const fillRandom = (buf: Uint8Array): void => {
  _fillRandom(buf)
}

const _csprngBuf = new Uint8Array(256)

let _csprngPos = _csprngBuf.length

const _poolMonoTick = new Map<string, number>()

const _layoutTick = new Map<string, number>()

const _spPool = new Map<
  string,
  {
    pool: Uint8Array<ArrayBuffer>
    strs: string[]
    idx: number
    size: number
  }
>()

const _compiledGenCache = new Map<string, () => string>()

const _layoutIdentities = new Map<string, string>()

export const resetSeededState = (): void => {
  _csprngPos = _csprngBuf.length

  _genoIdx = _genoPoolN

  _poolMonoTick.clear()

  _layoutTick.clear()

  _spPool.clear()

  _compiledGenCache.clear()

  _layoutIdentities.clear()
}

export const createSeededRandom = (
  seed0: number,
  seed1: number
): RandomFill => {
  let s0 = Math.trunc(seed0)

  let s1 = Math.trunc(seed1)

  return (buf: Uint8Array): void => {
    let off = 0

    while (off < buf.length) {
      let t = s1

      t = xor32(t, shiftLeftBits(t, 23))

      t = xor32(t, shiftRightUnsignedBits(t, 17))

      t = xor32(t, s0)

      t = xor32(t, shiftRightUnsignedBits(s0, 26))

      s0 = s1

      s1 = t

      buf[off] = s1 % 256

      off += 1

      if (off < buf.length) {
        buf[off] = shiftRightUnsignedBits(s1, 8) % 256
        off += 1
      }

      if (off < buf.length) {
        buf[off] = shiftRightUnsignedBits(s1, 16) % 256
        off += 1
      }

      if (off < buf.length) {
        buf[off] = shiftRightUnsignedBits(s1, 24) % 256
        off += 1
      }
    }
  }
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
 * configureRandom((buf) => { for (let i = 0; i < buf.length; i += 1) buf[i] = platformRandomByte() })
 *
 * @param {RandomFill | null} fn - Platform CSPRNG, or `null` to restore the default.
 */

export const configureRandom = (fn: RandomFill | null): void => {
  if (fn === nullValue) {
    _fillRandom = defaultRandomFill()

    _injectedEntropy = false

    _compiledGenCache.clear()

    return
  }

  if (typeof fn !== "function") {
    throw new TypeError(
      "configureRandom: expected a function (buf: Uint8Array) => void, or null to reset"
    )
  }

  _fillRandom = fn

  _injectedEntropy = true

  _compiledGenCache.clear()
}

export const getEntropySourceId = (): string => {
  if (_fillRandom === _noRngFill) {
    return "none"
  }

  if (_injectedEntropy) {
    return "injected"
  }

  return "pooled-csprng-v1"
}

const _v7Rnd = new Uint8Array(10)

const _v7Bytes = new Uint8Array(16)

export const genV7 = (): string => {
  fillRandom(_v7Rnd)

  const ts = Date.now()

  const bytes = _v7Bytes

  bytes[0] = Math.trunc(ts / 2 ** 40) % 256

  bytes[1] = Math.trunc(ts / 2 ** 32) % 256

  bytes[2] = Math.trunc(ts / 2 ** 24) % 256

  bytes[3] = Math.trunc(ts / 2 ** 16) % 256

  bytes[4] = Math.trunc(ts / 2 ** 8) % 256

  bytes[5] = ts % 256

  bytes.set(_v7Rnd, 6)

  bytes[6] = (bytes[6] % 16) + 0x70

  bytes[8] = (bytes[8] % 64) + 0x80

  return toUuidString(bytes)
}

export const genMathRandom = (): string =>
  "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replaceAll(
    /[xy]/gu,

    (c: string) => {
      const r = Math.trunc(Math.random() * 16)

      let value = r

      if (c !== "x") {
        value = (r % 4) + 8
      }

      return value.toString(16)
    }
  )

const digestSeed = async (seed: Readonly<Uint8Array>): Promise<ArrayBuffer> => {
  try {
    return await crypto.subtle.digest(
      "SHA-256",
      seed as Uint8Array<ArrayBuffer>
    )
  } catch (error) {
    throw new Error(
      `genHashUUID: SubtleCrypto unavailable — ${(error as Error).message}`,
      { cause: error }
    )
  }
}

export const genHashUUID = async (): Promise<string> => {
  const seed = new Uint8Array(32)

  fillRandom(seed)

  const digest = await digestSeed(seed)

  const bytes = new Uint8Array(digest).slice(0, 16)

  bytes[6] = (bytes[6] % 16) + 0x50

  bytes[8] = (bytes[8] % 64) + 0x80

  return toUuidString(bytes)
}

const GENO_ENTRY_BYTES = 34

// Default pool sizes. Runtime-tunable via configurePools() so a constrained

// Host (e.g. an ESP8266 with ~40-80KB free heap) can trade batch size for RAM:

// The simple pool holds GENO_ENTRY_BYTES*N bytes + N interned strings; each

// Structured layout holds STRUCT_ENTRY*N bytes + N strings. Shrinking N only

// Changes refill granularity — per-ID generation and emitted output are

// Byte-identical at any pool size.

const GENO_POOL_DEFAULT = 256

const STRUCT_POOL_DEFAULT = 1024

let _genoPoolN = GENO_POOL_DEFAULT

let _genoPool = new Uint8Array(GENO_ENTRY_BYTES * _genoPoolN)

let _genoStrs = Array.from<string>({ length: _genoPoolN })

let _genoIdx = _genoPoolN

const _child = new Uint8Array(16)

export const scrambleByte = (b: number): number =>
  xorByte(b, andBits(orBits(shiftLeftBits(b, 3), shiftRightBits(b, 5)), 0xff))

export const mutateChildBytes = (
  child: Uint8Array,
  mutPos: number,
  mixByte: number,
  useScramble: boolean
): void => {
  const mix = useScramble ? scrambleByte(mixByte) : mixByte

  child[mutPos] = xorByte(child[mutPos], mix)
}

const refillGenoPool = (): void => {
  const e = GENO_ENTRY_BYTES,
    g = _genoPool,
    t = HEX8,
    w = wordTable()

  fillRandom(g)

  for (let i = 0; i < _genoPoolN; i += 1) {
    const off = i * e

    const cut = g[off + 32] % 16

    const mutPos = g[off + 33] % 16

    let j = 0

    for (; j < cut; j += 1) {
      _child[j] = g[off + j]
    }

    for (; j < 16; j += 1) {
      _child[j] = g[off + 16 + j]
    }

    mutateChildBytes(_child, mutPos, g[off + ((mutPos + 1) % 16)], true)

    _child[6] = (_child[6] % 16) + 0x80

    _child[8] = (_child[8] % 64) + 0x80

    const c = _child

    _genoStrs[i] = formatUuidBytes(c, w, t)
  }

  _genoIdx = 0
}

// Pre-warm the GenoID pool at module init so the first call is never cold.

// Guarded: on a host without Web Crypto this would throw at import; there we

// Defer the first fill to the first genGenoID() (after configureRandom()), so

// _genoIdx stays at _genoPoolN and the next call refills.

if (_hasWebCrypto) {
  refillGenoPool()
}

export const genGenoID = (): string => {
  if (_genoIdx >= _genoPoolN) {
    refillGenoPool()
  }

  const uuid = _genoStrs[_genoIdx]

  _genoIdx += 1
  return uuid
}

// ---------- Structured RFC 9562 v8 composition framework ----------

//

// GenoID's GA operators are repurposed as a *composition + repair* framework:

//   - crossover  = field-boundary composition operator (merges structured

//                  Fields from two complementary parents into one valid v8 UUID)

//   - mutation   = constraint-repair operator (flips field bits to satisfy

//                  Per-field constraints without regenerating the whole UUID)

// The version nibble (bits 48-51 = 0x8) and variant (bits 64-65 = 10xx) are

// Auto-forced at emit; layouts need not declare them.

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

  // Bit index, MSB-first, 0..127

  start: number

  // Bits, > 0

  length: number

  type: FieldType

  constraint?: V8FieldConstraint

  // For "fixed"

  value?: number
}

export interface V8Layout {
  name: string

  fields: V8Field[]
}

type ReadonlyV8Constraint = Readonly<Omit<V8FieldConstraint, "allowed">> & {
  readonly allowed?: readonly number[]
}

type ReadonlyV8Field = Readonly<Omit<V8Field, "constraint">> & {
  readonly constraint?: ReadonlyV8Constraint
}

interface ReadonlyV8Layout {
  readonly name: string

  readonly fields: readonly ReadonlyV8Field[]
}

type DeepReadonly<Value> = Value extends (...args: never[]) => unknown
  ? Value
  : Value extends readonly (infer Item)[]
    ? readonly DeepReadonly<Item>[]
    : Value extends object
      ? { readonly [Key in keyof Value]: DeepReadonly<Value[Key]> }
      : Value

type ReadonlyAllocationField = DeepReadonly<BitAllocationField>

export type WorkloadFieldRole = "partition" | "cluster" | "lookup"

export interface WorkloadFieldProfile {
  name: string

  role: WorkloadFieldRole

  selectivity?: number

  skew?: number

  readWeight?: number

  writeWeight?: number
}

export interface DatabaseWorkloadProfile {
  readWeight: number

  writeWeight: number

  fields: WorkloadFieldProfile[]
}

export type LayoutSchemaField = Omit<V8Field, "start"> & { start?: number }

export interface LayoutSchema {
  name: string

  fields: LayoutSchemaField[]
}

export interface LayoutCompilerInput {
  schema: LayoutSchema

  workload: DatabaseWorkloadProfile

  /** Identifiers the layout must support without exceeding the collision target. */

  volume?: number

  /** Target probability of any collision at `volume`. Defaults to 1e-2. */

  collisionTarget?: number
}

export type LayoutCompilerErrorCode =
  | "invalid-schema"
  | "invalid-workload"
  | "unknown-workload-field"
  | "duplicate-workload-field"

export class LayoutCompilerError extends Error {
  public readonly code: LayoutCompilerErrorCode

  public readonly field: string | undefined

  public constructor(
    code: LayoutCompilerErrorCode,
    message: string,
    field?: string
  ) {
    super(message)

    this.name = "LayoutCompilerError"

    this.code = code

    this.field = field
  }
}

export type ConstraintKind = "allowed-set" | "range" | "monotonic" | "fixed"

export interface FieldSemantics {
  type: FieldType

  constraints: ConstraintKind[]
}

export interface RepairPolicy {
  name: "canonical-v1"

  allowedSet: "index-modulo"

  range: "clamp"

  monotonic: "stateful"

  fixed: "deterministic"
}

export type StructuredGenerationMode =
  | "compiled-direct-v8"
  | "single-parent-pooled"

export interface GenerationPlan {
  name: "compiled-direct-v8"

  entropySource: "web-crypto"

  poolMode: "direct"

  repairMode: "canonical"

  fieldSemantics: Record<string, FieldSemantics>
}

export interface LayoutCostReport {
  objective: "hard-constraints-first"

  structuredBits: number

  randomBits: number

  requiredRandomBits: number

  collisionTarget: number

  collisionProbabilityAtVolume: number

  widthFloorsMet: boolean

  constrainedFields: number

  localityFields: number

  lookupFields: number

  readWeight: number

  writeWeight: number
}

export interface DatabaseLayoutCompilation {
  layout: V8Layout

  repairPolicy: RepairPolicy

  generationPlan: GenerationPlan

  costReport: LayoutCostReport
}

const MAX_FIELD_BITS = 48

/** Default collision target for a compiled layout: 1% over 2M identifiers. */

const DEFAULT_COLLISION_VOLUME = 2_000_000

const DEFAULT_COLLISION_TARGET = 1e-2

/**
 * Distinct values a field can hold, or null when the domain is the whole width.
 *
 * @param {ReadonlyV8Field} field - Field whose constraint domain is measured.
 * @returns {number | null} The domain size, or null for an unconstrained field.
 */

const fieldDomainSize = (field: ReadonlyV8Field): number | null => {
  const { constraint } = field

  if (isMissing(constraint)) {
    return nullValue
  }

  if (constraint.allowed !== absentValue && constraint.allowed.length > 0) {
    return constraint.allowed.length
  }

  if (constraint.min !== absentValue && constraint.max !== absentValue) {
    return constraint.max - constraint.min + 1
  }

  return nullValue
}

const FIELD_TYPES = new Set<FieldType>([
  "timestamp-ms",

  "timestamp-us",

  "counter",

  "shard",

  "node",

  "process",

  "fixed",

  "random",
])

const NIBBLE_BITS = new Set([48, 49, 50, 51, 64, 65])

interface LayoutValidationFailure {
  message: string

  field: string
}

const validateLayoutStructure = (
  fields: readonly ReadonlyV8Field[],

  layoutName: string,

  requireComplete: boolean
): LayoutValidationFailure | undefined => {
  const covered = Array.from<boolean>({ length: 128 }).fill(false)

  const names = new Set<string>()

  for (const field of fields) {
    if (names.has(field.name)) {
      return {
        field: field.name,
        message: `layout ${layoutName}: field ${field.name} is declared more than once`,
      }
    }

    names.add(field.name)

    if (
      !Number.isInteger(field.start) ||
      !Number.isInteger(field.length) ||
      field.start < 0
    ) {
      return {
        field: field.name,
        message: `layout ${layoutName}: field ${field.name} has invalid bounds`,
      }
    }

    if (field.length <= 0) {
      return {
        field: field.name,
        message: `layout ${layoutName}: field ${field.name} length<=0`,
      }
    }

    if (field.start + field.length > 128) {
      return {
        field: field.name,
        message: `layout ${layoutName}: field ${field.name} out of range`,
      }
    }

    if (field.type !== "random" && field.length > MAX_FIELD_BITS) {
      return {
        field: field.name,

        message: `layout ${layoutName}: structured field ${field.name} length ${field.length} > ${MAX_FIELD_BITS}`,
      }
    }

    for (let index = 0; index < field.length; index += 1) {
      const bit = field.start + index

      if (NIBBLE_BITS.has(bit)) {
        return {
          field: field.name,

          message: `layout ${layoutName}: field ${field.name} overlaps reserved v8 nibble bit ${bit}`,
        }
      }

      if (covered[bit]) {
        return {
          field: field.name,
          message: `layout ${layoutName}: field ${field.name} overlaps another field`,
        }
      }

      covered[bit] = true
    }
  }

  if (!requireComplete) {
    return absentValue
  }

  for (let index = 0; index < 128; index += 1) {
    if (!covered[index] && !NIBBLE_BITS.has(index)) {
      return {
        field: `bit.${index}`,
        message: `layout ${layoutName}: bit ${index} not covered by any field`,
      }
    }
  }

  return absentValue
}

export const validateLayout = (layout: ReadonlyV8Layout): void => {
  const failure = validateLayoutStructure(layout.fields, layout.name, true)

  if (failure) {
    throw new Error(failure.message)
  }
}

export const getFieldValue = (
  bytes: Readonly<Uint8Array>,
  field: ReadonlyV8Field
): bigint => {
  if (field.start + field.length > 128) {
    throw new Error(`getFieldValue: field ${field.name} exceeds 128-bit UUID`)
  }

  let value = 0n

  for (const seg of fieldByteMasks(field)) {
    const part = Math.floor(bytes[seg.byte] / 2 ** seg.shift) % 2 ** seg.width

    value = value * 2n ** BigInt(seg.width) + BigInt(part)
  }

  return value
}

const readFieldNumber = (
  bytes: Readonly<Uint8Array>,
  field: ReadonlyV8Field
): number => {
  let value = 0

  for (const seg of fieldByteMasks(field)) {
    const part = Math.floor(bytes[seg.byte] / 2 ** seg.shift) % 2 ** seg.width

    value = value * 2 ** seg.width + part
  }

  return value
}

interface WritePlanEntry {
  readonly byte: number

  readonly clearMask: number

  readonly writeMask: number

  readonly divisor: number

  readonly bitOffset: number

  readonly width: number
}

const _fieldWritePlans = new WeakMap<ReadonlyV8Field, WritePlanEntry[]>()

const computeWritePlan = (field: ReadonlyV8Field): WritePlanEntry[] => {
  const end = field.start + field.length

  return fieldByteMasks(field).map((seg) => {
    const writeMask = (2 ** seg.width - 1) * 2 ** seg.shift

    return {
      bitOffset: seg.shift,

      byte: seg.byte,

      clearMask: 255 - writeMask,

      divisor: 2 ** (end - seg.first - seg.width),

      width: seg.width,

      writeMask,
    }
  })
}

export const getFieldWritePlan = (field: ReadonlyV8Field): WritePlanEntry[] => {
  let plan = _fieldWritePlans.get(field)

  if (plan) {
    return plan
  }

  plan = computeWritePlan(field)

  _fieldWritePlans.set(field, plan)

  return plan
}

const writeFieldValue = (
  bytes: Uint8Array,
  field: ReadonlyV8Field,
  value: number
): void => {
  if (field.start + field.length > 128) {
    throw new Error(`writeFieldValue: field ${field.name} exceeds 128-bit UUID`)
  }

  const plan = getFieldWritePlan(field)

  for (const entry of plan) {
    const shifted = Math.floor(value / entry.divisor)

    const part = (shifted % 2 ** entry.width) * 2 ** entry.bitOffset

    const upperShift = entry.bitOffset + entry.width

    bytes[entry.byte] =
      (bytes[entry.byte] % 2 ** entry.bitOffset) +
      part +
      Math.floor(bytes[entry.byte] / 2 ** upperShift) * 2 ** upperShift
  }
}

// Copy field `f` from `src` into `dst` bit-for-bit using only byte/bit

// Number ops (no BigInt allocation). Used on the hot composition path where

// Fields can exceed 32 bits — this is what keeps crossover cheap.

const readBit = (bytes: Readonly<Uint8Array>, position: number): number =>
  Math.floor(bytes[Math.floor(position / 8)] / 2 ** (7 - (position % 8))) % 2

const writeBit = (bytes: Uint8Array, position: number, value: number): void => {
  if (readBit(bytes, position) === value) {
    return
  }

  const byte = Math.floor(position / 8)

  const weight = 2 ** (7 - (position % 8))

  const direction = Number(value === 1) * 2 - 1

  bytes[byte] += weight * direction
}

export const copyField = (
  dst: Uint8Array,

  src: Readonly<Uint8Array>,

  field: ReadonlyV8Field
): void => {
  if (field.start + field.length > 128) {
    throw new Error(`copyField: field ${field.name} exceeds 128-bit UUID`)
  }

  const end = field.start + field.length

  const startByte = Math.floor(field.start / 8)

  const endByte = Math.ceil(end / 8)

  const leadBits = field.start % 8

  const trailBits = end % 8

  if (leadBits !== 0) {
    const count = Math.min(8 - leadBits, field.length)

    for (let index = 0; index < count; index += 1) {
      const position = field.start + index

      writeBit(dst, position, readBit(src, position))
    }
  }

  let midStart = startByte

  if (leadBits !== 0) {
    midStart += 1
  }

  let midEnd = endByte

  if (trailBits !== 0) {
    midEnd -= 1
  }

  if (midEnd > midStart) {
    if (dst.buffer === src.buffer && dst.byteOffset !== src.byteOffset) {
      for (let index = midStart; index < midEnd; index += 1) {
        dst[index] = src[index]
      }
    } else {
      dst.set(src.subarray(midStart, midEnd), midStart)
    }
  }

  if (trailBits !== 0) {
    const startBitInField = field.length - trailBits

    for (let index = startBitInField; index < field.length; index += 1) {
      const position = field.start + index

      writeBit(dst, position, readBit(src, position))
    }
  }
}

export const forceVersionVariant = (bytes: Uint8Array): void => {
  if (bytes.length < 9) {
    throw new Error(
      `forceVersionVariant: expected ≥9 bytes, got ${bytes.length}`
    )
  }

  bytes[6] = (bytes[6] % 16) + 0x80

  bytes[8] = (bytes[8] % 64) + 0x80
}

// Precomputed per-byte masks for a field (cached per V8Field). Each entry says

// "within byte `byte`, these bits (mask) belong to this field." Used to assemble

// A child UUID by masking+ORing parent bytes — replaces the per-bit copyField

// Loop on the composition hot path with a small fixed number of byte ops.

interface ByteMask {
  readonly byte: number

  readonly first: number

  readonly mask: number

  readonly shift: number

  readonly width: number
}

const _fieldByteMasks = new WeakMap<ReadonlyV8Field, ByteMask[]>()

const fieldByteMasks = (f: ReadonlyV8Field): ByteMask[] => {
  let m = _fieldByteMasks.get(f)

  if (m) {
    return m
  }

  m = []

  const { start } = f

  const end = start + f.length

  for (let byte = Math.floor(start / 8); byte < Math.ceil(end / 8); byte += 1) {
    const first = Math.max(start, byte * 8)

    const last = Math.min(end - 1, byte * 8 + 7)

    const width = last - first + 1

    const shift = 7 - (last % 8)

    m.push({
      byte,
      first,
      mask: (2 ** width - 1) * 2 ** shift,
      shift,
      width,
    })
  }

  _fieldByteMasks.set(f, m)

  return m
}

export const uuidToBytes = (uuid: string): Uint8Array => {
  const h = uuid.replaceAll("-", "")

  if (!/^[0-9a-fA-F]{32}$/u.test(h)) {
    throw new Error(`uuidToBytes: invalid UUID hex string "${uuid}"`)
  }

  const b = new Uint8Array(16)

  for (let j = 0; j < 16; j += 1) {
    b[j] = Number.parseInt(h.slice(j * 2, j * 2 + 2), 16)
  }

  return b
}

// Extract only the layout's `random`-type bits from a UUID, as an ordered

// "0/1" string (field order, MSB-first per byte). Used for NIST bit-stream

// Export; the canonical home keeps layout-aware extraction in one place.

export const uuidToRandomBits = (
  uuid: string,
  layout: ReadonlyV8Layout
): string => {
  const b = uuidToBytes(uuid)

  let bits = ""

  for (const f of layout.fields) {
    if (f.type === "random") {
      for (let bit = 0; bit < f.length; bit += 1) {
        const pos = f.start + bit

        bits += readBit(b, pos).toString()
      }
    }
  }

  return bits
}

// Inverse of the structured generators: read each field's integer value from a

// UUID string, keyed by field name. Uses `getFieldValue` (exact BigInt), so it

// Is safe for fields wider than 32 bits — the same path the truncation bug

// Lived on, now exercised by the test suite.

export const readStructured = (
  uuid: string,
  layout: ReadonlyV8Layout
): Record<string, number> => {
  const b = uuidToBytes(uuid)

  const out: Record<string, number> = {}

  for (const f of layout.fields) {
    out[f.name] = readFieldNumber(b, f)
  }

  return out
}

/**
 * Fill any gaps left by the caller's declared fields (including the reserved
 * v8 nibble bits) with `random`-type filler fields so the layout covers all
 * 128 UUID bits. Returns a new layout; the input is not mutated.
 *
 * @param {string} name - Name for the completed layout.
 * @param {readonly ReadonlyV8Field[]} fields - Declared fields to preserve.
 * @returns {V8Layout} A complete layout covering all 128 UUID bits.
 */

export const completeLayout = (
  name: string,
  fields: readonly ReadonlyV8Field[]
): V8Layout => {
  const covered = Array.from<boolean>({ length: 128 }).fill(false)

  for (const f of fields) {
    for (let i = 0; i < f.length; i += 1) {
      covered[f.start + i] = true
    }
  }

  for (const i of NIBBLE_BITS) {
    covered[i] = true
  }

  const out: V8Field[] = [...fields] as V8Field[]

  const usedNames = new Set(fields.map((field) => field.name))

  let i = 0

  while (i < 128) {
    if (covered[i]) {
      i += 1
    } else {
      let j = i

      while (j < 128 && !covered[j]) {
        j += 1
      }

      let generatedName = `rand_${i}`

      let suffix = 0

      while (usedNames.has(generatedName)) {
        generatedName = `rand_${i}_${(suffix += 1)}`
      }

      usedNames.add(generatedName)

      out.push({ length: j - i, name: generatedName, start: i, type: "random" })

      i = j
    }
  }

  return { fields: out, name }
}

const validateSchema = (schema: DeepReadonly<LayoutSchema>): void => {
  if (typeof schema.name !== "string" || schema.name.trim() === "") {
    throw new LayoutCompilerError(
      "invalid-schema",
      "schema name must be a non-empty string",
      "schema.name"
    )
  }

  const names = new Set<string>()

  for (const [index, field] of schema.fields.entries()) {
    const path = `schema.fields[${index}]`

    const candidate: unknown = field

    if (!isRecord(candidate)) {
      throw new LayoutCompilerError(
        "invalid-schema",
        `${path} must be an object`,
        path
      )
    }

    if (typeof field.name !== "string" || field.name.length === 0) {
      throw new LayoutCompilerError(
        "invalid-schema",
        `${path}.name must be non-empty`,
        `${path}.name`
      )
    }

    if (names.has(field.name)) {
      throw new LayoutCompilerError(
        "invalid-schema",
        `${path}.name is declared more than once`,
        `${path}.name`
      )
    }

    names.add(field.name)

    if (!FIELD_TYPES.has(field.type)) {
      throw new LayoutCompilerError(
        "invalid-schema",
        `${path}.type is unsupported`,
        `${path}.type`
      )
    }
  }
}

const validateAllowedConstraint = (
  constraint: ReadonlyV8Constraint,

  path: string,

  domainMax: number
): void => {
  if (constraint.allowed === absentValue) {
    return
  }

  if (!isArray(constraint.allowed)) {
    throw new LayoutCompilerError(
      "invalid-schema",
      `${path}.constraint.allowed must be an array`,
      `${path}.constraint.allowed`
    )
  }

  if (
    constraint.allowed.length === 0 ||
    constraint.allowed.some(
      (value) => !Number.isInteger(value) || value < 0 || value > domainMax
    )
  ) {
    throw new LayoutCompilerError(
      "invalid-schema",
      `${path}.constraint.allowed must contain values in the field domain`,
      `${path}.constraint.allowed`
    )
  }
}

const validateRangeConstraint = (
  constraint: ReadonlyV8Constraint,

  path: string,

  domainMax: number
): void => {
  if (
    constraint.min !== absentValue &&
    (!Number.isInteger(constraint.min) ||
      constraint.min < 0 ||
      constraint.min > domainMax)
  ) {
    throw new LayoutCompilerError(
      "invalid-schema",
      `${path}.constraint.min must be in the field domain`,
      `${path}.constraint.min`
    )
  }

  if (
    constraint.max !== absentValue &&
    (!Number.isInteger(constraint.max) ||
      constraint.max < 0 ||
      constraint.max > domainMax)
  ) {
    throw new LayoutCompilerError(
      "invalid-schema",
      `${path}.constraint.max must be in the field domain`,
      `${path}.constraint.max`
    )
  }

  if (
    constraint.min !== absentValue &&
    constraint.max !== absentValue &&
    constraint.min > constraint.max
  ) {
    throw new LayoutCompilerError(
      "invalid-schema",
      `${path}.constraint min must not exceed max`,
      path
    )
  }
}

const validateFieldConstraint = (
  field: DeepReadonly<LayoutSchemaField>,

  path: string,

  domainMax: number
): void => {
  const { constraint } = field

  const rawConstraint: unknown = constraint

  if (rawConstraint === absentValue) {
    return
  }

  if (!isRecord(rawConstraint)) {
    throw new LayoutCompilerError(
      "invalid-schema",
      `${path}.constraint must be an object`,
      `${path}.constraint`
    )
  }

  const typedConstraint = rawConstraint as ReadonlyV8Constraint

  validateAllowedConstraint(typedConstraint, path, domainMax)

  validateRangeConstraint(typedConstraint, path, domainMax)

  if (
    typedConstraint.monotonic !== absentValue &&
    typeof typedConstraint.monotonic !== "boolean"
  ) {
    throw new LayoutCompilerError(
      "invalid-schema",
      `${path}.constraint.monotonic must be boolean`,
      `${path}.constraint.monotonic`
    )
  }
}

const validateSchemaConstraints = (
  schema: DeepReadonly<LayoutSchema>
): void => {
  for (const [index, field] of schema.fields.entries()) {
    const path = `schema.fields[${index}]`

    const domainMax = 2 ** field.length - 1

    validateFieldConstraint(field, path, domainMax)

    if (
      field.type === "fixed" &&
      (!Number.isInteger(field.value) ||
        (field.value ?? -1) < 0 ||
        (field.value ?? -1) > domainMax)
    ) {
      throw new LayoutCompilerError(
        "invalid-schema",
        `${path}.value must be in the field domain`,
        `${path}.value`
      )
    }
  }
}

const assertNonnegative = (
  value: number | undefined,

  code: LayoutCompilerErrorCode,

  field: string
): void => {
  if (value !== absentValue && (!Number.isFinite(value) || value < 0)) {
    throw new LayoutCompilerError(
      code,
      `${field} must be a finite non-negative number`,
      field
    )
  }
}

const isMonotonic = (field: ReadonlyV8Field): boolean => {
  const { constraint } = field

  return !isMissing(constraint) && constraint.monotonic === true
}

const constraintKinds = (field: ReadonlyV8Field): ConstraintKind[] => {
  const constraints: ConstraintKind[] = []

  const { constraint } = field

  if (!isMissing(constraint)) {
    if (constraint.allowed !== absentValue) {
      constraints.push("allowed-set")
    }

    if (constraint.min !== absentValue || constraint.max !== absentValue) {
      constraints.push("range")
    }

    if (constraint.monotonic === true) {
      constraints.push("monotonic")
    }
  }

  if (field.type === "fixed") {
    constraints.push("fixed")
  }

  return constraints
}

/** One observed query: which fields it filtered and what it touched. */

export interface WorkloadTraceEvent {
  op: "read" | "write"

  kind: "point" | "range" | "scan"

  /** Equality-filter field → value. */

  filters?: Record<string, string | number>

  /** Rows matched (pairs with scanned for selectivity). */

  matched?: number

  /** Rows scanned (pairs with matched for selectivity). */

  scanned?: number
}

export interface InferredWorkload {
  profile: DatabaseWorkloadProfile

  /** Per-field access counts — the Smith weights for planBitAllocation. */

  weights: Record<string, number>

  /** Per-field distinct filter values observed — a cardinality lower bound. */

  cardinalities: Record<string, number>
}

/**
 * Infer a workload profile from a query trace instead of hand-declaring it.
 * Weights are access counts; roles follow usage (range-filtered → partition,
 * point-filtered → lookup, otherwise → cluster); selectivity is
 * matched/scanned over events carrying both; cardinality counts distinct
 * observed filter values. Unknown filter fields and empty traces throw.
 */

interface WorkloadStats {
  weights: Map<string, number>

  distinct: Map<string, Set<string | number>>

  matched: Map<string, number>

  scanned: Map<string, number>

  ranged: Set<string>

  pointed: Set<string>

  reads: number

  writes: number
}

const validateTraceEvent = (
  event: DeepReadonly<WorkloadTraceEvent>,
  path: string
): void => {
  const { op: operation, kind } = event

  const operationValue: unknown = operation

  const kindValue: unknown = kind

  if (operationValue !== "read" && operationValue !== "write") {
    throw new LayoutCompilerError(
      "invalid-workload",
      `${path}.op must be "read" or "write"`,
      path
    )
  }

  if (kindValue !== "point" && kindValue !== "range" && kindValue !== "scan") {
    throw new LayoutCompilerError(
      "invalid-workload",
      `${path}.kind must be "point", "range", or "scan"`,
      path
    )
  }
}

const recordWorkloadFilter = (
  name: string,

  value: string | number,

  event: DeepReadonly<WorkloadTraceEvent>,

  path: string,

  schemaFields: ReadonlySet<string>,

  stats: WorkloadStats
): void => {
  if (!schemaFields.has(name)) {
    throw new LayoutCompilerError(
      "unknown-workload-field",
      `workload trace filters unknown field ${name}`,
      name
    )
  }

  stats.weights.set(name, (stats.weights.get(name) ?? 0) + 1)

  if (event.kind === "range") {
    stats.ranged.add(name)
  } else if (event.kind === "point") {
    stats.pointed.add(name)
  }

  let distinct = stats.distinct.get(name)

  if (distinct === absentValue) {
    distinct = new Set<string | number>()

    stats.distinct.set(name, distinct)
  }

  distinct.add(value)

  if (event.matched === absentValue || event.scanned === absentValue) {
    return
  }

  if (
    event.matched < 0 ||
    event.scanned <= 0 ||
    event.matched > event.scanned
  ) {
    throw new LayoutCompilerError(
      "invalid-workload",

      `${path}: matched/scanned must satisfy 0 <= matched <= scanned, scanned > 0`,

      path
    )
  }

  stats.matched.set(name, (stats.matched.get(name) ?? 0) + event.matched)

  stats.scanned.set(name, (stats.scanned.get(name) ?? 0) + event.scanned)
}

const recordWorkloadEvent = (
  event: DeepReadonly<WorkloadTraceEvent>,

  path: string,

  schemaFields: ReadonlySet<string>,

  stats: WorkloadStats
): void => {
  validateTraceEvent(event, path)

  if (event.op === "read") {
    stats.reads += 1
  } else {
    stats.writes += 1
  }

  for (const [name, value] of Object.entries(event.filters ?? {})) {
    recordWorkloadFilter(name, value, event, path, schemaFields, stats)
  }
}

export const inferWorkload = (
  trace: readonly DeepReadonly<WorkloadTraceEvent>[],

  schema: DeepReadonly<LayoutSchema>
): InferredWorkload => {
  if (!isArray(trace) || trace.length === 0) {
    throw new LayoutCompilerError(
      "invalid-workload",
      "workload trace must be a non-empty array"
    )
  }

  const schemaFields = new Set(schema.fields.map((field) => field.name))

  const stats: WorkloadStats = {
    distinct: new Map(),

    matched: new Map(),

    pointed: new Set(),

    ranged: new Set(),

    reads: 0,

    scanned: new Map(),

    weights: new Map(),

    writes: 0,
  }

  for (const [index, event] of trace.entries()) {
    recordWorkloadEvent(event, `trace[${index}]`, schemaFields, stats)
  }

  if (stats.reads + stats.writes === 0) {
    throw new LayoutCompilerError(
      "invalid-workload",
      "workload trace must be a non-empty array"
    )
  }

  const fields: WorkloadFieldProfile[] = schema.fields.map((field) => {
    let role: WorkloadFieldProfile["role"] = "cluster"

    if (stats.ranged.has(field.name)) {
      role = "partition"
    } else if (stats.pointed.has(field.name)) {
      role = "lookup"
    }

    const profile: WorkloadFieldProfile = { name: field.name, role }

    const scanned = stats.scanned.get(field.name)

    const matched = stats.matched.get(field.name) ?? 0

    if (scanned !== absentValue && scanned > 0) {
      profile.selectivity = matched / scanned
    }

    return profile
  })

  const cardinalities: Record<string, number> = {}

  const weights: Record<string, number> = {}

  for (const [name, weight] of stats.weights) {
    weights[name] = weight
  }

  for (const field of schema.fields) {
    const distinct = stats.distinct.get(field.name)

    let cardinality = 1

    if (distinct !== absentValue) {
      cardinality = distinct.size
    }

    cardinalities[field.name] = cardinality

    if (!stats.weights.has(field.name)) {
      weights[field.name] = 0
    }
  }

  return {
    cardinalities,

    profile: { fields, readWeight: stats.reads, writeWeight: stats.writes },

    weights,
  }
}

const roleRank = (role: WorkloadFieldRole | undefined): number => {
  if (role === "partition" || role === "cluster") {
    return 0
  }

  if (role === "lookup") {
    return 1
  }

  return 2
}

const findAutoFieldStart = (
  field: DeepReadonly<LayoutSchemaField>,

  index: number,

  usedBits: Set<number>
): number => {
  let start = 0

  while (start < 128) {
    let conflict = false

    for (let bit = start; bit < start + field.length; bit += 1) {
      if (bit >= 128 || NIBBLE_BITS.has(bit) || usedBits.has(bit)) {
        conflict = true

        break
      }
    }

    if (!conflict) {
      return start
    }

    start += 8
  }

  throw new LayoutCompilerError(
    "invalid-schema",
    `field ${field.name} does not fit in the UUID`,
    `schema.fields[${index}]`
  )
}

const placeSchemaFields = (
  fields: readonly DeepReadonly<LayoutSchemaField>[],

  profiles: readonly DeepReadonly<WorkloadFieldProfile>[]
): V8Field[] => {
  const starts = Array.from<number | undefined>({ length: fields.length })

  const usedBits = new Set<number>()

  for (const [index, field] of fields.entries()) {
    const path = `schema.fields[${index}]`

    if (!Number.isInteger(field.length) || field.length <= 0) {
      throw new LayoutCompilerError(
        "invalid-schema",
        `${path}.length must be a positive integer`,
        `${path}.length`
      )
    }

    if (field.type !== "random" && field.length > MAX_FIELD_BITS) {
      throw new LayoutCompilerError(
        "invalid-schema",
        `${path}.length exceeds ${MAX_FIELD_BITS} bits`,
        `${path}.length`
      )
    }

    if (field.start !== absentValue) {
      if (
        !Number.isInteger(field.start) ||
        field.start < 0 ||
        field.start + field.length > 128
      ) {
        throw new LayoutCompilerError(
          "invalid-schema",
          `${path}.start is outside the 128-bit UUID`,
          `${path}.start`
        )
      }

      starts[index] = field.start

      for (let bit = field.start; bit < field.start + field.length; bit += 1) {
        usedBits.add(bit)
      }
    }
  }

  const roles = new Map(profiles.map((profile) => [profile.name, profile.role]))

  const autoFields = fields

    .map((field, index) => ({
      field,
      index,
      rank: roleRank(roles.get(field.name)),
    }))

    .filter((entry) => entry.field.start === absentValue)

  for (let index = 1; index < autoFields.length; index += 1) {
    const entry = autoFields[index]

    let position = index - 1

    while (
      position >= 0 &&
      (autoFields[position].rank > entry.rank ||
        (autoFields[position].rank === entry.rank &&
          autoFields[position].index > entry.index))
    ) {
      autoFields[position + 1] = autoFields[position]

      position -= 1
    }

    autoFields[position + 1] = entry
  }

  for (const entry of autoFields) {
    const start = findAutoFieldStart(entry.field, entry.index, usedBits)

    starts[entry.index] = start

    for (let index = 0; index < entry.field.length; index += 1) {
      usedBits.add(start + index)
    }
  }

  return fields.map((field, index) => {
    const start = starts[index]

    if (start === absentValue) {
      throw new LayoutCompilerError(
        "invalid-schema",
        `field ${field.name} was not placed`,
        `schema.fields[${index}]`
      )
    }

    const placedField = Object.assign(
      Object.create(Object.prototype) as LayoutSchemaField,
      field
    )

    placedField.start = start

    return placedField as V8Field
  })
}

export const minBitsForCardinality = (cardinality: number): number => {
  if (!Number.isInteger(cardinality) || cardinality < 1) {
    throw new RangeError(
      `minBitsForCardinality: cardinality must be a positive integer, got ${cardinality}`
    )
  }

  return Math.max(1, Math.ceil(Math.log2(cardinality)))
}

/** Upper bound on P(at least one collision) for n ids drawn from 2^r values.
 *
 * @param {number} n - Number of identifiers drawn.
 * @param {number} randomBits - Random bits available per identifier.
 * @returns {number} Upper bound on collision probability.
 */

export const collisionProbabilityUpperBound = (
  n: number,
  randomBits: number
): number => {
  if (n <= 1) {
    return 0
  }

  const exponent = (n * (n - 1)) / (2 * 2 ** (randomBits + 1))

  return 1 - Math.exp(-exponent)
}

/**
 * Smallest r whose collision bound is at most `target` for `volume` ids.
 * Closed form: 2^r >= n(n-1) / (4 ln(1/(1-target))).
 *
 * @param {number} volume - Number of identifiers expected.
 * @param {number} target - Collision probability target.
 * @returns {number} Smallest sufficient random-bit count.
 */

export const minRandomBitsForCollisionBudget = (
  volume: number,
  target: number
): number => {
  if (!Number.isInteger(volume) || volume < 1) {
    throw new RangeError(
      `minRandomBitsForCollisionBudget: volume must be a positive integer, got ${volume}`
    )
  }

  if (!(target > 0 && target < 1)) {
    throw new RangeError(
      `minRandomBitsForCollisionBudget: target must be in (0,1), got ${target}`
    )
  }

  const closed = Math.log2(
    (volume * (volume - 1)) / (4 * -Math.log(1 - target))
  )

  let r = Math.max(0, Math.ceil(closed))

  while (collisionProbabilityUpperBound(volume, r) > target) {
    r += 1
  }

  while (r > 0 && collisionProbabilityUpperBound(volume, r - 1) <= target) {
    r -= 1
  }

  return r
}

const validateWorkloadProfile = (
  profile: DeepReadonly<WorkloadFieldProfile>,

  schemaFields: ReadonlySet<string>,

  seen: Set<string>
): void => {
  const candidate: unknown = profile

  if (
    !isRecord(candidate) ||
    typeof candidate.name !== "string" ||
    candidate.name.length === 0
  ) {
    throw new LayoutCompilerError(
      "invalid-workload",
      "workload field name must be non-empty"
    )
  }

  if (seen.has(profile.name)) {
    throw new LayoutCompilerError(
      "duplicate-workload-field",

      `workload field ${profile.name} is declared more than once`,

      profile.name
    )
  }

  seen.add(profile.name)

  if (!schemaFields.has(profile.name)) {
    throw new LayoutCompilerError(
      "unknown-workload-field",

      `workload field ${profile.name} is not present in the schema`,

      profile.name
    )
  }

  const { role: configuredRole } = profile

  const role: unknown = configuredRole

  if (role !== "partition" && role !== "cluster" && role !== "lookup") {
    throw new LayoutCompilerError(
      "invalid-workload",

      `workload field ${profile.name} has an unsupported role`,

      profile.name
    )
  }

  if (
    profile.selectivity !== absentValue &&
    (!Number.isFinite(profile.selectivity) ||
      profile.selectivity < 0 ||
      profile.selectivity > 1)
  ) {
    throw new LayoutCompilerError(
      "invalid-workload",

      `workload field ${profile.name}.selectivity must be between 0 and 1`,

      profile.name
    )
  }

  assertNonnegative(profile.skew, "invalid-workload", `${profile.name}.skew`)

  assertNonnegative(
    profile.readWeight,
    "invalid-workload",
    `${profile.name}.readWeight`
  )

  assertNonnegative(
    profile.writeWeight,
    "invalid-workload",
    `${profile.name}.writeWeight`
  )
}

const validateWorkload = (
  workload: DeepReadonly<DatabaseWorkloadProfile>,
  schemaFields: ReadonlySet<string>
): void => {
  const seen = new Set<string>()

  for (const profile of workload.fields) {
    validateWorkloadProfile(profile, schemaFields, seen)
  }
}

const validateCompilerInput = (
  input: DeepReadonly<LayoutCompilerInput>
): void => {
  if (!isRecord(input)) {
    throw new LayoutCompilerError(
      "invalid-schema",
      "compiler input must be an object"
    )
  }

  const { schema, workload } = input

  const rawSchema: unknown = schema

  const rawWorkload: unknown = workload

  if (
    !isRecord(rawSchema) ||
    typeof rawSchema.name !== "string" ||
    !isArray(rawSchema.fields)
  ) {
    throw new LayoutCompilerError(
      "invalid-schema",
      "schema must contain a name and fields array"
    )
  }

  if (
    !isRecord(rawWorkload) ||
    !isArray(rawWorkload.fields) ||
    rawWorkload.fields.length === 0
  ) {
    throw new LayoutCompilerError(
      "invalid-workload",
      "workload must contain at least one field"
    )
  }

  if (typeof workload.readWeight !== "number") {
    throw new LayoutCompilerError(
      "invalid-workload",
      "workload.readWeight must be a number",
      "workload.readWeight"
    )
  }

  if (typeof workload.writeWeight !== "number") {
    throw new LayoutCompilerError(
      "invalid-workload",
      "workload.writeWeight must be a number",
      "workload.writeWeight"
    )
  }

  assertNonnegative(
    workload.readWeight,
    "invalid-workload",
    "workload.readWeight"
  )

  assertNonnegative(
    workload.writeWeight,
    "invalid-workload",
    "workload.writeWeight"
  )

  if (workload.readWeight + workload.writeWeight === 0) {
    throw new LayoutCompilerError(
      "invalid-workload",
      "workload must have a positive readWeight or writeWeight"
    )
  }
}

export const compileDatabaseLayout = (
  input: DeepReadonly<LayoutCompilerInput>
): DatabaseLayoutCompilation => {
  validateCompilerInput(input)

  const { schema, workload } = input

  validateSchema(schema)

  const schemaFields = new Set(schema.fields.map((field) => field.name))

  validateWorkload(workload, schemaFields)

  const layout = completeLayout(
    schema.name,
    placeSchemaFields(schema.fields, workload.fields)
  )

  const layoutFailure = validateLayoutStructure(
    layout.fields,
    layout.name,
    true
  )

  if (layoutFailure) {
    const schemaIndex = schema.fields.findIndex(
      (field) => field.name === layoutFailure.field
    )

    const { field: failedField } = layoutFailure

    let field = failedField

    if (schemaIndex !== -1) {
      field = `schema.fields[${schemaIndex}]`
    }

    throw new LayoutCompilerError(
      "invalid-schema",
      layoutFailure.message,
      field
    )
  }

  validateSchemaConstraints(schema)

  const fieldSemantics: Record<string, FieldSemantics> = {}

  const structuredBits = new Set<number>()

  const widthFloors: {
    field: string
    declaredBits: number
    floor: number
    domain: number
  }[] = []

  for (const field of layout.fields) {
    fieldSemantics[field.name] = {
      constraints: constraintKinds(field),
      type: field.type,
    }

    if (field.type !== "random") {
      for (let bit = field.start; bit < field.start + field.length; bit += 1) {
        structuredBits.add(bit)
      }
    }

    const domain = fieldDomainSize(field)

    if (domain !== nullValue && field.type !== "random") {
      widthFloors.push({
        declaredBits: field.length,

        domain,

        field: field.name,

        floor: minBitsForCardinality(domain),
      })
    }
  }

  const widthFloorsMet = widthFloors.every(
    (entry) => entry.declaredBits >= entry.floor
  )

  const volumeTarget = input.volume ?? DEFAULT_COLLISION_VOLUME

  const tau = input.collisionTarget ?? DEFAULT_COLLISION_TARGET

  const requiredRandomBits = minRandomBitsForCollisionBudget(volumeTarget, tau)

  return {
    costReport: {
      collisionProbabilityAtVolume: collisionProbabilityUpperBound(
        volumeTarget,

        128 - NIBBLE_BITS.size - structuredBits.size
      ),

      collisionTarget: tau,

      constrainedFields: layout.fields.filter(
        (field) => constraintKinds(field).length > 0
      ).length,

      localityFields: workload.fields.filter(
        (field) => field.role === "partition" || field.role === "cluster"
      ).length,

      lookupFields: workload.fields.filter((field) => field.role === "lookup")
        .length,

      objective: "hard-constraints-first",

      randomBits: 128 - NIBBLE_BITS.size - structuredBits.size,

      readWeight: workload.readWeight,

      requiredRandomBits,

      structuredBits: structuredBits.size,

      widthFloorsMet,

      writeWeight: workload.writeWeight,
    },

    generationPlan: {
      entropySource: "web-crypto",

      fieldSemantics,

      name: "compiled-direct-v8",

      poolMode: "direct",

      repairMode: "canonical",
    },

    layout,

    repairPolicy: {
      allowedSet: "index-modulo",

      fixed: "deterministic",

      monotonic: "stateful",

      name: "canonical-v1",

      range: "clamp",
    },
  }
}

// ---------------------------------------------------------------------------

// Bit allocation.

//

// Choosing where a declared field sits inside a fixed-length identifier is a

// Single-timeline scheduling problem: each field is a job, its length is the

// Processing time, its end offset is the completion time, and the objective

// Is to keep the fields a query actually filters on as close to the front of

// The key as possible. Weighted completion time on one machine is solved by

// Smith's rule (1956): order by non-increasing weight / length. The shipped

// Planner instead ordered by workload role rank, which is not optimal for

// That objective.

// ---------------------------------------------------------------------------

/** Locality class: lower sorts earlier in the key. */

export type LocalityClass = "partition" | "cluster" | "lookup" | "opaque"

const localityRank = (locality: LocalityClass | undefined): number => {
  if (locality === "partition") {
    return 0
  }

  if (locality === "cluster") {
    return 1
  }

  if (locality === "lookup") {
    return 2
  }

  return 3
}

export interface BitAllocationField {
  name: string

  /** Distinct values that must be representable. */

  cardinality: number

  /** Weight of the queries this field filters, i.e. the cost of burying it. */

  weight: number

  locality?: LocalityClass

  /** Offset granularity in bits. 8 keeps the field byte-extractable. */

  align?: 1 | 4 | 8

  /** Forces offset 0 (timestamp / monotonic prefix). */

  leading?: boolean
}

export interface BitAllocationInput {
  budget?: number

  fields: readonly BitAllocationField[]

  volume?: number

  collisionTarget?: number

  minRandomBits?: number
}

export interface AllocatedField {
  name: string

  cardinality: number

  weight: number

  locality: LocalityClass

  align: 1 | 4 | 8

  minBits: number

  bits: number

  offset: number

  slackBits: number

  /** Weight / bits, the Smith-rule key. */

  priority: number
}

export interface BitAllocationPlan {
  fields: AllocatedField[]

  filler: { offset: number; bits: number }[]

  structuredBits: number

  randomBits: number

  requiredRandomBits: number

  feasible: boolean

  reason?: string

  /** Sum of weight x end-offset; the scheduling objective, lower is better. */

  weightedDepth: number

  /** WeightedDepth of the rank-ordered (pre-Smith) allocation, for the gap. */

  weightedDepthRankOrder: number

  algorithm: "smith-rule"
}

const fits = (offset: number, bits: number, used: Set<number>): boolean => {
  for (let b = offset; b < offset + bits; b += 1) {
    if (NIBBLE_BITS.has(b) || b >= 128 || used.has(b)) {
      return false
    }
  }

  return true
}

/**
 * Stable sort by a comparator, matching the insertion sort the planner already uses.
 *
 * @param {readonly Item[]} items - Values to sort.
 * @param {(left: Item, right: Item) => number} compare - Sort comparator.
 * @returns {Item[]} A stably sorted copy.
 */

const sortBy = <Item>(
  items: readonly Item[],
  compare: (left: Item, right: Item) => number
): Item[] => {
  const out = [...items]

  for (let index = 1; index < out.length; index += 1) {
    const entry = out[index]

    let position = index - 1

    while (position >= 0 && compare(out[position], entry) > 0) {
      out[position + 1] = out[position]

      position -= 1
    }

    out[position + 1] = entry
  }

  return out
}

/**
 * Rank order, the pre-Smith rule the shipped planner used.
 *
 * @param {readonly ReadonlyAllocationField[]} fields - Fields to rank.
 * @returns {ReadonlyAllocationField[]} Fields in rank order.
 */

const byLocalityRank = (
  fields: readonly ReadonlyAllocationField[]
): ReadonlyAllocationField[] =>
  sortBy(fields, (a, b) => {
    const ra = localityRank(a.locality)

    const rb = localityRank(b.locality)

    if (ra !== rb) {
      return ra - rb
    }

    return (
      minBitsForCardinality(b.cardinality) -
      minBitsForCardinality(a.cardinality)
    )
  })

const pack = (
  order: readonly ReadonlyAllocationField[]
): {
  placed: { field: ReadonlyAllocationField; offset: number }[]

  filler: { offset: number; bits: number }[]

  used: Set<number>
} => {
  const used = new Set<number>()

  const placed: { field: ReadonlyAllocationField; offset: number }[] = []

  for (const field of order) {
    const bits = minBitsForCardinality(field.cardinality)

    const align = field.align ?? 8

    let offset = -1

    if (field.leading === true) {
      offset = 0
    }

    if (offset === -1) {
      for (let candidate = 0; candidate + bits <= 128; candidate += align) {
        if (fits(candidate, bits, used)) {
          offset = candidate

          break
        }
      }
    }

    if (offset === -1 || !fits(offset, bits, used) || offset + bits > 128) {
      throw new RangeError(`field ${field.name} does not fit in the UUID`)
    }

    for (let b = offset; b < offset + bits; b += 1) {
      used.add(b)
    }

    placed.push({ field, offset })
  }

  const filler: { offset: number; bits: number }[] = []

  let cursor = 0

  while (cursor < 128) {
    if (used.has(cursor) || NIBBLE_BITS.has(cursor)) {
      cursor += 1
    } else {
      let end = cursor

      while (end < 128 && !used.has(end) && !NIBBLE_BITS.has(end)) {
        end += 1
      }

      if (end - cursor > 0) {
        filler.push({ bits: end - cursor, offset: cursor })
      }

      cursor = end
    }
  }

  return { filler, placed, used }
}

const depthOf = (
  order: readonly {
    readonly field: ReadonlyAllocationField
    readonly offset: number
  }[]
): number => {
  let total = 0

  for (const entry of order) {
    total +=
      entry.field.weight *
      (entry.offset + minBitsForCardinality(entry.field.cardinality))
  }

  return total
}

const validateAllocationField = (field: ReadonlyAllocationField): void => {
  const candidate: unknown = field

  if (
    !isRecord(candidate) ||
    typeof candidate.name !== "string" ||
    candidate.name.length === 0
  ) {
    throw new RangeError(
      "planBitAllocation: every field needs a non-empty name"
    )
  }

  if (!Number.isInteger(field.cardinality) || field.cardinality < 1) {
    throw new RangeError(
      `planBitAllocation: ${field.name}.cardinality must be a positive integer`
    )
  }

  if (!Number.isFinite(field.weight) || field.weight < 0) {
    throw new RangeError(
      `planBitAllocation: ${field.name}.weight must be a finite non-negative number`
    )
  }

  const { align } = field

  const alignment: unknown = align

  if (
    alignment !== absentValue &&
    alignment !== 1 &&
    alignment !== 4 &&
    alignment !== 8
  ) {
    throw new RangeError(
      `planBitAllocation: ${field.name}.align must be 1, 4, or 8`
    )
  }
}

const compareSmithFields = (
  a: ReadonlyAllocationField,
  b: ReadonlyAllocationField
): number => {
  const pa = a.weight / minBitsForCardinality(a.cardinality)

  const pb = b.weight / minBitsForCardinality(b.cardinality)

  if (pb !== pa) {
    return pb - pa
  }

  const ra = localityRank(a.locality)

  const rb = localityRank(b.locality)

  if (ra !== rb) {
    return ra - rb
  }

  return a.name.localeCompare(b.name)
}

const allocationFailure = (
  reason: string,

  budget: number,

  required: number,

  structuredBits: number
): BitAllocationPlan => ({
  algorithm: "smith-rule",

  feasible: false,

  fields: [],

  filler: [],

  randomBits: 0,

  reason,

  requiredRandomBits: required,

  structuredBits,

  weightedDepth: Number.POSITIVE_INFINITY,

  weightedDepthRankOrder: Number.POSITIVE_INFINITY,
})

export const planBitAllocation = (
  input: DeepReadonly<BitAllocationInput>
): BitAllocationPlan => {
  if (!isRecord(input)) {
    throw new RangeError("planBitAllocation: fields must be a non-empty array")
  }

  if (!isArray(input.fields) || input.fields.length === 0) {
    throw new RangeError("planBitAllocation: fields must be a non-empty array")
  }

  const { fields } = input

  const UUID_RANDOM_BITS = 122

  const budget = input.budget ?? UUID_RANDOM_BITS

  if (!Number.isInteger(budget) || budget < 1) {
    throw new RangeError(
      `planBitAllocation: budget must be a positive integer, got ${budget}`
    )
  }

  for (const field of fields) {
    validateAllocationField(field)
  }

  let required = 0

  if (input.volume !== absentValue && input.collisionTarget !== absentValue) {
    required = minRandomBitsForCollisionBudget(
      input.volume,
      input.collisionTarget
    )
  }

  required = input.minRandomBits ?? required

  const floors = new Map(
    fields.map((f) => [f.name, minBitsForCardinality(f.cardinality)])
  )

  const totalFloor = [...floors.values()].reduce((a, b) => a + b, 0)

  if (totalFloor > budget) {
    return allocationFailure(
      `structured floors total ${totalFloor} bits against a ${budget}-bit budget; ` +
        `reduce cardinalities or drop ${totalFloor - budget} bits of declared structure`,

      budget,

      required,

      totalFloor
    )
  }

  if (totalFloor + required > budget) {
    return allocationFailure(
      `the collision budget needs ${required} random bits but only ${budget - totalFloor} remain ` +
        `after ${totalFloor} bits of declared structure`,

      budget,

      required,

      totalFloor
    )
  }

  // Smith's rule: non-increasing weight / length, ties broken by locality

  // Class then name so the allocation is deterministic.

  const smith = sortBy(fields, compareSmithFields)

  const leading = smith.filter((f) => f.leading === true)

  const rest = smith.filter((f) => f.leading !== true)

  const order = [...leading, ...rest]

  const tryPackPlans = ():
    | {
        ok: true
        packed: ReturnType<typeof pack>
        ranked: ReturnType<typeof pack>
      }
    | { ok: false; reason: string } => {
    try {
      return {
        ok: true,
        packed: pack(order),
        ranked: pack(byLocalityRank(fields)),
      }
    } catch (error) {
      return { ok: false, reason: (error as Error).message }
    }
  }

  const plans = tryPackPlans()

  if (!plans.ok) {
    return {
      algorithm: "smith-rule",

      feasible: false,

      fields: [],

      filler: [],

      randomBits: 0,

      reason: plans.reason,

      requiredRandomBits: required,

      structuredBits: totalFloor,

      weightedDepth: Number.POSITIVE_INFINITY,

      weightedDepthRankOrder: Number.POSITIVE_INFINITY,
    }
  }

  const { packed, ranked } = plans

  const { placed, filler, used } = packed

  const allocated: AllocatedField[] = placed.map(({ field, offset }) => {
    const minBits = minBitsForCardinality(field.cardinality)

    const { align = 8, cardinality, locality = "opaque", weight } = field

    return {
      align,

      bits: minBits,

      cardinality,

      locality,

      minBits,

      name: field.name,

      offset,

      priority: weight / minBits,

      slackBits: 0,

      weight,
    }
  })

  const structuredBits = used.size

  const randomBits = filler.reduce((sum, run) => sum + run.bits, 0)

  return {
    algorithm: "smith-rule",

    feasible: true,

    fields: allocated,

    filler,

    randomBits,

    requiredRandomBits: required,

    structuredBits,

    weightedDepth: depthOf(placed),

    weightedDepthRankOrder: depthOf(ranked.placed),
  }
}

// Position starts at the end so csprngInt() triggers the first fillRandom()

// Refill lazily. Only pre-fill eagerly when Web Crypto is present (embedded

// Hosts inject their CSPRNG via configureRandom() before the first draw).

if (_hasWebCrypto) {
  fillRandom(_csprngBuf)

  _csprngPos = 0
}

// Entropy source abstraction for structured-field population. The pool refill

// Path reuses the ALREADY-CSPRNG pool bytes (one getRandomValues per 256 IDs)

// Instead of issuing a fresh syscall per field — same entropy, no per-field

// Syscall. genStructuredParent (no pool) falls back to the csprng buffer.

type Rng = () => number

const _fieldMod = new WeakMap<ReadonlyV8Field, number>()

const fieldMod = (f: ReadonlyV8Field): number => {
  let m = _fieldMod.get(f)

  if (m === absentValue) {
    m = 2 ** f.length

    _fieldMod.set(f, m)
  }

  return m
}

// Layout caches are keyed by canonical structure key, not layout name.

const _structureKeyCache = new WeakMap<ReadonlyV8Layout, string>()

// Canonical key of a layout's field structure. The key is the canonical

// String itself: hashing it would add collision risk for no benefit,

// Since Map handles string keys directly.

export const layoutStructureKey = (layout: ReadonlyV8Layout): string => {
  let k = _structureKeyCache.get(layout)

  if (k === absentValue) {
    k = JSON.stringify(
      layout.fields.map((f) => {
        const { constraint } = f

        let allowed: readonly number[] | null = nullValue

        let minimum: number | null = nullValue

        let maximum: number | null = nullValue

        let monotonic: boolean | null = nullValue

        if (!isMissing(constraint)) {
          allowed = constraint.allowed ?? nullValue

          minimum = constraint.min ?? nullValue

          maximum = constraint.max ?? nullValue

          monotonic = constraint.monotonic ?? nullValue
        }

        return [
          f.name,

          f.start,

          f.length,

          f.type,

          allowed,

          minimum,

          maximum,

          monotonic,

          f.value ?? nullValue,
        ]
      })
    )

    _structureKeyCache.set(layout, k)
  }

  return k
}

const assertLayoutIdentity = (layout: ReadonlyV8Layout): string => {
  const key = layoutStructureKey(layout)

  const seen = _layoutIdentities.get(layout.name)

  if (seen === absentValue) {
    _layoutIdentities.set(layout.name, key)
  } else if (seen !== key) {
    throw new Error(
      `layout "${layout.name}": field structure differs from the previously registered layout "${layout.name}" (registered ${seen.slice(0, 120)} vs new ${key.slice(0, 120)})`
    )
  }

  return key
}

// Resolve a layout's monotonic tick (RFC 9562 §6.2): the wall clock

// Clamped to the last tick ever emitted for this layout. A backwards

// Clock therefore yields the previous tick — never a regressing

// Timestamp — and an advancing clock advances the stored tick.

const currentTick = (layout: ReadonlyV8Layout): number => {
  const now = Date.now()

  const structureKey = assertLayoutIdentity(layout)

  const last = _layoutTick.get(structureKey)

  if (last !== absentValue && now < last) {
    return last
  }

  _layoutTick.set(structureKey, now)

  return now
}

// All structured field values fit in a Number (< 2^53; validateLayout caps

// Structured fields at 48 bits), so plain Number arithmetic is exact and far

// Cheaper than BigInt on the generation hot path.

const structuredValue = (
  layout: ReadonlyV8Layout,
  f: ReadonlyV8Field,
  _rng: Rng,
  now?: number
): number => {
  const mod = fieldMod(f)

  const tick = now ?? currentTick(layout)

  switch (f.type) {
    case "timestamp-ms": {
      return tick % mod
    }

    case "timestamp-us": {
      return (tick * 1000) % mod
    }

    default: {
      return 0
    }
  }
}

const _validated = new Set<string>()

const ensureValidated = (layout: ReadonlyV8Layout): void => {
  const structureKey = assertLayoutIdentity(layout)

  if (!_validated.has(structureKey)) {
    validateLayout(layout)

    _validated.add(structureKey)
  }
}

// Populate timestamp and fixed fields. Counter, shard, node, process, and

// Random fields are left as CSPRNG bytes; repairConstraints (called after this)

// Handles all constraint satisfaction via index-modulo. `now`, when given, is

// The caller-resolved monotonic tick (RFC 9562 §6.2); otherwise the tick is

// Resolved here via currentTick().

const applyStructuredFields = (
  bytes: Uint8Array,

  layout: ReadonlyV8Layout,

  _mask?: readonly number[],

  _rng?: Rng,

  now?: number
): void => {
  const { fields } = layout

  for (const f of fields) {
    if (f.type === "fixed") {
      writeFieldValue(bytes, f, f.value ?? 0)
    } else if (f.type === "timestamp-ms" || f.type === "timestamp-us") {
      writeFieldValue(
        bytes,
        f,
        structuredValue(layout, f, _rng ?? ((): number => 0), now)
      )
    }

    // Counter, shard, node, process, random — stay as CSPRNG bytes
  }
}

/**
 * Compose a child v8 UUID from two parents using field-boundary crossover.
 * `fieldSelect` bit i selects whether field i is taken from parentA (1) or
 * parentB (0). Because each structured field lives in exactly one parent,
 * the child inherits every structured field from one source — no field is
 * ever split across parents.
 *
 * @param {ReadonlyV8Layout} layout - Structured field layout.
 * @param {Readonly<Uint8Array>} parentA - First parent UUID bytes.
 * @param {Readonly<Uint8Array>} parentB - Second parent UUID bytes.
 * @param {number} fieldSelect - Bit mask selecting each field's parent.
 * @returns {Uint8Array} Composed child UUID bytes.
 */

export const composeStructured = (
  layout: ReadonlyV8Layout,

  parentA: Readonly<Uint8Array>,

  parentB: Readonly<Uint8Array>,

  fieldSelect: number
): Uint8Array => {
  ensureValidated(layout)

  const child = new Uint8Array(16)

  for (const [fi, f] of layout.fields.entries()) {
    const takeA = Math.floor(fieldSelect / 2 ** fi) % 2 === 1

    let parent = parentB

    if (takeA) {
      parent = parentA
    }

    copyField(child, parent, f)
  }

  forceVersionVariant(child)

  return child
}

// RFC 9562 §6.2 monotonicity state for the interpreted structured

// Paths. `_layoutTick` is the last tick ever emitted per layout —

// Timestamp fields clamp to max(clock, last tick), so a backwards

// Clock re-emits the previous tick instead of regressing the sort

// Order. `_poolMonoTick` holds each monotonic counter field's global

// Incrementing value; it is reseeded from the CSPRNG only when it

// Exhausts, and only after the clock has advanced past the layout

// Tick (freeze-and-wait), so a reseed never shares a timestamp with

// The previous UUID: the (timestamp, counter) pair is non-decreasing

// In emission order.

// Clipped [min,max] endpoint masses: P(min)=(lo+1)/2^ell, P(max)=(2^ell-hi)/2^ell.

export const rangeClampMass = (
  ell: number,
  min: number,
  max: number
): {
  pMin: number

  pMax: number

  pInterior: number

  pinned: number
} => {
  const space = 2 ** ell

  const lo = Math.max(0, min)

  const hi = Math.min(space - 1, max)

  return {
    pInterior: 1 / space,

    pMax: (space - hi) / space,

    pMin: (lo + 1) / space,

    pinned: (lo + (space - 1 - hi)) / space,
  }
}

const pickFromAllowed = (allowed: readonly number[], byte: number): number => {
  const n = allowed.length

  if (n === 1) {
    return allowed[0]
  }

  return allowed[byte % n]
}

/**
 * Repair per-field constraint violations in place. Returns the number of
 * fields repaired. Cost is O(k) for k constrained fields — independent
 * of the drawn value, unlike rejection sampling.
 *
 * Monotonic fields are handled by the pool refill path's tick-keyed
 * counter logic before this is called.
 *
 * @param {ReadonlyV8Layout} layout - Structured field layout.
 * @param {Uint8Array} bytes - UUID bytes to repair in place.
 * @returns {number} Number of fields repaired.
 */

export const repairConstraints = (
  layout: ReadonlyV8Layout,
  bytes: Uint8Array
): number => {
  let repairs = 0

  for (const f of layout.fields) {
    const { constraint: c } = f

    if (!isMissing(c)) {
      let v = readFieldNumber(bytes, f)

      let changed = false

      if (c.allowed && c.allowed.length > 0 && !c.allowed.includes(v)) {
        v = pickFromAllowed(c.allowed, v)

        changed = true
      }

      if (c.min !== absentValue && v < c.min) {
        v = c.min
        changed = true
      }

      if (c.max !== absentValue && v > c.max) {
        v = c.max
        changed = true
      }

      if (changed) {
        writeFieldValue(bytes, f, v)

        repairs += 1
      }
    }
  }

  return repairs
}

/**
 * Build one valid v8 UUID parent. Fields whose index is in `mask` are
 * populated per their declared type; all other fields receive CSPRNG bytes.
 *
 * @param {ReadonlyV8Layout} layout - Structured field layout.
 * @param {readonly number[]} mask - Field indices to populate.
 * @returns {Uint8Array} Valid v8 parent UUID bytes.
 */

export const genStructuredParent = (
  layout: ReadonlyV8Layout,

  mask: readonly number[]
): Uint8Array => {
  ensureValidated(layout)

  const bytes = new Uint8Array(16)

  fillRandom(bytes)

  applyStructuredFields(bytes, layout, mask)

  repairConstraints(layout, bytes)

  forceVersionVariant(bytes)

  return bytes
}

let _structPoolN = STRUCT_POOL_DEFAULT

const STRUCT_ENTRY = 34

interface SingleParentPool {
  pool: Uint8Array<ArrayBuffer>

  strs: string[]

  idx: number

  size: number
}

const ensureSingleParentPool = (
  structureKey: string,
  size: number
): SingleParentPool => {
  const entry = _spPool.get(structureKey)

  if (entry && entry.pool.length >= STRUCT_ENTRY * size) {
    entry.strs.length = size

    return entry
  }

  const pool = new Uint8Array(STRUCT_ENTRY * size)

  const strs = Array.from<string>({ length: size })

  const created: SingleParentPool = { idx: 0, pool, size, strs }

  _spPool.set(structureKey, created)

  return created
}

const refillSingleParentPool = (layout: ReadonlyV8Layout): void => {
  const size = _structPoolN,
    t = HEX8,
    w = wordTable()

  const structureKey = layoutStructureKey(layout)

  const { pool, strs } = ensureSingleParentPool(structureKey, size)

  fillRandom(pool)

  for (let n = 0; n < size; n += 1) {
    const off = n * STRUCT_ENTRY

    const buf = pool.subarray(off, off + 16)

    // RFC 9562 §6.2: resolve this entry's tick once. The same

    // Clamped tick drives the timestamp field and every monotonic

    // Counter, so a counter reseed only ever accompanies a

    // Strictly larger timestamp.

    let now = Date.now()

    const lastTick = _layoutTick.get(structureKey)

    if (lastTick !== absentValue && now < lastTick) {
      now = lastTick
    } else {
      _layoutTick.set(structureKey, now)
    }

    for (const f of layout.fields) {
      const { constraint } = f

      if (!isMissing(constraint) && constraint.monotonic === true) {
        const key = `${structureKey}:${f.name}`

        const reseedRange = 2 ** (f.length - 1)

        const maxCtr = 2 ** f.length - 1

        let ctr = _poolMonoTick.get(key)

        if (ctr === absentValue) {
          ctr = readFieldNumber(buf, f) % reseedRange
        } else if (ctr >= maxCtr) {
          // Counter exhausted. A wrap is only sortable with a

          // Strictly larger timestamp — freeze generation until the

          // Clock advances past the last tick (RFC 9562 §6.2).

          if (lastTick !== absentValue && now <= lastTick) {
            now = waitForNextTick(lastTick)

            _layoutTick.set(structureKey, now)
          }

          ctr = readFieldNumber(buf, f) % reseedRange
        } else {
          ctr = (ctr + 1) % (maxCtr + 1)
        }

        _poolMonoTick.set(key, ctr)

        writeFieldValue(buf, f, ctr)
      }
    }

    applyStructuredFields(buf, layout, absentValue, absentValue, now)

    forceVersionVariant(buf)

    repairConstraints(layout, buf)

    const c = buf

    strs[n] = formatUuidBytes(c, w, t)
  }

  const entry = need(_spPool.get(structureKey))

  entry.idx = 0
}

export const genStructuredGenoIDSingleParent = (
  layout: ReadonlyV8Layout
): string => {
  ensureValidated(layout)

  const structureKey = layoutStructureKey(layout)

  let p = _spPool.get(structureKey)

  if (!p || p.idx >= p.size) {
    refillSingleParentPool(layout)

    p = need(_spPool.get(structureKey))
  }

  p.idx += 1
  return p.strs[p.idx - 1]
}

/**
 * Production API: compiles the layout into specialized closure-based writers
 * (~8x faster than the generic pooled path). Injected RNGs use the single-parent
 * pool instead.
 *
 * @returns {StructuredGenerationMode} The active structured generation mode.
 */

export const getStructuredGenerationMode = (): StructuredGenerationMode => {
  if (_fillRandom === _webCryptoFill && _hasWebCrypto) {
    return "compiled-direct-v8"
  }

  return "single-parent-pooled"
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
 *
 * @param {PoolConfig} cfg - Pool sizes to apply.
 */

export const configurePools = (cfg: Readonly<PoolConfig>): void => {
  if (cfg.simplePoolSize !== absentValue) {
    const n = cfg.simplePoolSize

    if (!Number.isInteger(n) || n < 1) {
      throw new Error(
        `configurePools: simplePoolSize must be a positive integer, got ${n}`
      )
    }

    _genoPoolN = n

    _genoPool = new Uint8Array(GENO_ENTRY_BYTES * n)

    _genoStrs = Array.from<string>({ length: n })

    // Force a refill on the next genGenoID().

    _genoIdx = n
  }

  if (cfg.structuredPoolSize !== absentValue) {
    const n = cfg.structuredPoolSize

    if (!Number.isInteger(n) || n < 1) {
      throw new Error(
        `configurePools: structuredPoolSize must be a positive integer, got ${n}`
      )
    }

    _structPoolN = n

    // Rebuilt lazily at the new size, per layout.

    _spPool.clear()
  }
}

/** Current effective pool sizes — useful for tests and memory budgeting.
 *
 * @returns {{ simplePoolSize: number; structuredPoolSize: number }} Effective pool sizes.
 */

export const getPoolConfig = (): {
  simplePoolSize: number
  structuredPoolSize: number
} => ({ simplePoolSize: _genoPoolN, structuredPoolSize: _structPoolN })

// ---------------------------------------------------------------------------

// Phase 1: Layout compiler — V8Layout to closure-based field writers.

// ---------------------------------------------------------------------------

export interface CompiledLayout {
  source: string

  fn: () => string
}

const genFieldReadExpr = (bm: readonly ByteMask[], buf = "b"): string => {
  const parts: { expr: string; nbits: number }[] = []

  for (let i = bm.length - 1; i >= 0; i -= 1) {
    const mk = bm[i]

    let expr = `(${buf}[${mk.byte}]&${mk.mask})`

    if (mk.shift > 0) {
      expr = `(${expr}>>>${mk.shift})`
    }

    parts.push({ expr, nbits: mk.width })
  }

  if (parts.length === 0) {
    return "0"
  }

  let result = need(parts.at(-1)).expr

  for (let i = parts.length - 2; i >= 0; i -= 1) {
    const factor = 2 ** parts[i].nbits

    result = `((${result})*${factor}+(${parts[i].expr}))`
  }

  return result
}

const genTimestampExpr = (
  f: ReadonlyV8Field,
  mod: number,
  raw: boolean,
  batchNow: boolean
): string => {
  let timestamp = "Date.now()"

  if (batchNow) {
    timestamp = "_now"
  }

  const microseconds = f.type === "timestamp-us"

  if (raw) {
    if (microseconds) {
      return `(now*1000)%${mod}`
    }

    return `now%${mod}`
  }

  let value = timestamp

  if (microseconds) {
    value = `(${timestamp}*1000)`
  }

  const pow2 =
    mod > 0 && Number.isInteger(Math.log2(mod)) && mod <= 0x7f_ff_ff_ff

  if (pow2) {
    return `${value}&${mod - 1}`
  }

  return `${value}%${mod}`
}

const genCounterExpr = (mod: number, raw: boolean): string => {
  if (raw) {
    return `ctr%${mod}`
  }

  const pow2 =
    mod > 0 && Number.isInteger(Math.log2(mod)) && mod <= 0x7f_ff_ff_ff

  if (pow2) {
    return `(_ctr += 1)&${mod - 1}`
  }

  return `(_ctr += 1)%${mod}`
}

const genSelectorExpr = (
  f: ReadonlyV8Field,
  mod: number,
  bm: readonly ByteMask[],
  buf: string
): string => {
  const { constraint } = f

  let allowed: readonly number[] | undefined = absentValue

  if (!isMissing(constraint)) {
    const { allowed: configuredAllowed } = constraint
    allowed = configuredAllowed
  }

  if (allowed !== absentValue && allowed.length > 0) {
    if (allowed.length === 1) {
      return `${allowed[0]}`
    }

    let randomByte = 15

    if (bm.length > 0) {
      randomByte = need(bm.at(-1)).byte
    }

    return `[${allowed.join(",")}][${buf}[${randomByte}]%${allowed.length}]`
  }

  const firstByte = bm[0].byte

  let secondByte = firstByte

  if (bm.length > 1) {
    secondByte = bm[1].byte
  }

  return `((${buf}[${firstByte}]<<8|${buf}[${secondByte}])%${mod})`
}

const genValueExpr = (
  f: ReadonlyV8Field,
  mod: number,
  bm: readonly ByteMask[],
  raw?: boolean,
  buf = "b",
  batchNow = false
): string => {
  switch (f.type) {
    case "timestamp-ms":
    case "timestamp-us": {
      return genTimestampExpr(f, mod, raw === true, batchNow)
    }

    case "counter": {
      return genCounterExpr(mod, raw === true)
    }

    case "shard":
    case "node":
    case "process": {
      return genSelectorExpr(f, mod, bm, buf)
    }

    case "fixed": {
      return `${f.value ?? 0}`
    }

    case "random": {
      return "0"
    }

    default: {
      return "0"
    }
  }
}

const emitFieldWrite = (
  wp: readonly WritePlanEntry[],
  lines: readonly string[],
  varName = "v",
  mod = 0,
  buf = "b"
): void => {
  const useArith = mod > 2 ** 32

  const output = lines as string[]

  output.push(
    ...wp.map((e) => {
      const s = Math.round(Math.log2(e.divisor))

      const lshift = e.bitOffset

      let srcPart = `((${varName}>>>${s}<<${lshift})&${e.writeMask})`

      if (useArith) {
        srcPart = `((${varName}/${2 ** s})<<${lshift}&${e.writeMask})`
      }

      return `${buf}[${e.byte}]=(${buf}[${e.byte}]&${e.clearMask})|${srcPart};`
    })
  )
}

// Single format expression shared by the raw and pooled compiled emitters.

// The generated function receives byte table `h` and optional word table `w`.

const COMPILED_FMT_EXPR =
  'w?w[(b[0]<<8)|b[1]]+w[(b[2]<<8)|b[3]]+"-"+w[(b[4]<<8)|b[5]]+"-"+w[(b[6]<<8)|b[7]]+"-"+w[(b[8]<<8)|b[9]]+"-"+w[(b[10]<<8)|b[11]]+w[(b[12]<<8)|b[13]]+w[(b[14]<<8)|b[15]]:h[b[0]]+h[b[1]]+h[b[2]]+h[b[3]]+"-"+h[b[4]]+h[b[5]]+"-"+h[b[6]]+h[b[7]]+"-"+h[b[8]]+h[b[9]]+"-"+h[b[10]]+h[b[11]]+h[b[12]]+h[b[13]]+h[b[14]]+h[b[15]]'

const poolfy = (s: string): string => s.replaceAll("b[", "_bp[_o+")

const emitMonotonicClamp = (
  target: readonly string[],
  field: ReadonlyV8Field
): void => {
  const output = target as string[]

  output.push(
    `{const lk="${field.name}";const lv=_last[lk];if(lv!==undefined&&rv<lv){rv=lv;}_last[lk]=rv;}`
  )
}

const genLayoutSource = (
  layout: ReadonlyV8Layout,
  raw: boolean,
  poolSize = 0
): string => {
  const fieldMeta = layout.fields.map((f) => {
    const wp = computeWritePlan(f)

    const bm = fieldByteMasks(f)

    const mod = fieldMod(f)

    const { constraint: c } = f

    return { bm, c, f, mod, wp }
  })

  const lines: string[] = []

  const fieldLines: string[] = []

  // RFC 9562 §6.2 state for compiled generators: `_tick` is the

  // Last tick ever emitted (timestamp fields clamp to

  // Max(clock, _tick)) and `_mctr` holds each monotonic counter

  // Field's global incrementing value. Both live in the compiled

  // Closure, so every compiled generator instance owns an

  // Independent monotonic clock. The raw layout takes the clock

  // And counter as caller-supplied parameters and opts out.

  const needsTick =
    !raw &&
    fieldMeta.some(
      (m) =>
        m.f.type === "timestamp-ms" ||
        m.f.type === "timestamp-us" ||
        (m.f.type === "counter" && isMonotonic(m.f))
    )

  if (raw) {
    lines.push("const _last={};", "return function(b,now,ctr){")
  } else if (poolSize > 0) {
    lines.push("let _ctr=0;")

    if (needsTick) {
      lines.push("let _tick=0;const _mctr={};")
    }

    const hasMono = fieldMeta.some((m) => isMonotonic(m.f))

    if (hasMono) {
      lines.push("const _last={};")
    }

    lines.push(
      `const _bp=new Uint8Array(${poolSize * 16});`,
      `const _p=new Array(${poolSize});`,
      `let _pi=${poolSize};`,
      "return function(){",
      `if(_pi>=${poolSize}){`,
      "cr.getRandomValues(_bp);",
      `for(_pi=0;_pi<${poolSize};_pi += 1){const _o=_pi*16;`
    )
  } else {
    lines.push("const b=new Uint8Array(16);let _ctr=0;")

    if (needsTick) {
      lines.push("let _tick=0;const _mctr={};")
    }

    const hasMono = fieldMeta.some((m) => isMonotonic(m.f))

    if (hasMono) {
      lines.push("const _last={};")
    }

    lines.push("return function(){", "cr.getRandomValues(b);")
  }

  const emitCounterPrologue = (target: readonly string[]): void => {
    if (!needsTick) {
      return
    }

    const output = target as string[]

    output.push("let _now=Date.now();")

    for (const { f } of fieldMeta) {
      if (f.type === "counter" && isMonotonic(f)) {
        const reseedMask = 2 ** (f.length - 1) - 1

        const maxCtr = 2 ** f.length - 1

        output.push(
          `{const lk=${JSON.stringify(f.name)};let c=_mctr[lk];const rs=(${genFieldReadExpr(fieldByteMasks(f))})&${reseedMask};` +
            `if(c===undefined){c=rs}` +
            `else if(c>=${maxCtr}){if(_now<=_tick){${freezeWaitSnippet};_now=Date.now()};c=rs}` +
            `else{c=(c+1)&${maxCtr}}` +
            `_mctr[lk]=c}`
        )
      }
    }

    output.push("if(_now<_tick){_now=_tick}else{_tick=_now}")
  }

  const emitSelectorField = (
    field: ReadonlyV8Field,

    writePlan: readonly WritePlanEntry[],

    mod: number,

    constraint: ReadonlyV8Constraint | undefined,

    target: readonly string[]
  ): void => {
    if (isMissing(constraint)) {
      return
    }

    const { allowed } = constraint

    const hasAllowed = allowed !== absentValue && allowed.length > 0

    const monotonic = constraint.monotonic === true

    if (
      !hasAllowed &&
      constraint.min === absentValue &&
      constraint.max === absentValue &&
      !monotonic
    ) {
      return
    }

    const output = target as string[]

    const readExpr = genFieldReadExpr(fieldByteMasks(field))

    output.push("{")

    if (allowed !== absentValue && allowed.length > 0) {
      output.push(
        `const rv=${JSON.stringify(allowed)}[${readExpr}%${allowed.length}];`
      )
    } else {
      output.push(`let rv=${readExpr};`)
    }

    if (constraint.min !== absentValue) {
      output.push(`if(rv<${constraint.min})rv=${constraint.min};`)
    }

    if (constraint.max !== absentValue) {
      output.push(`if(rv>${constraint.max})rv=${constraint.max};`)
    }

    if (monotonic) {
      emitMonotonicClamp(target, field)
    }

    emitFieldWrite(writePlan, target, "rv", mod)

    output.push("}")
  }

  const emitValueField = (
    field: ReadonlyV8Field,

    writePlan: readonly WritePlanEntry[],

    masks: readonly ByteMask[],

    mod: number,

    constraint: ReadonlyV8Constraint | undefined,

    target: readonly string[]
  ): void => {
    const monoCounter = !raw && field.type === "counter" && isMonotonic(field)

    let valueExpr = genValueExpr(field, mod, masks, raw, "b", true)

    if (monoCounter) {
      valueExpr = `_mctr[${JSON.stringify(field.name)}]`
    }

    const output = target as string[]

    output.push("{")

    if (
      !isMissing(constraint) &&
      (constraint.min !== absentValue ||
        constraint.max !== absentValue ||
        (constraint.monotonic === true && !monoCounter))
    ) {
      output.push(`let rv=${valueExpr};`)

      if (constraint.min !== absentValue) {
        output.push(`if(rv<${constraint.min})rv=${constraint.min};`)
      }

      if (constraint.max !== absentValue) {
        output.push(`if(rv>${constraint.max})rv=${constraint.max};`)
      }

      if (constraint.monotonic === true && !monoCounter) {
        emitMonotonicClamp(target, field)
      }

      emitFieldWrite(writePlan, target, "rv", mod)
    } else {
      output.push(`const v=${valueExpr};`)

      emitFieldWrite(writePlan, target, "v", mod)
    }

    output.push("}")
  }

  const emitFieldBlock = (target: readonly string[]): void => {
    // Resolve the tick and monotonic counters before writing any field so a

    // Counter reseed always accompanies a strictly larger timestamp.

    emitCounterPrologue(target)

    for (const { c, f, mod, wp, bm } of fieldMeta) {
      if (f.type !== "random") {
        if (f.type === "shard" || f.type === "node" || f.type === "process") {
          emitSelectorField(f, wp, mod, c, target)
        } else {
          emitValueField(f, wp, bm, mod, c, target)
        }
      }
    }

    const output = target as string[]

    output.push("b[6]=(b[6]&0x0f)|0x80;b[8]=(b[8]&0x3f)|0x80;")
  }

  if (raw || poolSize === 0) {
    emitFieldBlock(lines)

    lines.push(`return ${COMPILED_FMT_EXPR};`, "};")
  } else {
    // Pooled: emit field + format into fieldLines, then substitute b[ → b[_o+

    emitFieldBlock(fieldLines)

    lines.push(
      ...fieldLines.map((l) => `  ${poolfy(l)}`),
      `  _p[_pi]=${poolfy(COMPILED_FMT_EXPR)};`,
      "}_pi=0;}",
      "return _p[_pi++];",
      "};"
    )
  }

  return lines.join("\n")
}

interface CompiledField {
  readonly field: ReadonlyV8Field

  readonly masks: readonly ByteMask[]

  readonly mod: number

  readonly writePlan: readonly WritePlanEntry[]
}

const selectorValue = (
  field: ReadonlyV8Field,
  bytes: Readonly<Uint8Array>
): number => {
  const value = readFieldNumber(bytes, field)

  const { constraint } = field

  let allowed: readonly number[] | undefined = absentValue

  if (!isMissing(constraint)) {
    const { allowed: configuredAllowed } = constraint
    allowed = configuredAllowed
  }

  if (allowed !== absentValue && allowed.length > 0) {
    return pickFromAllowed(allowed, value)
  }

  return value
}

const createCompiledWriter = (
  layout: ReadonlyV8Layout,
  raw: boolean
): ((bytes: Uint8Array, now: number, ctr: number) => string) => {
  const fields: CompiledField[] = layout.fields.map((field) => ({
    field,

    masks: fieldByteMasks(field),

    mod: fieldMod(field),

    writePlan: computeWritePlan(field),
  }))

  const needsTick =
    !raw &&
    fields.some(
      ({ field }) =>
        field.type === "timestamp-ms" ||
        field.type === "timestamp-us" ||
        (field.type === "counter" && isMonotonic(field))
    )

  let counter = 0

  let tick = 0

  const monotonicCounters = new Map<string, number>()

  const lastValues = new Map<string, number>()

  const resolveTick = (
    bytes: Readonly<Uint8Array>,
    initialNow: number
  ): number => {
    let now = initialNow

    if (!needsTick) {
      return now
    }

    for (const { field } of fields) {
      if (field.type === "counter" && isMonotonic(field)) {
        const reseedMask = 2 ** (field.length - 1) - 1

        const maxCounter = 2 ** field.length - 1

        let value = monotonicCounters.get(field.name)

        const seed = readFieldNumber(bytes, field) % (reseedMask + 1)

        if (value === absentValue) {
          value = seed
        } else if (value >= maxCounter) {
          if (now <= tick) {
            now = waitForNextTick(tick)
          }

          value = seed
        } else {
          value = (value + 1) % (maxCounter + 1)
        }

        monotonicCounters.set(field.name, value)
      }
    }

    if (now < tick) {
      return tick
    }

    tick = now

    return tick
  }

  const baseValue = (
    { field, mod }: Readonly<CompiledField>,
    bytes: Readonly<Uint8Array>,
    now: number,
    ctr: number
  ): number => {
    switch (field.type) {
      case "timestamp-ms": {
        return now % mod
      }

      case "timestamp-us": {
        return (now * 1000) % mod
      }

      case "counter": {
        if (raw) {
          return ctr % mod
        }

        if (isMonotonic(field)) {
          return need(monotonicCounters.get(field.name))
        }

        counter += 1

        return counter % mod
      }

      case "fixed": {
        return field.value ?? 0
      }

      case "shard":
      case "node":
      case "process":
      case "random": {
        return selectorValue(field, bytes)
      }

      default: {
        return selectorValue(field, bytes)
      }
    }
  }

  const constrainValue = (
    meta: Readonly<CompiledField>,
    value: number,
    skipMonotonic: boolean
  ): number => {
    const { constraint } = meta.field

    if (isMissing(constraint)) {
      return value
    }

    let result = value

    if (constraint.min !== absentValue && result < constraint.min) {
      result = constraint.min
    }

    if (constraint.max !== absentValue && result > constraint.max) {
      result = constraint.max
    }

    if (constraint.monotonic === true && !skipMonotonic) {
      const last = lastValues.get(meta.field.name)

      if (last !== absentValue && result < last) {
        result = last
      }

      lastValues.set(meta.field.name, result)
    }

    return result
  }

  return (bytes: Uint8Array, now: number, ctr: number): string => {
    let resolvedNow = now

    if (!raw) {
      resolvedNow = resolveTick(bytes, now)
    }

    for (const meta of fields) {
      const { field } = meta

      if (field.type !== "random") {
        const monoCounter =
          !raw && field.type === "counter" && isMonotonic(field)

        const value = constrainValue(
          meta,
          baseValue(meta, bytes, resolvedNow, ctr),
          monoCounter
        )

        writeFieldValue(bytes, field, value)
      }
    }

    forceVersionVariant(bytes)

    return formatUuidBytes(bytes, wordTable(), HEX8)
  }
}

export const compileLayout = (
  layout: ReadonlyV8Layout,
  poolSize = 0
): CompiledLayout => {
  const source = genLayoutSource(layout, false, poolSize)

  const write = createCompiledWriter(layout, false)

  if (!(poolSize > 0)) {
    const bytes = new Uint8Array(16)

    return {
      fn: () => {
        fillRandom(bytes)

        return write(bytes, Date.now(), 0)
      },

      source,
    }
  }

  if (!Number.isInteger(poolSize)) {
    throw new RangeError(
      `compileLayout: poolSize must be a positive integer, got ${poolSize}`
    )
  }

  const pool = new Uint8Array(poolSize * 16)

  const strings = Array.from<string>({ length: poolSize })

  let index = poolSize

  return {
    fn: () => {
      if (index >= poolSize) {
        fillRandom(pool)

        for (let i = 0; i < poolSize; i += 1) {
          strings[i] = write(pool.subarray(i * 16, i * 16 + 16), Date.now(), 0)
        }

        index = 0
      }

      const value = strings[index]

      index += 1

      return value
    },

    source,
  }
}

export interface CompiledRawLayout {
  source: string

  fn: (b: Uint8Array, now: number, ctr: number) => string
}

export const compileRawLayout = (
  layout: ReadonlyV8Layout
): CompiledRawLayout => {
  const source = genLayoutSource(layout, true)

  const write = createCompiledWriter(layout, true)

  return { fn: (bytes, now, ctr) => write(bytes, now, ctr), source }
}

/**
 * Production API: compiles the layout into specialized field writers.
 * Injected RNGs use the single-parent pool instead.
 *
 * @param {ReadonlyV8Layout | object} input - Layout or compiled layout description to generate from.
 * @returns {string} A structured UUIDv8 string.
 */

export const genStructuredGenoID = (
  input: ReadonlyV8Layout | { readonly layout: ReadonlyV8Layout }
): string => {
  let layout = input as ReadonlyV8Layout

  if ("layout" in input) {
    const { layout: compiledLayout } = input
    layout = compiledLayout
  }

  ensureValidated(layout)

  if (getStructuredGenerationMode() === "compiled-direct-v8") {
    const structureKey = layoutStructureKey(layout)

    const fn = _compiledGenCache.get(structureKey)

    if (fn) {
      return fn()
    }

    try {
      const compiled = compileLayout(layout, 256)

      _compiledGenCache.set(structureKey, compiled.fn)

      return compiled.fn()
    } catch {
      // Compiled writer unavailable. Fall through to the pooled path.
    }
  }

  return genStructuredGenoIDSingleParent(layout)
}

export const scoreLayoutFitness = (
  layout: ReadonlyV8Layout,
  trials = 20_000
): {
  repairsPerUuid: number
  maxAllowedDev: number
  trials: number
} => {
  ensureValidated(layout)

  let repairs = 0

  for (let i = 0; i < trials; i += 1) {
    const b = new Uint8Array(16)

    fillRandom(b)

    forceVersionVariant(b)

    repairs += repairConstraints(layout, b)
  }

  let maxDev = 0

  for (const f of layout.fields) {
    const c = f.constraint

    if (!isMissing(c) && c.allowed && c.allowed.length > 0) {
      const space = 2 ** f.length

      const bias = (space % c.allowed.length) / space

      if (bias > maxDev) {
        maxDev = bias
      }
    }
  }

  const repairsPerUuid = repairs / trials

  return { repairsPerUuid, maxAllowedDev: maxDev, trials }
}

const _interpretLast = new Map<string, number>()

const rawFieldValue = (
  field: ReadonlyV8Field,
  bytes: Readonly<Uint8Array>,
  now: number,
  ctr: number
): number => {
  switch (field.type) {
    case "timestamp-ms": {
      return now % fieldMod(field)
    }

    case "timestamp-us": {
      return (now * 1000) % fieldMod(field)
    }

    case "counter": {
      return ctr % fieldMod(field)
    }

    case "fixed": {
      return field.value ?? 0
    }

    default: {
      return selectorValue(field, bytes)
    }
  }
}

const applyInterpretedConstraint = (
  field: ReadonlyV8Field,

  value: number,

  structureKey: string
): number => {
  const { constraint } = field

  if (isMissing(constraint)) {
    return value
  }

  let result = value

  if (constraint.min !== absentValue && result < constraint.min) {
    result = constraint.min
  }

  if (constraint.max !== absentValue && result > constraint.max) {
    result = constraint.max
  }

  if (constraint.monotonic === true) {
    const key = `${structureKey}:${field.name}`

    const last = _interpretLast.get(key)

    if (last !== absentValue && result < last) {
      result = last
    }

    _interpretLast.set(key, result)
  }

  return result
}

export const interpretRawLayout = (
  layout: ReadonlyV8Layout,

  raw: Uint8Array,

  now: number,

  ctr: number
): string => {
  const structureKey = assertLayoutIdentity(layout)

  const b = new Uint8Array(16)

  if (!isMissing(raw)) {
    let i = 0

    for (const v of raw) {
      if (i >= 16) {
        break
      }

      b[i] = v

      i += 1
    }
  }

  for (const f of layout.fields) {
    if (f.type !== "random") {
      const value = applyInterpretedConstraint(
        f,
        rawFieldValue(f, b, now, ctr),
        structureKey
      )

      writeFieldValue(b, f, value)
    }
  }

  forceVersionVariant(b)

  return toUuidString(b)
}

// ---------------------------------------------------------------------------

// Canonical structured layouts (single source of truth).

//

// These are the layouts used across the benchmark/export/research scripts and

// The browser runner. They are defined once here — the module that owns

// `completeLayout` and the structured framework — so every consumer imports

// The identical object instead of re-declaring it inline (the dbkey layout was

// Previously copy-pasted into 11 sites).

// ---------------------------------------------------------------------------

/** 48-bit timestamp + 8-bit shard (1-5) + 16-bit monotonic counter. */

export const DBKEY_LAYOUT: V8Layout = completeLayout("dbkey", [
  { length: 48, name: "timestamp", start: 0, type: "timestamp-ms" },

  {
    constraint: { allowed: [1, 2, 3, 4, 5] },
    length: 8,
    name: "shard",
    start: 52,
    type: "shard",
  },

  {
    constraint: { monotonic: true },
    length: 16,
    name: "counter",
    start: 66,
    type: "counter",
  },
])

/** 12-bit tenant (1-8) + 8-bit region (1-4). */

export const MULTITENANT_LAYOUT: V8Layout = completeLayout("multitenant", [
  {
    constraint: { allowed: [1, 2, 3, 4, 5, 6, 7, 8] },
    length: 12,
    name: "tenant",
    start: 0,
    type: "shard",
  },

  {
    constraint: { allowed: [1, 2, 3, 4] },
    length: 8,
    name: "region",
    start: 52,
    type: "shard",
  },
])

/** 16-bit stream node + 24-bit monotonic sequence. */

export const EVENTSOURCING_LAYOUT: V8Layout = completeLayout("eventsourcing", [
  { length: 16, name: "stream", start: 0, type: "node" },

  {
    constraint: { monotonic: true },
    length: 24,
    name: "seq",
    start: 66,
    type: "counter",
  },
])

/**
 * Conformance layout: the constraint kinds the shipped layouts do not
 * declare. `dbkey`, `multitenant`, and `eventsourcing` cover allowed-set
 * and monotonic constraints, and the 48-bit timestamp covers a field wider
 * than 32 bits. This layout adds the two that remain: a range constraint
 * (clamped, not remapped) and a `fixed` field (a constant written at
 * composition time, carrying no entropy at all).
 */

export const CONFORMANCE_LAYOUT: V8Layout = completeLayout("conformance", [
  {
    constraint: { max: 4999, min: 100 },
    length: 12,
    name: "window",
    start: 0,
    type: "shard",
  },

  { length: 4, name: "kind", start: 12, type: "fixed", value: 9 },

  { length: 40, name: "wide", start: 66, type: "random" },
])

export const deriveWorkerId = (ipv4: string): number => {
  const parts = ipv4.split(".")
  if (parts.length !== 4) {
    throw new RangeError(`deriveWorkerId: invalid IPv4 "${ipv4}"`)
  }
  for (const p of parts) {
    if (!/^(?<octet>0|[1-9]\d{0,2})$/u.test(p)) {
      throw new RangeError(`deriveWorkerId: invalid IPv4 "${ipv4}"`)
    }
    if (Number(p) > 255) {
      throw new RangeError(`deriveWorkerId: invalid IPv4 "${ipv4}"`)
    }
  }

  let h = 2_166_136_261

  for (let i = 0; i < ipv4.length; i += 1) {
    h = Math.imul(xor32(h, ipv4.codePointAt(i) ?? 0), 16_777_619)

    h = shiftRightUnsignedBits(h, 0)
  }

  return shiftRightUnsignedBits(h, 0) % 65_536
}

export const splitMsFrac = (floatMs: number): { frac: number; ms: number } => {
  if (!Number.isFinite(floatMs) || floatMs < 0) {
    throw new RangeError(`splitMsFrac: expected finite ms >= 0, got ${floatMs}`)
  }
  const ms = Math.trunc(floatMs)
  const frac = Math.trunc((floatMs - ms) * 4096) % 4096
  return { frac, ms }
}

const stegoKeystream = (seed: string, n: number): Uint8Array => {
  let h = 2_166_136_261
  for (let i = 0; i < seed.length; i += 1) {
    h = Math.imul(xor32(h, (seed.codePointAt(i) ?? 0) % 256), 16_777_619)
    h = shiftRightUnsignedBits(h, 0)
  }
  let s = h === 0 ? 1 : h
  const out = new Uint8Array(n)
  for (let i = 0; i < n; i += 1) {
    s = xor32(s, shiftRightUnsignedBits(shiftLeftBits(s, 13), 0))
    s = shiftRightUnsignedBits(s, 0)
    s = xor32(s, shiftRightUnsignedBits(s, 17))
    s = xor32(s, shiftRightUnsignedBits(shiftLeftBits(s, 5), 0))
    s = shiftRightUnsignedBits(s, 0)
    out[i] = ((s % 256) + 256) % 256
  }
  return out
}

export const stegoSeal = (ms: number, seed: string): Uint8Array => {
  if (!Number.isInteger(ms) || ms < 0 || ms >= 2 ** 48) {
    throw new RangeError(`stegoSeal: ms out of 48-bit range: ${ms}`)
  }
  const ks = stegoKeystream(seed, 6)
  const out = new Uint8Array(6)
  for (let i = 0; i < 6; i += 1) {
    const shift = 8 * (5 - i)
    out[i] = xorByte(Math.trunc(ms / 2 ** shift) % 256, ks[i])
  }
  return out
}

export const stegoOpen = (sealed: Uint8Array, seed: string): number => {
  if (sealed.length !== 6) {
    throw new RangeError(`stegoOpen: expected 6 bytes, got ${sealed.length}`)
  }
  const ks = stegoKeystream(seed, 6)
  let ms = 0
  for (let i = 0; i < 6; i += 1) {
    ms = ms * 256 + xorByte(sealed[i], ks[i])
  }
  return ms
}

export const experimentalIntegrityTag = (
  data: Uint8Array,
  key: Uint8Array
): number => {
  if (key.length === 0) {
    throw new RangeError("experimentalIntegrityTag: key must not be empty")
  }
  let h = 2_166_136_261
  for (let i = 0; i < data.length; i += 1) {
    h = Math.imul(xor32(h, xorByte(data[i], key[i % key.length])), 16_777_619)
    h = shiftRightUnsignedBits(h, 0)
  }
  return shiftRightUnsignedBits(h, 0)
}

export const experimentalIntegrityVerify = (
  data: Uint8Array,
  key: Uint8Array,
  tag: number
): boolean => {
  if (key.length === 0) {
    throw new RangeError("experimentalIntegrityVerify: key must not be empty")
  }
  return experimentalIntegrityTag(data, key) === shiftRightUnsignedBits(tag, 0)
}
