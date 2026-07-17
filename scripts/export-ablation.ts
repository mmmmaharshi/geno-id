import path from "node:path"
import fs from "node:fs"

const __dirname = import.meta.dirname
const root = path.resolve(__dirname, "..")

const algo = await import(path.resolve(root, "dist/algo.js"))
const { toUuidString } = algo as { toUuidString: (b: Uint8Array) => string }

const HEX_STARTS = [0, 2, 4, 6, 9, 11, 14, 16, 19, 21, 24, 26, 28, 30, 32, 34]

function hexVal(c: number): number {
  if (c >= 48 && c <= 57) return c - 48
  if (c >= 97 && c <= 102) return c - 87
  return 0
}

const FREE_MASK = [
  0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0x0f, 0xff, 0x3f, 0xff, 0xff, 0xff,
  0xff, 0xff, 0xff, 0xff,
]

function uuidToFreeBits(uuid: string): string {
  let bits = ""
  for (let i = 0; i < 16; i++) {
    const idx = HEX_STARTS[i]
    const hi = hexVal(uuid.codePointAt(idx)!)
    const lo = hexVal(uuid.codePointAt(idx + 1)!)
    const v = (hi << 4) | lo
    const free = v & FREE_MASK[i]
    for (let b = 0; b < 8; b++) {
      if (FREE_MASK[i] & (1 << b)) {
        bits += (free >> b) & 1 ? "1" : "0"
      }
    }
  }
  return bits
}

// ---- Ablation variants ----

// 1. raw-v8: no GA, just 16 random bytes → v8 format
function genRawV8(): string {
  const bytes = new Uint8Array(16)
  crypto.getRandomValues(bytes)
  bytes[6] = (bytes[6] & 0x0f) | 0x80
  bytes[8] = (bytes[8] & 0x3f) | 0x80
  return toUuidString(bytes)
}

// 2. genoid-full: current GenoID (34B, crossover + mutation)
const POOL = 256, ENTRY = 34
const _pool = new Uint8Array(ENTRY * POOL)
const _strs = new Array<string>(POOL)
let _idx = POOL
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
function genFull(): string {
  if (_idx >= POOL) {
    const t = HEX16_VIEW, g = _pool
    crypto.getRandomValues(g)
    for (let i = 0; i < POOL; i++) {
      const off = i * ENTRY
      const cut = g[off + 32] & 15
      const mutPos = g[off + 33] & 15
      let j = 0
      for (; j < cut; j++) _child[j] = g[off + j]
      for (; j < 16; j++) _child[j] = g[off + 16 + j]
      _child[mutPos] ^= g[off + ((mutPos + 1) & 15)]
      _child[6] = (_child[6] & 0x0f) | 0x80
      _child[8] = (_child[8] & 0x3f) | 0x80
      const v = _child16
      _strs[i] =
        t[v[0]] + t[v[1]] + "-" +
        t[v[2]] + "-" +
        t[v[3]] + "-" +
        t[v[4]] + "-" +
        t[v[5]] + t[v[6]] + t[v[7]]
    }
    _idx = 0
  }
  return _strs[_idx++]
}

// 3. crossover-only: 34B, crossover, NO mutation
const _poolX = new Uint8Array(ENTRY * POOL)
const _strsX = new Array<string>(POOL)
let _idxX = POOL
const _childX = new Uint8Array(16)
const _childX16 = new Uint16Array(_childX.buffer)
function genCrossoverOnly(): string {
  if (_idxX >= POOL) {
    const t = HEX16_VIEW, g = _poolX
    crypto.getRandomValues(g)
    for (let i = 0; i < POOL; i++) {
      const off = i * ENTRY
      const cut = g[off + 32] & 15
      let j = 0
      for (; j < cut; j++) _childX[j] = g[off + j]
      for (; j < 16; j++) _childX[j] = g[off + 16 + j]
      _childX[6] = (_childX[6] & 0x0f) | 0x80
      _childX[8] = (_childX[8] & 0x3f) | 0x80
      const v = _childX16
      _strsX[i] =
        t[v[0]] + t[v[1]] + "-" +
        t[v[2]] + "-" +
        t[v[3]] + "-" +
        t[v[4]] + "-" +
        t[v[5]] + t[v[6]] + t[v[7]]
    }
    _idxX = 0
  }
  return _strsX[_idxX++]
}

// 4. mutation-only: 34B, NO crossover (always all from parent A), mutation
const _poolM = new Uint8Array(ENTRY * POOL)
const _strsM = new Array<string>(POOL)
let _idxM = POOL
const _childM = new Uint8Array(16)
const _childM16 = new Uint16Array(_childM.buffer)
function genMutationOnly(): string {
  if (_idxM >= POOL) {
    const t = HEX16_VIEW, g = _poolM
    crypto.getRandomValues(g)
    for (let i = 0; i < POOL; i++) {
      const off = i * ENTRY
      const mutPos = g[off + 33] & 15
      let j = 0
      for (; j < 16; j++) _childM[j] = g[off + j]
      _childM[mutPos] ^= g[off + ((mutPos + 1) & 15)]
      _childM[6] = (_childM[6] & 0x0f) | 0x80
      _childM[8] = (_childM[8] & 0x3f) | 0x80
      const v = _childM16
      _strsM[i] =
        t[v[0]] + t[v[1]] + "-" +
        t[v[2]] + "-" +
        t[v[3]] + "-" +
        t[v[4]] + "-" +
        t[v[5]] + t[v[6]] + t[v[7]]
    }
    _idxM = 0
  }
  return _strsM[_idxM++]
}

// ---- Export ----

async function exportSamples(
  label: string,
  fn: () => string,
  count: number,
): Promise<string> {
  const bits: string[] = new Array(count)
  for (let i = 0; i < count; i++) {
    bits[i] = uuidToFreeBits(fn())
  }
  const allBits = bits.join("")
  const filePath = path.resolve(root, "dist", `ablation-${label}.bits.txt`)
  fs.writeFileSync(filePath, allBits, "utf-8")
  console.log(`  ${label}: ${(allBits.length / 1e6).toFixed(1)}M bits`)
  return filePath
}

const N = 10_000
const variants: [string, () => string][] = [
  ["rawv8", genRawV8],
  ["full", genFull],
  ["xonly", genCrossoverOnly],
  ["monly", genMutationOnly],
]

console.log(`Exporting ${N.toLocaleString()} UUIDs per variant...`)
for (const [label, fn] of variants) {
  await exportSamples(label, fn, N)
}
console.log("Done.")
