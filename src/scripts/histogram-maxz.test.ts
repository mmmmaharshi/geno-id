import assert from "node:assert/strict"
import test from "node:test"
import { maxzAnalysis } from "./histogram-maxz.ts"

// Archived per-cell z-scores from results/shard-histogram-100m.json
// (dbkey.shard 5 cells, multitenant.tenant 8 cells, multitenant.region 4 cells).
const ARCHIVED_Z = [
  -2.898, 0.228, 0.453, 1.72, 0.518,
  -0.847, 1.598, -0.379, -1.144, -2.079, 2.492, -0.203, 0.561,
  0.939, 0.229, -0.103, -1.066,
]

test("maxzAnalysis: archived 10^8 cells are not significant after Bonferroni correction", () => {
  const r = maxzAnalysis(ARCHIVED_Z)
  assert.equal(r.cells, 17)
  assert.ok(Math.abs(r.maxAbsZ - 2.898) < 1e-9)
  // Bonferroni critical value for m=17 at family-wise 0.05 is ~2.98.
  assert.ok(r.bonferroniCritical > 2.95 && r.bonferroniCritical < 3)
  assert.equal(r.significantBonferroni, false)
  assert.equal(r.significantSidak, false)
})

test("maxzAnalysis: a genuine 4.5-sigma cell stays significant after correction", () => {
  const r = maxzAnalysis([...ARCHIVED_Z.slice(1), 4.5])
  assert.equal(r.significantBonferroni, true)
  assert.equal(r.significantSidak, true)
})

test("maxzAnalysis: Sidak is no more conservative than Bonferroni; m=1 is unadjusted", () => {
  const r = maxzAnalysis(ARCHIVED_Z)
  assert.ok(r.sidakCritical <= r.bonferroniCritical)
  const single = maxzAnalysis([1])
  assert.ok(Math.abs(single.bonferroniCritical - 1.959964) < 1e-3)
})
