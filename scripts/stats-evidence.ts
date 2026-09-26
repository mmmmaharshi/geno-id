import { execFileSync } from "node:child_process"
import { mkdirSync, readFileSync, writeFileSync } from "node:fs"
import path from "node:path"
import { pathToFileURL } from "node:url"
import {
  SAMPLE_DEFINITIONS,
  buildSuiteEvidence,
  classifyExternalSuite,
  classifyRejectionCell,
  freeMaskForLayout,
} from "./stats-evidence-core.ts"
import type { PValueEntry, RejectionCellInput, SuiteEvidence } from "./stats-evidence-core.ts"
import { runBattery, STANDARD_FREE_MASK, V7_FREE_MASK } from "./stats-core.ts"

const root = path.resolve(import.meta.dirname, "..")
const outPath = path.join(root, "results", "statistics-evidence.json")
const CSPRNG_SEED_REASON = "web-crypto CSPRNG, no seed input"

const algo = await import(pathToFileURL(path.join(root, "dist", "algo.js")).href)
const {
  genStructuredGenoID,
  getStructuredGenerationMode,
  genV7,
  DBKEY_LAYOUT,
} = algo as {
  genStructuredGenoID: (layout: unknown) => string
  getStructuredGenerationMode: () => string
  genV7: () => string
  DBKEY_LAYOUT: { name: string; fields: { start: number; length: number; type: string }[] }
}

const mode = getStructuredGenerationMode()
const n = SAMPLE_DEFINITIONS.in_house.ids
const structuredMask = freeMaskForLayout(DBKEY_LAYOUT.fields)

const structured = await runBattery(
  "structured-production",
  () => genStructuredGenoID(DBKEY_LAYOUT),
  false,
  n,
  structuredMask,
)
const v4 = await runBattery("v4", () => crypto.randomUUID(), false, n, STANDARD_FREE_MASK)
const v7 = await runBattery("v7", () => genV7(), false, n, V7_FREE_MASK)

function batteryPValues(battery: {
  monobitP: number
  runsP: number | null
  chiResults: { pos: number; p: number }[]
}): PValueEntry[] {
  const entries: PValueEntry[] = [{ name: "monobit", p: battery.monobitP }]
  if (battery.runsP !== null) entries.push({ name: "runs", p: battery.runsP })
  for (const chi of battery.chiResults) {
    entries.push({ name: `chi-square-byte-${chi.pos}`, p: chi.p })
  }
  return entries
}

const toolOnPath = (tool: string): boolean => {
  try {
    execFileSync(process.platform === "win32" ? "where" : "which", [tool], { stdio: "ignore" })
    return true
  } catch {
    return false
  }
}

const externalSuites = [
  {
    suite: "nist-sp800-22" as const,
    archivedArtifact: "results/statistics/nist-sp800-22.json",
    runner: "scripts/nist-bridge.py",
    tool: null,
    pinnedLimitations: [
      "SP 800-22 is withdrawn and is not sufficient evidence of cryptographic security",
    ],
  },
  {
    suite: "dieharder" as const,
    archivedArtifact: "results/dieharder-results.md",
    runner: "scripts/run-dieharder.ts",
    tool: toolOnPath("dieharder") ? "dieharder" : null,
    pinnedLimitations: ["curated subset, not the full dieharder battery"],
  },
  {
    suite: "practrand" as const,
    archivedArtifact: "results/statistics/practrand.txt",
    runner: "scripts/run-practrand.ts",
    tool: toolOnPath("practrand") ? "practrand" : null,
    pinnedLimitations: ["modern suite, included as required by the evidence policy"],
  },
  {
    suite: "testu01" as const,
    archivedArtifact: "results/statistics/testu01.txt",
    runner: "scripts/run-testu01.sh",
    tool: toolOnPath("TestU01") ? "TestU01" : null,
    pinnedLimitations: ["modern suite, included as required by the evidence policy"],
  },
].map((entry) => {
  const resolved = classifyExternalSuite({
    ...entry,
    archivedArtifact: path.join(root, entry.archivedArtifact),
  })
  return buildSuiteEvidence({
    suite: entry.suite,
    status: resolved.status,
    generationPlan: mode,
    sampleBits: null,
    seed: null,
    seedReason: CSPRNG_SEED_REASON,
    source: resolved.source ?? undefined,
    pValues: resolved.pValues,
    limitations: resolved.limitations,
  })
})

