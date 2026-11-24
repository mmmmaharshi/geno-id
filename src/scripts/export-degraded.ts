import {
  andBits,
  orBits,
  shiftLeftBits,
  shiftRightBits,
  xorBits,
} from "../shared/bitwise.ts"

import fs from "node:fs"

import { hexVal } from "./shared/export-bits.ts"

import { need } from "../shared/need.ts"
import path from "node:path"

import { pathToFileURL } from "node:url"

const __dirname = import.meta.dirname

const root = path.resolve(__dirname, "..", "..")

const algo = (await import(
  pathToFileURL(path.resolve(root, "dist/algo.js")).href
)) as { toUuidString: (b: Uint8Array) => string }

const { toUuidString } = algo

const HEX_STARTS = [0, 2, 4, 6, 9, 11, 14, 16, 19, 21, 24, 26, 28, 30, 32, 34]

const FREE_MASK = [
  0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0x0F, 0xFF, 0x3F, 0xFF, 0xFF, 0xFF,

  0xFF, 0xFF, 0xFF, 0xFF,
]

const uuidToFreeBits = (uuid: string): string => {
  let bits = ""

  for (let i = 0; i < 16; i += 1) {
    const idx = HEX_STARTS[i]

    const hi = hexVal(need(uuid.codePointAt(idx)))

    const lo = hexVal(need(uuid.codePointAt(idx + 1)))

    const v = orBits(shiftLeftBits(hi, 4), lo)

    const free = andBits(v, FREE_MASK[i])

    for (let b = 0; b < 8; b += 1) {
      if (andBits(FREE_MASK[i], shiftLeftBits(1, b))) {
        let bit = "0"

        if (andBits(shiftRightBits(free, b), 1)) {
          bit = "1"
        }

        bits += bit
      }
    }
  }

  return bits
}

const v8Format = (bytes: Uint8Array): string => {
  bytes[6] = orBits(andBits(bytes[6], 0x0F), 0x80)

  bytes[8] = orBits(andBits(bytes[8], 0x3F), 0x80)

  return toUuidString(bytes)
}

const gaProcess = (parents: Uint8Array): string => {
  const cut = andBits(parents[32], 15)

  const mutPos = andBits(parents[33], 15)

  const child = new Uint8Array(16)

  let j = 0

  for (; j < cut; j += 1) {
    child[j] = parents[j]
  }

  for (; j < 16; j += 1) {
    child[j] = parents[16 + j]
  }

  child[mutPos] = xorBits(child[mutPos], parents[andBits(mutPos + 1, 15)])

  return v8Format(child)
}

// ---- Degraded entropy sources ----

// 1. Biased bytes: P(1) = 0.3

const biasedBytes = (n: number): Uint8Array => {
  const b = new Uint8Array(n)

  for (let i = 0; i < n; i += 1) {
    let v = 0

    for (let j = 0; j < 8; j += 1) {
      if (Math.random() < 0.3) {
        v = orBits(v, shiftLeftBits(1, j))
      }
    }

    b[i] = v
  }

  return b
}

const genBiasedRaw = (): string => v8Format(biasedBytes(16))

const genBiasedGA = (): string => gaProcess(biasedBytes(34))

// 2. Byte correlation: each byte = prev_byte ^ 0xAA (after random seed)

const correlBytes = (n: number): Uint8Array => {
  const b = new Uint8Array(n)

  b[0] = Math.floor(Math.random() * 256)

  for (let i = 1; i < n; i += 1) {
    b[i] = xorBits(b[i - 1], 0xAA)
  }

  return b
}

const genCorrelRaw = (): string => v8Format(correlBytes(16))

const genCorrelGA = (): string => gaProcess(correlBytes(34))

// 3. Range-restricted: bytes 0–127 (MSB always 0)

const restrictedBytes = (n: number): Uint8Array => {
  const b = new Uint8Array(n)

  for (let i = 0; i < n; i += 1) {
    b[i] = Math.floor(Math.random() * 128)
  }

  return b
}

const genRestrictedRaw = (): string => v8Format(restrictedBytes(16))

const genRestrictedGA = (): string => gaProcess(restrictedBytes(34))

// 4. Periodic pattern: XOR with 4-byte repeating pattern

const PATTERN = [0x12, 0x34, 0x56, 0x78]

const periodicBytes = (n: number): Uint8Array => {
  const b = new Uint8Array(n)

  for (let i = 0; i < n; i += 1) {
    const rand = Math.floor(Math.random() * 256)

    b[i] = xorBits(rand, PATTERN[i % 4])
  }

  return b
}

const genPeriodicRaw = (): string => v8Format(periodicBytes(16))

const genPeriodicGA = (): string => gaProcess(periodicBytes(34))

// 5. Truncated LCG (glibc rand())

let lcgState = 42

const lcgBytes = (n: number): Uint8Array => {
  const b = new Uint8Array(n)

  for (let i = 0; i < n; i += 1) {
    lcgState = Math.trunc(lcgState * 1_103_515_245 + 12_345)

    b[i] = andBits(shiftRightBits(lcgState, 16), 0xFF)
  }

  return b
}

const genLCGRaw = (): string => {
  const bytes = lcgBytes(16)

  return v8Format(bytes)
}

const genLCGGA = (): string => {
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
    description: "P(1)=0.3 biased bytes",

    ga: genBiasedGA,

    label: "biased",

    raw: genBiasedRaw,
  },

  {
    description: "byte XOR chain correlation",

    ga: genCorrelGA,

    label: "correl",

    raw: genCorrelRaw,
  },

  {
    description: "bytes 0-127 only",

    ga: genRestrictedGA,

    label: "restricted",

    raw: genRestrictedRaw,
  },

  {
    description: "XOR with 4-byte repeating pattern",

    ga: genPeriodicGA,

    label: "periodic",

    raw: genPeriodicRaw,
  },

  {
    description: "truncated LCG (glibc rand)",

    ga: genLCGGA,

    label: "lcg",

    raw: genLCGRaw,
  },
]

// ---- Export ----

const exportSamples = (
  label: string,

  fn: () => string,

  count: number,
): string => {
  const bits: string[] = Array.from<string>({ length: count })

  for (let i = 0; i < count; i += 1) {
    bits[i] = uuidToFreeBits(fn())
  }

  const allBits = bits.join("")

  const filePath = path.resolve(root, "dist", `degraded-${label}.bits.txt`)

  fs.writeFileSync(filePath, allBits, "utf8")

  console.log(`  ${label}: ${(allBits.length / 1e6).toFixed(1)}M bits`)

  return filePath
}

const N = 10_000

console.log(`Exporting ${N.toLocaleString()} UUIDs per variant...`)

for (const src of sources) {
  console.log(`\n[${src.label}] ${src.description}`)

  exportSamples(`${src.label}-raw`, src.raw, N)

  exportSamples(`${src.label}-ga`, src.ga, N)
}

console.log("\nDone.")
