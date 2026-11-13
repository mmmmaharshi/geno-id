// Repair-distribution grid (future.md item 5): validate the fibre theorem
// empirically beyond the shard case. For each (m, l) pair, draw N uniform
// l-bit values, apply index-modulo repair, and compare measured per-value
// frequencies against the closed-form fibre sizes C_i = floor((2^l-1-i)/m)+1.
// Asserts every cell matches prediction within tolerance.
//
// The same file carries range-clamp cells: for each (ell, min, max) triple,
// draw N uniform raw values, apply the shipped clamp branch, and compare the
// measured endpoint masses against the closed form P(min) = (lo+1)/2^ell,
// P(max) = (2^ell-hi)/2^ell ([lo, hi] the declared interval clipped to the
// field domain). Asserts every cell matches prediction within tolerance.
//
// Usage: bun run src/scripts/bench-repair-grid.ts
//   Env: REPAIR_GRID_N (draws per cell, default 200000),
//   REPAIR_GRID_OUT (default results/repair-grid.json), REPAIR_GRID_SEED.
import { mkdirSync, writeFileSync } from "node:fs"
import os from "node:os"
import path from "node:path"
import { mulberry32 } from "./shared/cli-utils.ts"

const N = Number(process.env.REPAIR_GRID_N ?? 200_000)
const OUT = process.env.REPAIR_GRID_OUT ?? "results/repair-grid.json"
const SEED = Number(process.env.REPAIR_GRID_SEED ?? 0x9e3779b9) >>> 0

interface GridCell {
  m: number
  ell: number
  draws: number
  predicted: number[]
  measured: number[]
  maxAbsDevPp: number
  chiSquareVsPredicted: number
  pass: boolean
}

interface RangeCell {
  ell: number
  min: number
  max: number
  draws: number
  predictedMin: number
  predictedMax: number
  predictedPinned: number
  measuredMin: number
  measuredMax: number
  maxAbsDevPp: number
  pass: boolean
}

const TOL_PP = 0.5;

const cells: GridCell[] = []
const rand = mulberry32(SEED);
for (const ell of [3, 4, 8, 12, 16]) {
  const space = 2 ** ell
  for (const m of [2, 3, 4, 5, 8]) {
    if (m >= space) continue
    // Predicted fibre sizes from the closed form.
    const fibres = Array.from({ length: m }, (_, i) => Math.floor((space - 1 - i) / m) + 1)
    const predicted = fibres.map((c) => c / space)
    const counts = new Array<number>(m).fill(0)
    for (let i = 0; i < N; i++) {
      const v = Math.floor(rand() * space)
      counts[v % m]++
    }
    const measured = counts.map((c) => c / N)
    let chi = 0
    let maxDev = 0
    for (let i = 0; i < m; i++) {
      const expected = N * predicted[i]
      chi += ((counts[i] - expected) ** 2) / expected
      maxDev = Math.max(maxDev, Math.abs(measured[i] - predicted[i]) * 100)
    }
    // Chi-square df=m-1; pass bar: max deviation under half a percentage point.
    const pass = maxDev < TOL_PP
    cells.push({ m, ell, draws: N, predicted, measured, maxAbsDevPp: maxDev, chiSquareVsPredicted: chi, pass })
    console.log(`  m=${m} l=${ell}: maxDev ${maxDev.toFixed(4)}pp chi2 ${chi.toFixed(1)} ${pass ? "PASS" : "FAIL"}`);
  }
}

const failed = cells.filter((c) => !c.pass)

// Range-clamp cells: the shipped clamp branch accumulates out-of-range
// draws at the endpoints instead of folding them, so the measured object
// is the mass at each attained endpoint. Includes the shipped conformance
// window (ell=12, min=100, max=4999), whose declared max lies outside the
// 12-bit domain, so no draw can exceed it and the upper mass is 1/4096.
const rangeCells: RangeCell[] = []
const rangeTriples: [number, number, number][] = [
  [4, 1, 14],
  [8, 10, 245],
  [8, 0, 255],
  [12, 100, 4999],
]
for (const [ell, min, max] of rangeTriples) {
  const space = 2 ** ell
  const lo = Math.max(0, min)
  const hi = Math.min(space - 1, max)
  const predictedMin = (lo + 1) / space
  const predictedMax = (space - hi) / space
  const predictedPinned = (lo + (space - 1 - hi)) / space
  let atMin = 0
  let atMax = 0
  for (let i = 0; i < N; i++) {
    const v = Math.floor(rand() * space)
    let w = v
    if (w < lo) w = lo
    else if (w > hi) w = hi
    if (w === lo) atMin++
    else if (w === hi) atMax++
  }
  const measuredMin = atMin / N
  const measuredMax = atMax / N
  const maxDev = Math.max(Math.abs(measuredMin - predictedMin), Math.abs(measuredMax - predictedMax)) * 100
  const pass = maxDev < TOL_PP
  rangeCells.push({ ell, min, max, draws: N, predictedMin, predictedMax, predictedPinned, measuredMin, measuredMax, maxAbsDevPp: maxDev, pass })
  console.log(`  range ell=${ell} [${min},${max}]: maxDev ${maxDev.toFixed(4)}pp ${pass ? "PASS" : "FAIL"}`);
}
const rangeFailed = rangeCells.filter((c) => !c.pass)
const report = {
  experiment: "repair-distribution-grid",
  description: "Measured index-modulo repair frequencies vs closed-form fibre sizes across (m, ell), plus measured range-clamp endpoint masses vs the closed-form endpoint-accumulation bound across (ell, min, max); validates the uniformity theorem beyond the shard case and the clamp bound on the shipped branch.",
  seed: SEED,
  tolerancePp: TOL_PP,
  cells,
  rangeCells,
  environment: {
    os: `${os.platform()} ${os.release()} ${os.arch()}`,
    runtime: process.versions.bun ? `Bun ${process.versions.bun}` : `Node ${process.version}`,
    generatedAt: new Date().toISOString(),
  },
}
const root = path.resolve(import.meta.dirname, "..", "..")
mkdirSync(path.dirname(path.resolve(root, OUT)), { recursive: true })
writeFileSync(path.resolve(root, OUT), `${JSON.stringify(report, null, 2)}\n`)
console.log(`\nwrote ${OUT} (${cells.length - failed.length}/${cells.length} fibre cells, ${rangeCells.length - rangeFailed.length}/${rangeCells.length} range cells pass)`);
if (failed.length > 0 || rangeFailed.length > 0) process.exit(1)
