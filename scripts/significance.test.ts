// Significance testing: Welch t-test + Cohen's d for benchmark comparisons.
//
// These verify scripts/significance.ts. They confirm that two generators'
// repeated-trial samples can be compared for statistical distinguishability
// instead of eyeballing single-run point estimates.

import assert from "node:assert/strict"
import { test } from "node:test"
import { welchTTest, cohensD, compareBench } from "./significance.ts"
import type { BenchStats } from "../dist/bench-core.js"

function stats(samples: number[]): BenchStats {
  const mean = samples.reduce((a, b) => a + b, 0) / samples.length
  const v =
    samples.length > 1
      ? samples.reduce((a, x) => a + (x - mean) ** 2, 0) / (samples.length - 1)
      : 0
  const std = Math.sqrt(v)
  return {
    n: 1000,
    trials: samples.length,
    mean,
    std,
    cv: mean > 0 ? std / mean : 0,
    min: Math.min(...samples),
    max: Math.max(...samples),
    ci95: [mean - std, mean + std],
    samples,
  }
}

test("welchTTest: identical means give t=0, p=1", () => {
  const r = welchTTest([10, 10, 10, 10, 10, 10], [10, 10, 10, 10, 10, 10])
  assert.ok(Math.abs(r.t) < 1e-9)
  assert.ok(Math.abs(r.p - 1) < 1e-6)
})

test("welchTTest: clearly separated samples give a small p-value", () => {
  const r = welchTTest([1, 2, 3, 2, 1, 2], [100, 101, 102, 101, 100, 101])
  assert.ok(r.p < 0.01)
  assert.ok(r.df >= 1)
  assert.ok(r.p >= 0 && r.p <= 1)
})

test("welchTTest: overlapping samples give a non-significant p-value", () => {
  const r = welchTTest([10, 11, 9, 10, 12, 8], [10, 9, 11, 10, 8, 12])
  assert.ok(r.p > 0.05)
})

test("cohensD: sign follows the mean difference and magnitude is large when separated", () => {
  const d = cohensD([1, 2, 3], [10, 11, 12])
  assert.ok(d < 0)
  assert.ok(Math.abs(d) > 1)
  assert.ok(Number.isFinite(d))
})

test("compareBench aggregates two BenchStats into a significance result", () => {
  const r = compareBench(stats([10, 11, 9, 10, 12, 8]), stats([10, 9, 11, 10, 8, 12]))
  assert.ok(r.p >= 0 && r.p <= 1)
  assert.ok(Number.isFinite(r.t))
  assert.ok(Number.isFinite(r.d))
  assert.ok(r.df >= 1)
})
