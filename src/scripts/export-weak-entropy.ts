import fs from "node:fs"
import path from "node:path"
import { pathToFileURL } from "node:url"

import {
  andBits,
  orBits,
  shiftLeftBits,
  shiftRightBits,
  xorBits,
} from "../shared/bitwise.ts"
import { need } from "../shared/need.ts"
import { hexVal } from "./shared/export-bits.ts"

const __dirname = import.meta.dirname

const root = path.resolve(__dirname, "..", "..")

const algo = (await import(
  pathToFileURL(path.resolve(root, "dist/algo.js")).href
)) as { toUuidString: (b: Uint8Array) => string }

const { toUuidString } = algo

const HEX_STARTS = [0, 2, 4, 6, 9, 11, 14, 16, 19, 21, 24, 26, 28, 30, 32, 34]

const FREE_MASK = [
  0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0x0f, 0xff, 0x3f, 0xff, 0xff, 0xff,

  0xff, 0xff, 0xff, 0xff,
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

const mrByte = (): number => Math.floor(Math.random() * 256)

const mrBytes = (n: number): Uint8Array => {
  const b = new Uint8Array(n)

  for (let i = 0; i < n; i += 1) {
    b[i] = mrByte()
  }

  return b
}

// 1. mr-raw: 16 Math.random bytes, v8 format (no GA)

const genMrRawV8 = (): string => {
  const bytes = mrBytes(16)

  bytes[6] = orBits(andBits(bytes[6], 0x0f), 0x80)

  bytes[8] = orBits(andBits(bytes[8], 0x3f), 0x80)

  return toUuidString(bytes)
}

// 2. mr-genoid: 34 Math.random bytes, full GA (crossover + mutation)

const _child = new Uint8Array(16)

const genMrGenoid = (): string => {
  const g = mrBytes(34)

  const cut = andBits(g[32], 15)

  const mutPos = andBits(g[33], 15)

  let j = 0

  for (; j < cut; j += 1) {
    _child[j] = g[j]
  }

  for (; j < 16; j += 1) {
    _child[j] = g[16 + j]
  }

  _child[mutPos] = xorBits(_child[mutPos], g[andBits(mutPos + 1, 15)])

  _child[6] = orBits(andBits(_child[6], 0x0f), 0x80)

  _child[8] = orBits(andBits(_child[8], 0x3f), 0x80)

  return toUuidString(_child)
}

// 3. mr-xonly: 34 Math.random bytes, crossover only, no mutation

const _childX = new Uint8Array(16)

const genMrXonly = (): string => {
  const g = mrBytes(34)

  const cut = andBits(g[32], 15)

  let j = 0

  for (; j < cut; j += 1) {
    _childX[j] = g[j]
  }

  for (; j < 16; j += 1) {
    _childX[j] = g[16 + j]
  }

  _childX[6] = orBits(andBits(_childX[6], 0x0f), 0x80)

  _childX[8] = orBits(andBits(_childX[8], 0x3f), 0x80)

  return toUuidString(_childX)
}

// 4. mr-monly: 34 Math.random bytes, mutation only, no crossover

const _childM = new Uint8Array(16)

const genMrMonly = (): string => {
  const g = mrBytes(34)

  const mutPos = andBits(g[33], 15)

  for (let j = 0; j < 16; j += 1) {
    _childM[j] = g[j]
  }

  _childM[mutPos] = xorBits(_childM[mutPos], g[andBits(mutPos + 1, 15)])

  _childM[6] = orBits(andBits(_childM[6], 0x0f), 0x80)

  _childM[8] = orBits(andBits(_childM[8], 0x3f), 0x80)

  return toUuidString(_childM)
}

const exportSamples = (
  label: string,

  fn: () => string,

  count: number
): string => {
  const bits: string[] = Array.from({ length: count })

  for (let i = 0; i < count; i += 1) {
    bits[i] = uuidToFreeBits(fn())
  }

  const allBits = bits.join("")

  const filePath = path.resolve(root, "dist", `weak-${label}.bits.txt`)

  fs.writeFileSync(filePath, allBits, "utf8")

  console.log(`  ${label}: ${(allBits.length / 1e6).toFixed(1)}M bits`)

  return filePath
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
  exportSamples(label, fn, N)
}

console.log("Done.")
