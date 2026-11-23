import assert from "node:assert/strict"
import { test } from "node:test"
import path from "node:path"
import {
  SAMPLE_DEFINITIONS,
  buildSuiteEvidence,
  classifyRejectionCell,
  classifyExternalSuite,
  freeMaskForLayout,
  holmBonferroni,
} from "./stats-evidence-core.ts"

const root = path.resolve(import.meta.dirname, "..", "..")

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
    allowedSize: 128,
    density: 0.5,
    genoNsPerId: 120,
    genoRepairsPerId: 1,
    k: 1,
    rejectionNsPerId: 260,
    rejectionTrialsMeasured: true,
    rejectionTrialsPerId: 2.1,
    speedupVsGeno: 2.1,
  })

  assert.equal(measured.basis, "measured")
  assert.equal(measured.measuredTrialsPerId, 2.1)
  assert.equal(measured.measuredNsPerId, 260)
  assert.equal(measured.analyticalExpectedTrialsPerId, null)
  assert.equal(measured.extrapolatedNsPerId, null)

  const analytical = classifyRejectionCell({
    allowedSize: 4,
    density: 0.00390625,
    genoNsPerId: 700,
    genoRepairsPerId: 6,
    k: 6,
    rejectionNsPerId: null,
    rejectionTrialsMeasured: false,
    rejectionTrialsPerId: 2.815e14,
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
        allowedSize: 2,
        density: 0.015625,
        genoNsPerId: 700,
        genoRepairsPerId: 6,
        k: 6,
        rejectionNsPerId: 1234,
        rejectionTrialsMeasured: false,
        rejectionTrialsPerId: 4.096e6,
        speedupVsGeno: 100,
      }),
    /analytical cell cannot report measured runtime/,
  )
})

test("buildSuiteEvidence requires p-values for measured suites", () => {
  assert.throws(
    () =>
      buildSuiteEvidence({
        generationPlan: "compiled-direct-v8",
        pValues: [],
        sampleBits: 0,
        status: "measured",
        suite: "in-house",
      }),
    /measured suite requires sample bits and p-values/,
  )
})

test("buildSuiteEvidence records unavailable suites as limited results", () => {
  const suite = buildSuiteEvidence({
    generationPlan: null,
    limitations: ["practrand is not installed on this machine"],
    pValues: [],
    sampleBits: null,
    status: "unavailable",
    suite: "practrand",
  })

  assert.equal(suite.status, "unavailable")
  assert.equal(suite.generationPlan, null)
  assert.equal(suite.limitations.length, 1)
})

test("buildSuiteEvidence requires a limitation for an unavailable suite", () => {
  assert.throws(
    () =>
      buildSuiteEvidence({
        generationPlan: null,
        pValues: [],
        sampleBits: null,
        status: "unavailable",
        suite: "testu01",
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
    { length: 8, start: 0, type: "random" },
    { length: 8, start: 8, type: "counter" },
    { length: 4, start: 16, type: "random" },
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
    archivedArtifact: "results/statistics/practrand.txt",
    pinnedLimitations: ["modern suite"],
    runner: "src/scripts/run-practrand.ts",
    suite: "practrand",
    tool: "practrand",
  })

  assert.equal(result.status, "unavailable")
  assert.equal(result.source, "src/scripts/run-practrand.ts")
  assert.ok(result.limitations.some((entry) => entry.includes("results/statistics/practrand.txt")))
})

test("classifyExternalSuite names the missing tool instead of printing null", () => {
  const result = classifyExternalSuite({
    archivedArtifact: "results/statistics/practrand.txt",
    pinnedLimitations: [],
    runner: "src/scripts/run-practrand.ts",
    suite: "practrand",
    tool: null,
    toolName: "practrand",
  })

  assert.equal(result.status, "unavailable")
  assert.ok(
    result.limitations.some((entry) => entry.includes("practrand is not installed")),
    `expected the tool to be named, got ${JSON.stringify(result.limitations)}`,
  )
  assert.ok(
    !result.limitations.some((entry) => entry.includes("null")),
    `no limitation may render a null tool name, got ${JSON.stringify(result.limitations)}`,
  )
})

test("classifyExternalSuite reports a repo-relative source, not a machine-specific path", () => {
  const result = classifyExternalSuite({
    archivedArtifact: path.join(root, "results", "dieharder-results.md"),
    pinnedLimitations: [],
    runner: "src/scripts/run-dieharder.ts",
    sourceLabel: "results/dieharder-results.md",
    suite: "dieharder",
    tool: "dieharder",
  })

  assert.equal(result.status, "external")
  assert.equal(result.source, "results/dieharder-results.md")
})
