import path from "node:path"
import fs from "node:fs"
import type { V8Field, V8Layout } from "../dist/algo.js"

const __dirname = import.meta.dirname
const root = path.resolve(__dirname, "..")

const algo = await import(path.resolve(root, "dist/algo.js"))
const { genStructuredGenoID, completeLayout } = algo as {
  genStructuredGenoID: (l: V8Layout) => string
  completeLayout: (name: string, core: V8Field[]) => V8Layout
}

const layouts: V8Layout[] = [
  completeLayout("dbkey", [
    { name: "timestamp", start: 0, length: 48, type: "timestamp-ms" },
    { name: "shard", start: 52, length: 8, type: "shard", constraint: { allowed: [1, 2, 3, 4, 5] } },
    { name: "counter", start: 66, length: 16, type: "counter", constraint: { monotonic: true } },
  ]),
  completeLayout("multitenant", [
    { name: "tenant", start: 0, length: 12, type: "shard", constraint: { allowed: [1, 2, 3, 4, 5, 6, 7, 8] } },
    { name: "region", start: 52, length: 8, type: "shard", constraint: { allowed: [1, 2, 3, 4] } },
  ]),
  completeLayout("eventsourcing", [
    { name: "stream", start: 0, length: 16, type: "node" },
    { name: "seq", start: 66, length: 24, type: "counter", constraint: { monotonic: true } },
  ]),
]

function uuidToBytes(uuid: string): Uint8Array {
  const h = uuid.replaceAll("-", "")
  const b = new Uint8Array(16)
  for (let i = 0; i < 16; i++) b[i] = Number.parseInt(h.slice(i * 2, i * 2 + 2), 16)
  return b
}

// Extract only the bits belonging to random fields — the high-entropy part
// that NIST should assess. Structured fields are low-entropy by design and
// must not poison the randomness test.
function uuidToRandomBits(uuid: string, layout: V8Layout): string {
  const b = uuidToBytes(uuid)
  let bits = ""
  for (const f of layout.fields) {
    if (f.type !== "random") continue
    for (let i = 0; i < f.length; i++) {
      const pos = f.start + i
      const bit = (b[pos >> 3] >> (7 - (pos & 7))) & 1
      bits += bit ? "1" : "0"
    }
  }
  return bits
}

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
