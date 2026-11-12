// Repair-distribution grid (future.md item 5): validate the fibre theorem
// empirically beyond the shard case. For each (m, l) pair, draw N uniform
// l-bit values, apply index-modulo repair, and compare measured per-value
// frequencies against the closed-form fibre sizes C_i = floor((2^l-1-i)/m)+1.
// Asserts every cell matches prediction within tolerance.
//
// Usage: bun run scripts/bench-repair-grid.ts
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
const report = {
  experiment: "repair-distribution-grid",
  description: "Measured index-modulo repair frequencies vs closed-form fibre sizes across (m, ell); validates the uniformity theorem beyond the shard case.",
  seed: SEED,
  tolerancePp: TOL_PP,
  cells,
  environment: {
    os: `${os.platform()} ${os.release()} ${os.arch()}`,
    runtime: process.versions.bun ? `Bun ${process.versions.bun}` : `Node ${process.version}`,
    generatedAt: new Date().toISOString(),
  },
}
const root = path.resolve(import.meta.dirname, "..")
mkdirSync(path.dirname(path.resolve(root, OUT)), { recursive: true })
writeFileSync(path.resolve(root, OUT), `${JSON.stringify(report, null, 2)}\n`)
console.log(`\nwrote ${OUT} (${cells.length - failed.length}/${cells.length} cells pass)`);
if (failed.length > 0) process.exit(1)
