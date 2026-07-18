// Shared benchmark harness: repeated-trial statistics.
//
// These tests verify the measurement layer in bench-core.ts:
//   benchRepeated / benchRepeatedAsync wrap benchSync with N repeated trials and
//   return mean / std / cv / min / max / 95% CI / raw samples. The significance
//   testing (Welch t-test, Cohen's d) lives in scripts/significance.ts.

import assert from "node:assert/strict"
import { test } from "node:test"
import { benchRepeated, benchRepeatedAsync } from "../dist/bench-core.js"

const ID = () => "12345678-1234-8234-9234-123456789abc"

test("benchRepeated returns repeated-trial statistics", () => {
  const s = benchRepeated(ID, 2000, 6)
  assert.equal(s.trials, 6)
  assert.equal(s.samples.length, 6)
  assert.ok(s.mean > 0)
  assert.ok(s.std >= 0)
  assert.ok(s.cv >= 0)
  assert.ok(s.min <= s.mean && s.mean <= s.max)
  assert.ok(s.ci95[0] <= s.mean && s.mean <= s.ci95[1])
  assert.ok(s.ci95[1] >= s.ci95[0])
})

test("benchRepeatedAsync returns repeated-trial statistics", async () => {
  const s = await benchRepeatedAsync(async () => ID(), 1000, 5)
  assert.equal(s.trials, 5)
  assert.equal(s.samples.length, 5)
  assert.ok(s.mean > 0)
  assert.ok(s.ci95[0] <= s.mean && s.mean <= s.ci95[1])
})
