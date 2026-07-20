import { writeBitsFile } from "./deno-io.ts"

const algo = (await import("../../dist/algo.js")) as {
  toUuidString: (b: Uint8Array) => string
}
const { toUuidString } = algo

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

function mrByte(): number {
  return Math.floor(Math.random() * 256)
}

function mrBytes(n: number): Uint8Array {
  const b = new Uint8Array(n)
  for (let i = 0; i < n; i++) b[i] = mrByte()
  return b
}

// 1. mr-raw: 16 Math.random bytes, v8 format (no GA)
function genMrRawV8(): string {
  const bytes = mrBytes(16)
  bytes[6] = (bytes[6] & 0x0f) | 0x80
  bytes[8] = (bytes[8] & 0x3f) | 0x80
  return toUuidString(bytes)
}

// 2. mr-genoid: 34 Math.random bytes, full GA (crossover + mutation)
const _child = new Uint8Array(16)
function genMrGenoid(): string {
  const g = mrBytes(34)
  const cut = g[32] & 15
  const mutPos = g[33] & 15
  let j = 0
  for (; j < cut; j++) _child[j] = g[j]
  for (; j < 16; j++) _child[j] = g[16 + j]
  _child[mutPos] ^= g[(mutPos + 1) & 15]
  _child[6] = (_child[6] & 0x0f) | 0x80
  _child[8] = (_child[8] & 0x3f) | 0x80
  return toUuidString(_child)
}

// 3. mr-xonly: 34 Math.random bytes, crossover only, no mutation
const _childX = new Uint8Array(16)
function genMrXonly(): string {
  const g = mrBytes(34)
  const cut = g[32] & 15
  let j = 0
  for (; j < cut; j++) _childX[j] = g[j]
  for (; j < 16; j++) _childX[j] = g[16 + j]
  _childX[6] = (_childX[6] & 0x0f) | 0x80
  _childX[8] = (_childX[8] & 0x3f) | 0x80
  return toUuidString(_childX)
}

// 4. mr-monly: 34 Math.random bytes, mutation only, no crossover
const _childM = new Uint8Array(16)
function genMrMonly(): string {
  const g = mrBytes(34)
  const mutPos = g[33] & 15
  for (let j = 0; j < 16; j++) _childM[j] = g[j]
  _childM[mutPos] ^= g[(mutPos + 1) & 15]
  _childM[6] = (_childM[6] & 0x0f) | 0x80
  _childM[8] = (_childM[8] & 0x3f) | 0x80
  return toUuidString(_childM)
}

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
  const file = await writeBitsFile(`weak-${label}.bits.txt`, allBits)
  console.log(`  ${label}: ${(allBits.length / 1e6).toFixed(1)}M bits`)
  return file.toString()
}

const N = 10_000
const variants: [string, () => string][] = [
  ["mr-raw", genMrRawV8],
  ["mr-genoid", genMrGenoid],
  ["mr-xonly", genMrXonly],
  ["mr-monly", genMrMonly],
]

console.log(`Exporting ${N.toLocaleString()} UUIDs per Math.random variant...`)
for (const [label, fn] of variants) {
  await exportSamples(label, fn, N)
}
console.log("Done.")
