import path from "node:path"
import fs from "node:fs"
import { pathToFileURL } from "node:url"
import type { V8Layout } from "../dist/algo.js"

const __dirname = import.meta.dirname
const root = path.resolve(__dirname, "..")

const algo = await import(pathToFileURL(path.resolve(root, "dist/algo.js")).href)
const { genStructuredGenoID, uuidToRandomBits, DBKEY_LAYOUT, MULTITENANT_LAYOUT, EVENTSOURCING_LAYOUT } = algo as {
  genStructuredGenoID: (l: V8Layout) => string
  uuidToRandomBits: (uuid: string, layout: V8Layout) => string
  DBKEY_LAYOUT: V8Layout
  MULTITENANT_LAYOUT: V8Layout
  EVENTSOURCING_LAYOUT: V8Layout
}

const layouts: V8Layout[] = [DBKEY_LAYOUT, MULTITENANT_LAYOUT, EVENTSOURCING_LAYOUT]

const TARGET_BITS = Number(process.env.GENOID_TARGET_BITS ?? 1_000_000)
const STREAMS = Number(process.env.GENOID_STREAMS ?? 10)

for (const layout of layouts) {
  const randomBitsPerUuid = layout.fields
    .filter((f) => f.type === "random")
    .reduce((s, f) => s + f.length, 0)
  const n = Math.ceil(TARGET_BITS / randomBitsPerUuid)
  for (let s = 0; s < STREAMS; s++) {
    let all = ""
    for (let i = 0; i < n; i++) all += uuidToRandomBits(genStructuredGenoID(layout), layout)
    all = all.slice(0, TARGET_BITS)
    const filePath = path.resolve(root, "dist", `struct-${layout.name}-s${s}.bits.txt`)
    fs.writeFileSync(filePath, all, "utf-8")
    console.log(`Wrote ${layout.name} stream ${s}: ${all.length} bits (${n} UUIDs)`)
  }
}
console.log(`Done. ${STREAMS} streams x ${layouts.length} layouts = ${STREAMS * layouts.length} files.`)
