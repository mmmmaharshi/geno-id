import { performance } from "node:perf_hooks"
import { pathToFileURL } from "node:url"
import path from "node:path"

const __dirname = import.meta.dirname
const root = path.resolve(__dirname, "..")

const algo = await import(pathToFileURL(path.resolve(root, "dist/algo.js")).href)
const {
  genStructuredGenoID,
  genStructuredGenoIDSingleParent,
  repairConstraints,
  forceVersionVariant,
  DBKEY_LAYOUT,
  HEX8,
  wordTable,
  configureRandom,
  createSeededRandom,
  resetSeededState,
} = algo as {
  genStructuredGenoID: (l: any) => string
  genStructuredGenoIDSingleParent: (l: any) => string
  repairConstraints: (l: any, b: Uint8Array) => number
  forceVersionVariant: (b: Uint8Array) => void
  DBKEY_LAYOUT: any
  HEX8: string[]
  wordTable: () => string[] | null
  configureRandom: (fn: ((buf: Uint8Array) => void) | null) => void
  createSeededRandom: (s0: number, s1: number) => (buf: Uint8Array) => void
  resetSeededState: () => void
}

const L = DBKEY_LAYOUT as any
const N = 500_000
const WARM = 4096

function benchSync(fn: () => string, n: number): number {
  for (let i = 0; i < WARM; i++) fn()
  const start = performance.now()
  for (let i = 0; i < n; i++) fn()
  return n / ((performance.now() - start) / 1000)
}

// Word of warning: all numbers from this script come from Windows/Bun.
// Table 2 runs on Ubuntu/Bun CI — multiply by ~3.8 for CI projection.


// ── Arm A: single-parent pooled + pre-computed string buffer ──
function armA(): number {
  for (let i = 0; i < WARM; i++) genStructuredGenoIDSingleParent(L)
  return benchSync(() => genStructuredGenoIDSingleParent(L), N)
}

// ── Arm B: single-parent pooled, format-on-read (no string cache) ──
const B_SIZE = 256
const B_POOL = new Uint8Array(34 * B_SIZE)
const B_TMP = new Uint8Array(16)
let B_IDX = B_SIZE

function refillB(): void {
  crypto.getRandomValues(B_POOL)
  for (let n = 0; n < B_SIZE; n++) {
    const off = n * 34
    const src = B_POOL.subarray(off, off + 16)
    B_TMP.set(src)
    forceVersionVariant(B_TMP)
    repairConstraints(L, B_TMP)
    B_POOL.set(B_TMP, off)
  }
  B_IDX = 0
}

function genB(): string {
  if (B_IDX >= B_SIZE) refillB()
  const off = B_IDX * 34
  const src = B_POOL.subarray(off, off + 16)
  B_IDX++
  const t = HEX8
  return t[src[0]] + t[src[1]] + t[src[2]] + t[src[3]] + "-" +
    t[src[4]] + t[src[5]] + "-" +
    t[src[6]] + t[src[7]] + "-" +
    t[src[8]] + t[src[9]] + "-" +
    t[src[10]] + t[src[11]] + t[src[12]] + t[src[13]] + t[src[14]] + t[src[15]]
}

function armB(): number {
  for (let i = 0; i < WARM; i++) genB()
  return benchSync(genB, N)
}

// ── Arm C: two-parent compiled (default crypto) ──
function armC(): number {
  for (let i = 0; i < WARM; i++) genStructuredGenoID(L)
  return benchSync(() => genStructuredGenoID(L), N)
}

// ── Arm D: two-parent POOLED (seeded RNG disables compiled path) ──
function armD(): number {
  configureRandom(createSeededRandom(0xdeadbeef, 0x4f15f00d))
  resetSeededState()
  for (let i = 0; i < WARM; i++) genStructuredGenoID(L)
  const r = benchSync(() => genStructuredGenoID(L), N)
  configureRandom(null)
  return r
}

// ── Arm E: single-parent COMPILED (per-call, all inline, no pool) ──
// Replicates what compileLayout would generate for a single-parent dbkey layout.
// Inline: timestamp write, version/variant, shard modulo, counter increment, hex format.
const ALLOWED = [1, 2, 3, 4, 5]
let E_TICK = 0
let E_CTR = 0
let E_FIRST = true

