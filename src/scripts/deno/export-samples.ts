import { writeBitsFile } from "./deno-io.ts"
import { hexVal, genRawV8 } from "./export-bits.ts"

const algo = (await import("../../../dist/algo.js")) as {
  genV4Native: () => string
  genGenoID: () => string
}
const { genV4Native, genGenoID } = algo



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
  const file = await writeBitsFile(`${label}.bits.txt`, allBits)
  console.log(
    `Wrote ${(allBits.length / 1000000).toFixed(1)}M bits to ${file}`,
  )
  return file.toString()
}

const N = 10_000
console.log(`Exporting ${N.toLocaleString()} UUIDs per algorithm...`)
await generateSamples("v4", genV4Native, N)
await generateSamples("rawv8", genRawV8, N)
await generateSamples("genoid", genGenoID, N)
console.log("Done.")
