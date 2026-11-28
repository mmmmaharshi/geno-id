import fs from "node:fs"
import path from "node:path"
import { pathToFileURL } from "node:url"

import { genRawV8, uuidToFreeBits } from "./shared/export-bits.ts"

const __dirname = import.meta.dirname

const root = path.resolve(__dirname, "..", "..")

const algo = (await import(
  pathToFileURL(path.resolve(root, "dist/algo.js")).href
)) as {
  genV4Native: () => string

  genGenoID: () => string
}

const { genV4Native, genGenoID } = algo

const generateSamples = (
  label: string,

  fn: () => string,

  count: number
): string => {
  let allBits = ""

  for (let i = 0; i < count; i += 1) {
    allBits += uuidToFreeBits(fn())
  }

  const filePath = path.resolve(root, "dist", `${label}.bits.txt`)

  try {
    fs.writeFileSync(filePath, allBits, "utf8")

    console.log(
      `Wrote ${(allBits.length / 1_000_000).toFixed(1)}M bits to ${filePath}`
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