function genE(): string {
  const b = new Uint8Array(16)
  crypto.getRandomValues(b)
  const tau = Date.now()

  // Clock-regression guard + counter
  if (E_FIRST) { E_TICK = tau; E_CTR = 0; E_FIRST = false }
  if (tau > E_TICK) {
    E_TICK = tau
    // reseed: draw from random
    E_CTR = (b[10] | (b[11] << 8)) & 0x7fff  // g=1 guard bit
  } else if (tau === E_TICK) {
    E_CTR++
  }

  // Write 48-bit timestamp (bits 0-47)
  b[0] = (tau / 2**40) & 0xff
  b[1] = (tau / 2**32) & 0xff
  b[2] = (tau / 2**24) & 0xff
  b[3] = (tau / 2**16) & 0xff
  b[4] = (tau / 2**8) & 0xff
  b[5] = tau & 0xff

  // Version nibble at bits 48-51 (byte 6 high nibble)
  b[6] = (b[6] & 0x0f) | 0x80

  // Variant at bits 64-65 (byte 8 high 2 bits)
  b[8] = (b[8] & 0x3f) | 0x80

  // Repair shard (bits 52-59): extract, mod 5, map to allowed, write back
  // bit 52 = byte6[4], bit 59 = byte7[3]
  const rawShard = ((b[6] & 0x0f) << 4) | ((b[7] >> 4) & 0x0f)
  const shardVal = ALLOWED[rawShard % 5]
  b[6] = (b[6] & 0xf0) | ((shardVal >> 4) & 0x0f)
  b[7] = (b[7] & 0x0f) | ((shardVal & 0x0f) << 4)

  // Write counter (bits 66-81, length 16)
  // byte8 lower 6 bits = counter[15:10]; byte9 = counter[9:2]; byte10 upper 2 = counter[1:0]
  // Preserve variant (upper 2 bits of byte 8 = 0xc0)
  b[8] = (b[8] & 0xc0) | ((E_CTR >> 10) & 0x3f)
  b[9] = (E_CTR >> 2) & 0xff
  b[10] = (b[10] & 0x3f) | ((E_CTR & 0x03) << 6)

  // Format to hex (16 HEX8 lookups + 4 hyphens)
  const h = HEX8
  return h[b[0]] + h[b[1]] + h[b[2]] + h[b[3]] + "-" +
    h[b[4]] + h[b[5]] + "-" +
    h[b[6]] + h[b[7]] + "-" +
    h[b[8]] + h[b[9]] + "-" +
    h[b[10]] + h[b[11]] + h[b[12]] + h[b[13]] + h[b[14]] + h[b[15]]
}

function armE(): number {
  E_FIRST = true
  for (let i = 0; i < WARM; i++) genE()
  return benchSync(genE, N)
}

// ── Run ──
console.log("=== Crossover ablation: 5-arm comparison ===")
console.log(`layout=dbkey, n=${N}, warm=${WARM}`)
console.log(`WARNING: all numbers from Windows/Bun. CI (Ubuntu/Bun) is ~3.8× faster.\n`)

const a = armA()
const b = armB()
const c = armC()
const d = armD()
const e = armE()

console.log(`Arm A: single-parent pooled (pre-computed strs):  ${a.toFixed(0)} ops/sec`)
console.log(`Arm B: single-parent pooled (raw format on read): ${b.toFixed(0)} ops/sec`)
console.log(`Arm C: two-parent compiled:                       ${c.toFixed(0)} ops/sec`)
console.log(`Arm D: two-parent pooled:                         ${d.toFixed(0)} ops/sec`)
console.log(`Arm E: single-parent compiled (inline):           ${e.toFixed(0)} ops/sec`)

console.log(`\n--- Ratios ---`)
console.log(`A / B (string buffer effect):                   ${(a / b).toFixed(2)}x`)
console.log(`D / A (two-parent vs single, both pooled):      ${(d / a).toFixed(2)}x`)
console.log(`E / A (compiled vs pooled, single-parent):      ${(e / a).toFixed(2)}x`)
console.log(`C / E (compiled two-parent vs compiled single): ${(c / e).toFixed(2)}x`)
console.log(`E / C (single-parent compiled / two-parent cmp): ${(e / c).toFixed(2)}x`)
console.log(`C / A (two-parent compiled vs single pooled):   ${(c / a).toFixed(2)}x`)

// Projection to CI (Ubuntu/Bun) using A as anchor
const CI_ANCHOR = 522093  // Arm A on this machine
const CI_TABLE2_STRUCTURED = 1_810_000  // from Table 2 (Ubuntu/Bun)
const RIG_FACTOR = CI_TABLE2_STRUCTURED / CI_ANCHOR
console.log(`\n--- CI projection (rig factor ${RIG_FACTOR.toFixed(2)}×) ---`)
console.log(`Single-parent compiled (projected): ${(e * RIG_FACTOR / 1e6).toFixed(2)}M ops/sec`)
console.log(`Two-parent compiled (projected):    ${(c * RIG_FACTOR / 1e6).toFixed(2)}M ops/sec`)
console.log(`v4-native (Table 2):                18.37M ops/sec`)
console.log(`genoid-v8 unstructured (Table 2):   17.46M ops/sec`)
