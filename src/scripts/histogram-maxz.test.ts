import assert from "node:assert/strict"
import test from "node:test"
import { readFileSync } from "node:fs"
import path from "node:path"
import { maxzAnalysis, analyzeHistogram } from "./histogram-maxz.ts"

// Reads the archived histogram from disk: the test fails if the artifact
// drifts, instead of passing against a hardcoded copy of it.
const root = path.resolve(import.meta.dirname, "..", "..")
const committed = JSON.parse(
  readFileSync(path.join(root, "results", "shard-histogram-100m.maxz.json"), "utf-8"),
)

test("maxzAnalysis: archived 10^8 cells are not significant after Bonferroni correction", () => {
  const r = analyzeHistogram()
  assert.equal(r.cells, 17)
  assert.equal(r.cells, committed.cells)
  assert.ok(Math.abs(r.maxAbsZ - committed.maxAbsZ) < 1e-9)
  // Bonferroni critical value for m=17 at family-wise 0.05 is ~2.98.
  assert.ok(r.bonferroniCritical > 2.95 && r.bonferroniCritical < 3)
  assert.equal(r.significantBonferroni, false)
  assert.equal(r.significantSidak, false)
  assert.equal(r.verdict, "consistent with sampling noise")
})

test("maxzAnalysis: a genuine 4.5-sigma cell stays significant after correction", () => {
  const zs = Array.from({ length: 16 }, () => 0.5)
  const r = maxzAnalysis([...zs, 4.5])
  assert.equal(r.significantBonferroni, true)
  assert.equal(r.significantSidak, true)
})

test("maxzAnalysis: Sidak is no more conservative than Bonferroni; m=1 is unadjusted", () => {
  const r = analyzeHistogram()
  assert.ok(r.sidakCritical <= r.bonferroniCritical)
  const single = maxzAnalysis([1])
  assert.ok(Math.abs(single.bonferroniCritical - 1.959964) < 1e-3)
})
