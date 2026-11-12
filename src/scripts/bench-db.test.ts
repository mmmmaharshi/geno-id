// Read-experiment methodology: every read metric (point lookup,
// shard-prune range scan, indexed baseline) must be reported as
// mean ± 95% CI over repeated reps, matching the insert side of
// bench-db.ts and the paper's stated "mean ± SD over trials with
// 95% CI" methodology. Single-shot reads are noise-dominated
// (shardfirst point lookup swung 72.8 -> 47.5 µs across runs).

import assert from "node:assert/strict"
import { test } from "node:test"
import { aggregateReps, shardRangeKeys } from "./bench-db.ts"

test("aggregateReps: exact 95% CI on a known sample (t(df=4)=2.776)", () => {
  // sd = sqrt(10/4) ≈ 1.5811; margin = 2.776 × 1.5811 / sqrt(5) ≈ 1.963.
  const r = aggregateReps([10, 12, 11, 13, 9])
  assert.equal(r.mean, 11)
  assert.ok(Math.abs(r.ci95[0] - 9.037) < 0.01, `lo ${r.ci95[0]} must match t-based margin`)
  assert.ok(Math.abs(r.ci95[1] - 12.963) < 0.01, `hi ${r.ci95[1]} must match t-based margin`)
})

test("aggregateReps: single sample has zero-width CI", () => {
  const r = aggregateReps([42])
  assert.equal(r.mean, 42)
  assert.deepEqual(r.ci95, [42, 42])
})

test("aggregateReps: identical samples collapse to zero-width CI", () => {
  const r = aggregateReps([7, 7, 7, 7])
  assert.equal(r.mean, 7)
  assert.deepEqual(r.ci95, [7, 7])
})

test("shardRangeKeys: half-open [shard, shard+1) 16-byte prefix range", () => {
  const { lo, hi } = shardRangeKeys(3)
  assert.equal(lo.length, 16)
  assert.equal(hi.length, 16)
  assert.equal(lo[0], 3)
  assert.equal(hi[0], 4)
  for (let i = 1; i < 16; i++) {
    assert.equal(lo[i], 0, `lo[${i}] must be 0`)
    assert.equal(hi[i], 0, `hi[${i}] must be 0`)
  }
})

test("shardRangeKeys: adjacent shards produce disjoint, contiguous ranges", () => {
  const a = shardRangeKeys(1)
  const b = shardRangeKeys(2)
  assert.equal(a.hi[0], b.lo[0], "shard ranges must be contiguous")
})
