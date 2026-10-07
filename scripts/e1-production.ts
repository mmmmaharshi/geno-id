import { writeFileSync, mkdirSync } from "node:fs"
import path from "node:path"
import { performance } from "node:perf_hooks"
import { collisionTest } from "../dist/bench-core.js"

const __dirname = import.meta.dirname!
const root = path.resolve(__dirname, "..")
const algoPath = `file://${path.join(root, "dist", "algo.js").replace(/\\/g, "/")}`

const algo = await import(algoPath) as {
  genStructuredGenoID: (l: V8Layout) => string
  uuidToBytes: (uuid: string) => Uint8Array
  getFieldValue: (b: Uint8Array, f: V8Field) => bigint
  DBKEY_LAYOUT: V8Layout
  getStructuredGenerationMode?: () => string
}

const { genStructuredGenoID, uuidToBytes, getFieldValue, DBKEY_LAYOUT } = algo

interface V8Field { name: string; start: number; length: number; type: string; constraint?: { allowed?: number[]; monotonic?: boolean } }
interface V8Layout { name: string; fields: V8Field[] }

// Warm up pools
for (let i = 0; i < 2048; i++) genStructuredGenoID(DBKEY_LAYOUT)

// E1 production: generate UUIDs via shipped path, parse back, verify all fields
const N = 500_000
const structFields = DBKEY_LAYOUT.fields.filter((f) => f.type !== "random")
const totalFieldChecks = N * structFields.length

let mismatchCount = 0
let constraintViolations = 0
let monotonicityViolations = 0
let lastCounterValue = -1n

for (const f of structFields) {
  if (f.name === "counter") break
}

const startTime = performance.now()

for (let i = 0; i < N; i++) {
  const uuid = genStructuredGenoID(DBKEY_LAYOUT)
  const bytes = uuidToBytes(uuid)

  for (const f of structFields) {
    const vRaw = getFieldValue(bytes, f)
    const vParsed = Number(getFieldValue(bytes, f))

    // Manual bit-extraction via independent code path
    let vManual = 0n
    for (let bit = 0; bit < f.length; bit++) {
      const pos = f.start + bit
      const byteIdx = pos >> 3
      const bitIdx = 7 - (pos & 7)
      vManual = (vManual << 1n) | ((BigInt(bytes[byteIdx]) >> BigInt(bitIdx)) & 1n)
    }

    if (vRaw !== vManual || BigInt(vParsed) !== vManual) mismatchCount++

    if (f.constraint?.allowed && !f.constraint.allowed.includes(vParsed)) constraintViolations++

    if (f.name === "counter") {
      if (vManual < lastCounterValue) monotonicityViolations++
      lastCounterValue = vManual
    }
  }
}

const elapsedE1 = performance.now() - startTime

// Collision test (2M)
const collStart = performance.now()
const collisions = collisionTest(() => genStructuredGenoID(DBKEY_LAYOUT), 2_000_000)
const elapsedColl = performance.now() - collStart

const result = {
  experiment: "E1-production-1500k",
  description: "Composition correctness against shipped prod path genStructuredGenoID(DBKEY_LAYOUT)",
  algorithm: typeof algo.getStructuredGenerationMode === "function" ? algo.getStructuredGenerationMode() : "compiled-direct-v8",
  layout: DBKEY_LAYOUT.name,
  layout_fields: DBKEY_LAYOUT.fields.map((f) => ({ name: f.name, type: f.type, start: f.start, length: f.length, constraint: f.constraint })),
  sample_count: N,
  structured_field_count: structFields.length,
  total_field_checks: totalFieldChecks,
  mismatches: mismatchCount,
  constraint_violations: constraintViolations,
  monotonicity_violations: monotonicityViolations,
  pass: mismatchCount === 0 && constraintViolations === 0 && monotonicityViolations === 0,
  collision_test_n: 2_000_000,
  collision_count: collisions,
  elapsed_ms: { e1: Math.round(elapsedE1 * 100) / 100, collision: Math.round(elapsedColl * 100) / 100 },
}

mkdirSync("results", { recursive: true })
writeFileSync("results/e1-production-1500k.json", JSON.stringify(result, null, 2))

console.log("\n=== E1 Production Composition Correctness ===")
console.log("Algorithm:", result.algorithm)
console.log("Layout:", result.layout, `(${structFields.length} structured fields)`)
console.log("UUIDs generated:", N)
console.log("Total field checks:", totalFieldChecks)
console.log("Field-copy mismatches:", mismatchCount)
console.log("Constraint violations (shard in {1..5}):", constraintViolations)
console.log("Monotonicity violations (counter):", monotonicityViolations)
console.log("PASS:", result.pass)
console.log("Collision test (2M):", collisions, "collisions")
console.log("Time: " + result.elapsed_ms.e1.toFixed(1) + "ms E1 + " + result.elapsed_ms.collision.toFixed(1) + "ms collision")
console.log("Result saved: results/e1-production-1500k.json")

