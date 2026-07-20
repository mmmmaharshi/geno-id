import { type V8Layout } from "../../algo.ts"
import { writeBitsFile } from "./deno-io.ts"

const algo = (await import("../../dist/algo.js")) as {
  genStructuredGenoID: (l: V8Layout) => string
  uuidToRandomBits: (uuid: string, layout: V8Layout) => string
  DBKEY_LAYOUT: V8Layout
  MULTITENANT_LAYOUT: V8Layout
  EVENTSOURCING_LAYOUT: V8Layout
}
const { genStructuredGenoID, uuidToRandomBits, DBKEY_LAYOUT, MULTITENANT_LAYOUT, EVENTSOURCING_LAYOUT } = algo

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
  const file = await writeBitsFile(`struct-${layout.name}.bits.txt`, all)
  console.log(
    `Wrote ${(all.length / 1e6).toFixed(2)}M random bits (${n.toLocaleString()} UUIDs) -> ${file}`,
  )
}
console.log("Done.")
