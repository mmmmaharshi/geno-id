import path from "node:path"
import fs from "node:fs"
import { pathToFileURL } from "node:url"
import { hexVal, genRawV8 } from "./shared/export-bits.ts"

const __dirname = import.meta.dirname
const root = path.resolve(__dirname, "..")

const algo = await import(pathToFileURL(path.resolve(root, "dist/algo.js")).href)
const { genV4Native, genGenoID } = algo as {
  genV4Native: () => string
  genGenoID: () => string
}


const HEX_STARTS = [0, 2, 4, 6, 9, 11, 14, 16, 19, 21, 24, 26, 28, 30, 32, 34]


const STANDARD_FREE_MASK = [
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
    const free = v & STANDARD_FREE_MASK[i]
    for (let b = 0; b < 8; b++) {
      if (STANDARD_FREE_MASK[i] & (1 << b)) {
        bits += (free >> b) & 1 ? "1" : "0"
      }
    }
  }
  return bits
}

async function generateSamples(
  label: string,
  fn: () => string,
  count: number,
): Promise<string> {
  let allBits = ""
  for (let i = 0; i < count; i++) {
    allBits += uuidToFreeBits(fn())
  }
  const filePath = path.resolve(root, "dist", `${label}.bits.txt`)
  try {
    fs.writeFileSync(filePath, allBits, "utf-8")
    console.log(
      `Wrote ${(allBits.length / 1000000).toFixed(1)}M bits to ${filePath}`,
    )
  } catch (error) {
    console.error(`Failed to write ${filePath}: ${(error as Error).message}`)
  }
  return filePath
}

const N = 10_000
console.log(`Exporting ${N.toLocaleString()} UUIDs per algorithm...`)
await generateSamples("v4", genV4Native, N)
await generateSamples("rawv8", genRawV8, N)
await generateSamples("genoid", genGenoID, N)
console.log("Done.")
