import assert from "node:assert/strict"
import { test } from "node:test"
import {
  SAMPLE_DEFINITIONS,
  buildSuiteEvidence,
  classifyRejectionCell,
  classifyExternalSuite,
  freeMaskForLayout,
  holmBonferroni,
} from "./stats-evidence-core.ts"

test("holmBonferroni adjusts p-values and reports rejections", () => {
  const result = holmBonferroni(
    [
      { name: "monobit", p: 0.001 },
      { name: "runs", p: 0.04 },
      { name: "chi-square", p: 0.9 },
    ],
    0.05,
  )

  assert.equal(result.method, "holm-bonferroni")
  assert.equal(result.alpha, 0.05)
  assert.equal(result.entries.length, 3)
  const monobit = result.entries.find((entry) => entry.name === "monobit")
  assert.ok(monobit)
  assert.equal(monobit.adjusted, 0.003)
  assert.equal(monobit.reject, true)
  const runs = result.entries.find((entry) => entry.name === "runs")
  assert.ok(runs)
  assert.equal(runs.adjusted, 0.08)
  assert.equal(runs.reject, false)
  assert.deepEqual(result.rejected, ["monobit"])
})

test("classifyRejectionCell keeps measured and analytical values separate", () => {
  const measured = classifyRejectionCell({
    k: 1,
    allowedSize: 128,
    density: 0.5,
    genoRepairsPerId: 1,
    genoNsPerId: 120,
    rejectionTrialsPerId: 2.1,
    rejectionTrialsMeasured: true,
    rejectionNsPerId: 260,
    speedupVsGeno: 2.1,
  })

  assert.equal(measured.basis, "measured")
  assert.equal(measured.measuredTrialsPerId, 2.1)
  assert.equal(measured.measuredNsPerId, 260)
  assert.equal(measured.analyticalExpectedTrialsPerId, null)
  assert.equal(measured.extrapolatedNsPerId, null)

  const analytical = classifyRejectionCell({
    k: 6,
    allowedSize: 4,
    density: 0.00390625,
    genoRepairsPerId: 6,
    genoNsPerId: 700,
    rejectionTrialsPerId: 2.815e14,
    rejectionTrialsMeasured: false,
    rejectionNsPerId: null,
    speedupVsGeno: 4.7e13,
  })

  assert.equal(analytical.basis, "analytical")
  assert.equal(analytical.measuredTrialsPerId, null)
  assert.equal(analytical.measuredNsPerId, null)
  assert.equal(analytical.analyticalExpectedTrialsPerId, 2.815e14)
  assert.equal(analytical.extrapolatedNsPerId, 700 * 2.815e14)
  assert.equal(analytical.genoRepairsPerId, 6)
  assert.equal(analytical.genoNsPerId, 700)
  assert.equal(analytical.speedupVsGeno, 4.7e13)
})

test("classifyRejectionCell rejects an analytical cell that reports wall-clock time", () => {
  assert.throws(
    () =>
      classifyRejectionCell({
        k: 6,
        allowedSize: 2,
        density: 0.015625,
        genoRepairsPerId: 6,
        genoNsPerId: 700,
        rejectionTrialsPerId: 4.096e6,
        rejectionTrialsMeasured: false,
        rejectionNsPerId: 1234,
        speedupVsGeno: 100,
      }),
    /analytical cell cannot report measured runtime/,
  )
})

test("buildSuiteEvidence requires p-values for measured suites", () => {
  assert.throws(
    () =>
      buildSuiteEvidence({
        suite: "in-house",
        status: "measured",
        generationPlan: "compiled-direct-v8",
        sampleBits: 0,
        pValues: [],
      }),
    /measured suite requires sample bits and p-values/,
  )
})

test("buildSuiteEvidence records unavailable suites as limited results", () => {
  const suite = buildSuiteEvidence({
    suite: "practrand",
    status: "unavailable",
    generationPlan: null,
    sampleBits: null,
    pValues: [],
    limitations: ["practrand is not installed on this machine"],
  })

  assert.equal(suite.status, "unavailable")
  assert.equal(suite.generationPlan, null)
  assert.equal(suite.limitations.length, 1)
})

test("buildSuiteEvidence requires a limitation for an unavailable suite", () => {
  assert.throws(
    () =>
      buildSuiteEvidence({
        suite: "testu01",
        status: "unavailable",
        generationPlan: null,
        sampleBits: null,
        pValues: [],
      }),
    /unavailable suite requires a limitation/,
  )
})

test("holmBonferroni stops at the first failure and rejects no later hypothesis", () => {
  const result = holmBonferroni(
    [
      { name: "first", p: 0.001 },
      { name: "fails-here", p: 0.02 },
      { name: "later", p: 0.021 },
      { name: "largest", p: 0.9 },
    ],
    0.05,
  )

  assert.deepEqual(result.rejected, ["first"])
  const failsHere = result.entries.find((entry) => entry.name === "fails-here")
  assert.ok(failsHere)
  assert.equal(failsHere.reject, false)
  const later = result.entries.find((entry) => entry.name === "later")
  assert.ok(later)
  assert.equal(later.reject, false)
})

test("freeMaskForLayout marks only random payload bits as free", () => {
  const mask = freeMaskForLayout([
    { start: 0, length: 8, type: "random" },
    { start: 8, length: 8, type: "counter" },
    { start: 16, length: 4, type: "random" },
  ])

  assert.equal(mask[0], 0xff)
  assert.equal(mask[1], 0x00)
  assert.equal(mask[2], 0xf0)
  assert.equal(mask[3], 0x00)
})

test("SAMPLE_DEFINITIONS pins collision, uniformity, and battery sample sizes", () => {
  assert.equal(SAMPLE_DEFINITIONS.collision.ids, 2_000_000)
  assert.equal(SAMPLE_DEFINITIONS.uniformity.ids, 50_000)
  assert.ok(SAMPLE_DEFINITIONS.in_house.ids > 0)
  for (const definition of Object.values(SAMPLE_DEFINITIONS)) {
    assert.ok(Number.isInteger(definition.ids) && definition.ids > 0)
    assert.ok(definition.seedPolicy.length > 0)
  }
})

test("classifyExternalSuite reports a missing archive as unavailable, not external", () => {
  const result = classifyExternalSuite({
    suite: "practrand",
    archivedArtifact: "results/statistics/practrand.txt",
    runner: "scripts/run-practrand.ts",
    tool: "practrand",
    pinnedLimitations: ["modern suite"],
  })

  assert.equal(result.status, "unavailable")
  assert.equal(result.source, "scripts/run-practrand.ts")
  assert.ok(result.limitations.some((entry) => entry.includes("results/statistics/practrand.txt")))
})
