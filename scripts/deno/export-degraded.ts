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

function v8Format(bytes: Uint8Array): string {
  bytes[6] = (bytes[6] & 0x0f) | 0x80
  bytes[8] = (bytes[8] & 0x3f) | 0x80
  return toUuidString(bytes)
}

function gaProcess(parents: Uint8Array): string {
  const cut = parents[32] & 15
  const mutPos = parents[33] & 15
  const child = new Uint8Array(16)
  let j = 0
  for (; j < cut; j++) child[j] = parents[j]
  for (; j < 16; j++) child[j] = parents[16 + j]
  child[mutPos] ^= parents[(mutPos + 1) & 15]
  return v8Format(child)
}

// ---- Degraded entropy sources ----

// 1. Biased bytes: P(1) = 0.3
function biasedBytes(n: number): Uint8Array {
  const b = new Uint8Array(n)
  for (let i = 0; i < n; i++) {
    let v = 0
    for (let j = 0; j < 8; j++) {
      if (Math.random() < 0.3) v |= 1 << j
    }
    b[i] = v
  }
  return b
}

function genBiasedRaw(): string { return v8Format(biasedBytes(16)) }
function genBiasedGA(): string { return gaProcess(biasedBytes(34)) }

// 2. Byte correlation: each byte = prev_byte ^ 0xAA (after random seed)
function correlBytes(n: number): Uint8Array {
  const b = new Uint8Array(n)
  b[0] = Math.floor(Math.random() * 256)
  for (let i = 1; i < n; i++) b[i] = b[i - 1] ^ 0xAA
  return b
}

function genCorrelRaw(): string { return v8Format(correlBytes(16)) }
function genCorrelGA(): string { return gaProcess(correlBytes(34)) }

// 3. Range-restricted: bytes 0–127 (MSB always 0)
function restrictedBytes(n: number): Uint8Array {
  const b = new Uint8Array(n)
  for (let i = 0; i < n; i++) b[i] = Math.floor(Math.random() * 128)
  return b
}

function genRestrictedRaw(): string { return v8Format(restrictedBytes(16)) }
function genRestrictedGA(): string { return gaProcess(restrictedBytes(34)) }

// 4. Periodic pattern: XOR with 4-byte repeating pattern
const PATTERN = [0x12, 0x34, 0x56, 0x78]
function periodicBytes(n: number): Uint8Array {
  const b = new Uint8Array(n)
  for (let i = 0; i < n; i++) {
    const rand = Math.floor(Math.random() * 256)
    b[i] = rand ^ PATTERN[i % 4]
  }
  return b
}

function genPeriodicRaw(): string { return v8Format(periodicBytes(16)) }
function genPeriodicGA(): string { return gaProcess(periodicBytes(34)) }

// 5. Truncated LCG (glibc rand())
let lcgState = 42
function lcgBytes(n: number): Uint8Array {
  const b = new Uint8Array(n)
  for (let i = 0; i < n; i++) {
    lcgState = (lcgState * 1103515245 + 12345) >>> 0
    b[i] = (lcgState >> 16) & 0xff
  }
  return b
}

function genLCGRaw(): string {
  const bytes = lcgBytes(16)
  return v8Format(bytes)
}

function genLCGGA(): string {
  const parents = lcgBytes(34)
  return gaProcess(parents)
}

// ---- Sources list ----

interface SourceDef {
  label: string
  raw: () => string
  ga: () => string
  description: string
}

const sources: SourceDef[] = [
  {
    label: "biased",
    raw: genBiasedRaw,
    ga: genBiasedGA,
    description: "P(1)=0.3 biased bytes",
  },
  {
    label: "correl",
    raw: genCorrelRaw,
    ga: genCorrelGA,
    description: "byte XOR chain correlation",
  },
  {
    label: "restricted",
    raw: genRestrictedRaw,
    ga: genRestrictedGA,
    description: "bytes 0-127 only",
  },
  {
    label: "periodic",
    raw: genPeriodicRaw,
    ga: genPeriodicGA,
    description: "XOR with 4-byte repeating pattern",
  },
  {
    label: "lcg",
    raw: genLCGRaw,
    ga: genLCGGA,
    description: "truncated LCG (glibc rand)",
  },
]

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
  const file = await writeBitsFile(`degraded-${label}.bits.txt`, allBits)
  console.log(`  ${label}: ${(allBits.length / 1e6).toFixed(1)}M bits`)
  return file.toString()
}

const N = 10_000

console.log(`Exporting ${N.toLocaleString()} UUIDs per variant...`)
for (const src of sources) {
  console.log(`\n[${src.label}] ${src.description}`)
  await exportSamples(`${src.label}-raw`, src.raw, N)
  await exportSamples(`${src.label}-ga`, src.ga, N)
}
console.log("\nDone.")
