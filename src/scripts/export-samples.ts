import {
  andBits,
  orBits,
  shiftLeftBits,
  shiftRightBits,
} from "../shared/bitwise.ts"

import { genRawV8, hexVal } from "./shared/export-bits.ts"

import fs from "node:fs"

import { need } from "../shared/need.ts"
import path from "node:path"

import { pathToFileURL } from "node:url"

const __dirname = import.meta.dirname

const root = path.resolve(__dirname, "..", "..")

const algo = (await import(
  pathToFileURL(path.resolve(root, "dist/algo.js")).href
)) as {
  genV4Native: () => string

  genGenoID: () => string
}

const { genV4Native, genGenoID } = algo

const HEX_STARTS = [0, 2, 4, 6, 9, 11, 14, 16, 19, 21, 24, 26, 28, 30, 32, 34]

const STANDARD_FREE_MASK = [
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

    const free = andBits(v, STANDARD_FREE_MASK[i])

    for (let b = 0; b < 8; b += 1) {
      if (andBits(STANDARD_FREE_MASK[i], shiftLeftBits(1, b))) {
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

const generateSamples = (
  label: string,

  fn: () => string,

  count: number,
): string => {
  let allBits = ""

  for (let i = 0; i < count; i += 1) {
    allBits += uuidToFreeBits(fn())
  }

  const filePath = path.resolve(root, "dist", `${label}.bits.txt`)

  try {
    fs.writeFileSync(filePath, allBits, "utf8")

    console.log(
      `Wrote ${(allBits.length / 1_000_000).toFixed(1)}M bits to ${filePath}`,
    )
  } catch (error) {
    console.error(`Failed to write ${filePath}: ${(error as Error).message}`)
  }

  return filePath
}

const N = 10_000

console.log(`Exporting ${N.toLocaleString()} UUIDs per algorithm...`)

generateSamples("v4", genV4Native, N)

generateSamples("rawv8", genRawV8, N)

generateSamples("genoid", genGenoID, N)

console.log("Done.")