const suites: SuiteEvidence[] = [
  buildSuiteEvidence({
    suite: "in-house",
    status: "measured",
    generationPlan: mode,
    sampleBits: structured.nBits,
    seed: null,
    seedReason: CSPRNG_SEED_REASON,
    pValues: batteryPValues(structured),
    limitations: [
      "monobit, runs, per-position chi-square, and correlation only",
      "does not test computational unpredictability",
    ],
  }),
  ...externalSuites,
]

const sweepPath = path.join(root, "results", "rejection-sweep.json")
const sweep = JSON.parse(readFileSync(sweepPath, "utf-8")) as {
  fieldSpace: number
  idsPerCell: number
  cells: RejectionCellInput[]
}
if (!Array.isArray(sweep.cells) || sweep.cells.length === 0) {
  throw new Error("rejection sweep contains no cells; run bun run bench-rejection first")
}
const rejectionCells = sweep.cells.map((cell) => classifyRejectionCell(cell))

const commit = execFileSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf-8" }).trim()
const workingTree = execFileSync("git", ["status", "--porcelain"], { cwd: root, encoding: "utf-8" })
  .split("\n")
  .filter((line) => line.length > 0)

const evidence = {
  command: "bun run stats:evidence",
  implementationCommit: commit,
  workingTreeDirty: workingTree.length > 0,
  generationPlan: mode,
  environment: {
    runtime: process.versions.bun === undefined ? "node" : "bun",
    runtimeVersion: process.versions.bun ?? process.versions.node,
    platform: process.platform,
    arch: process.arch,
  },
  sampleDefinitions: SAMPLE_DEFINITIONS,
  comparisons: {
    v4: { nBits: v4.nBits, monobitP: v4.monobitP, runsP: v4.runsP },
    v7: { nBits: v7.nBits, monobitP: v7.monobitP, runsP: v7.runsP },
  },
  suites,
  rejection: {
    fieldSpace: sweep.fieldSpace,
    idsPerCell: sweep.idsPerCell,
    measuredCells: rejectionCells.filter((cell) => cell.basis === "measured").length,
    analyticalCells: rejectionCells.filter((cell) => cell.basis === "analytical").length,
    cells: rejectionCells,
  },
}

mkdirSync(path.dirname(outPath), { recursive: true })
writeFileSync(outPath, `${JSON.stringify(evidence, null, 2)}\n`)

const failedSuites = suites.filter(
  (suite) => (suite.multipleTesting?.rejected.length ?? 0) > 0,
)
const missingSuites = suites.filter((suite) => suite.status === "unavailable")

for (const suite of suites) {
  const rejected = suite.multipleTesting?.rejected.length ?? 0
  console.log(`${suite.suite}: ${suite.status}${rejected > 0 ? ` (${rejected} rejected)` : ""}`)
}
console.log(`rejection cells: ${evidence.rejection.measuredCells} measured, ${evidence.rejection.analyticalCells} analytical`)
console.log(`limited suites: ${missingSuites.map((suite) => suite.suite).join(", ") || "none"}`)

if (failedSuites.length > 0) {
  for (const suite of failedSuites) {
    console.error(`${suite.suite} rejected: ${suite.multipleTesting?.rejected.join(", ")}`)
  }
  console.error("STATISTICS EVIDENCE FAILED")
  process.exit(1)
}
console.log("STATISTICS EVIDENCE PASSED")
