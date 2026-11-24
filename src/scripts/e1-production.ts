import type { V8Field, V8Layout } from "../../dist/algo.js"
import {
  andBits,
  orBits,
  shiftLeftBits,
  shiftRightBits,
} from "../shared/bitwise.ts"

import { mkdirSync, writeFileSync } from "node:fs"

import { collisionTest } from "../../dist/bench-core.js"

import { need } from "../shared/need.ts"

import { nullValue } from "./shared/runtime-values.ts"

import path from "node:path"

import { performance } from "node:perf_hooks"

const __dirname = need(import.meta.dirname)

const root = path.resolve(__dirname, "..", "..")

const algoPath = `file://${path.join(root, "dist", "algo.js").replaceAll("\\", "/")}`

const algo = (await import(algoPath)) as {
  genStructuredGenoID: (l: V8Layout) => string

  uuidToBytes: (uuid: string) => Uint8Array

  getFieldValue: (b: Uint8Array, f: V8Field) => bigint

  DBKEY_LAYOUT: V8Layout

  getStructuredGenerationMode?: () => string
}

const { genStructuredGenoID, uuidToBytes, getFieldValue, DBKEY_LAYOUT } = algo

// Manual bit-extraction of a field, mirroring the loop below

// But for the timestamp field (independent code path).

const vManualTs = (bytes: Uint8Array, layout: V8Layout): bigint => {
  const f = layout.fields.find(
    (field) => field.type === "timestamp-ms" || field.type === "timestamp-us",
  )

  if (!f) {
    return -1n
  }

  let v = 0n

  for (const bitIndex of Array.from(
    { length: f.length },
    (_, index) => index,
  )) {
    const pos = f.start + bitIndex

    const byteIdx = shiftRightBits(pos, 3)

    const bitIdx = 7 - andBits(pos, 7)

    const shifted = shiftRightBits(BigInt(bytes[byteIdx]), BigInt(bitIdx))

    const bitValue = andBits(shifted, 1n)

    v = orBits(shiftLeftBits(v, 1n), bitValue)
  }

  return v
}

// Warm up pools

for (let i = 0; i < 2048; i += 1) {
  genStructuredGenoID(DBKEY_LAYOUT)
}

// E1 production: generate UUIDs via shipped path, parse back, verify all fields

const N = 500_000

const structFields = DBKEY_LAYOUT.fields.filter((f) => f.type !== "random")

const totalFieldChecks = N * structFields.length

let mismatchCount = 0

let constraintViolations = 0

let monotonicityViolations = 0

// RFC 9562 §6.2: the (timestamp, counter) pair must be

// Non-decreasing in emission order. The counter alone may

// Decrease exactly when its run exhausts and the clock has

// Advanced — the reseed always accompanies a strictly

// Larger timestamp, so the pair never regresses.

let lastTs = -1n

let lastCtr = -1n

for (const f of structFields) {
  if (f.name === "counter") {
    break
  }
}

const startTime = performance.now()

for (let i = 0; i < N; i += 1) {
  const uuid = genStructuredGenoID(DBKEY_LAYOUT)

  const bytes = uuidToBytes(uuid)

  for (const f of structFields) {
    const vRaw = getFieldValue(bytes, f)

    const vParsed = Number(getFieldValue(bytes, f))

    // Manual bit-extraction via independent code path

    let vManual = 0n

    for (const bitIndex of Array.from(
      { length: f.length },
      (_, index) => index,
    )) {
      const pos = f.start + bitIndex

      const byteIdx = shiftRightBits(pos, 3)

      const bitIdx = 7 - andBits(pos, 7)

      const shifted = shiftRightBits(BigInt(bytes[byteIdx]), BigInt(bitIdx))

      const bitValue = andBits(shifted, 1n)

      vManual = orBits(shiftLeftBits(vManual, 1n), bitValue)
    }

    if (vRaw !== vManual || BigInt(vParsed) !== vManual) {
      mismatchCount += 1
    }

    const { constraint } = f

    if (
      constraint &&
      constraint.allowed &&
      !constraint.allowed.includes(vParsed)
    ) {
      constraintViolations += 1
    }

    if (f.name === "counter") {
      const ts = vManualTs(bytes, DBKEY_LAYOUT)

      if (ts < lastTs || (ts === lastTs && vManual < lastCtr)) {
        monotonicityViolations += 1
      }

      lastTs = ts

      lastCtr = vManual
    }
  }
}

const elapsedE1 = performance.now() - startTime

// Collision test (2M)

const collStart = performance.now()

const collisions = collisionTest(
  () => genStructuredGenoID(DBKEY_LAYOUT),
  2_000_000,
)

const elapsedColl = performance.now() - collStart

let algorithm = "compiled-direct-v8"

if (typeof algo.getStructuredGenerationMode === "function") {
  algorithm = algo.getStructuredGenerationMode()
}

const result = {
  algorithm,

  collision_count: collisions,

  collision_test_n: 2_000_000,

  constraint_violations: constraintViolations,

  description:
    "Composition correctness against shipped prod path genStructuredGenoID(DBKEY_LAYOUT)",

  elapsed_ms: {
    collision: Math.round(elapsedColl * 100) / 100,
    e1: Math.round(elapsedE1 * 100) / 100,
  },

  experiment: "E1-production-1500k",

  layout: DBKEY_LAYOUT.name,

  layout_fields: DBKEY_LAYOUT.fields.map((f) => ({
    constraint: f.constraint,
    length: f.length,
    name: f.name,
    start: f.start,
    type: f.type,
  })),

  mismatches: mismatchCount,

  monotonicity_violations: monotonicityViolations,

  pass:
    mismatchCount === 0 &&
    constraintViolations === 0 &&
    monotonicityViolations === 0,

  sample_count: N,

  structured_field_count: structFields.length,

  total_field_checks: totalFieldChecks,
}

mkdirSync("results", { recursive: true })

writeFileSync(
  "results/e1-production-1500k.json",
  JSON.stringify(result, nullValue, 2),
)

console.log("\n=== E1 Production Composition Correctness ===")

console.log("Algorithm:", result.algorithm)

console.log(
  "Layout:",
  result.layout,
  `(${structFields.length} structured fields)`,
)

console.log("UUIDs generated:", N)

console.log("Total field checks:", totalFieldChecks)

console.log("Field-copy mismatches:", mismatchCount)

console.log("Constraint violations (shard in {1..5}):", constraintViolations)

console.log(
  "Monotonicity violations ((timestamp,counter) pair):",
  monotonicityViolations,
)

console.log("PASS:", result.pass)

console.log("Collision test (2M):", collisions, "collisions")

console.log(
  `Time: ${result.elapsed_ms.e1.toFixed(1)}ms E1 + ${result.elapsed_ms.collision.toFixed(1)}ms collision`,
)

console.log("Result saved: results/e1-production-1500k.json")
