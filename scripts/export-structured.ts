import path from "node:path"
import fs from "node:fs"
import type { V8Layout } from "../dist/algo.js"

const __dirname = import.meta.dirname
const root = path.resolve(__dirname, "..")

const algo = await import(path.resolve(root, "dist/algo.js"))
const { genStructuredGenoID, uuidToRandomBits, DBKEY_LAYOUT, MULTITENANT_LAYOUT, EVENTSOURCING_LAYOUT } = algo as {
  genStructuredGenoID: (l: V8Layout) => string
  uuidToRandomBits: (uuid: string, layout: V8Layout) => string
  DBKEY_LAYOUT: V8Layout
  MULTITENANT_LAYOUT: V8Layout
  EVENTSOURCING_LAYOUT: V8Layout
}

const layouts: V8Layout[] = [
  DBKEY_LAYOUT,
  MULTITENANT_LAYOUT,
  EVENTSOURCING_LAYOUT,
]

const TARGET_BITS = 1_220_000

for (const layout of layouts) {
  const randomBitsPerUuid = layout.fields
    .filter((f) => f.type === "random")
    .reduce((s, f) => s + f.length, 0)
  const n = Math.ceil(TARGET_BITS / randomBitsPerUuid)
  let all = ""
  for (let i = 0; i < n; i++) all += uuidToRandomBits(genStructuredGenoID(layout), layout)
  all = all.slice(0, TARGET_BITS)
  const filePath = path.resolve(root, "dist", `struct-${layout.name}.bits.txt`)
  fs.writeFileSync(filePath, all, "utf-8")
  console.log(
    `Wrote ${(all.length / 1e6).toFixed(2)}M random bits (${n.toLocaleString()} UUIDs) -> ${filePath}`,
  )
}
console.log("Done.")
