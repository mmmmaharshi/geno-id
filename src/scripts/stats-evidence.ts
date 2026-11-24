import {
  SAMPLE_DEFINITIONS,
  buildSuiteEvidence,
  classifyExternalSuite,
  classifyRejectionCell,
  freeMaskForLayout,
} from "./stats-evidence-core.ts"

import { STANDARD_FREE_MASK, V7_FREE_MASK, runBattery } from "./stats-core.ts"

import { mkdirSync, readFileSync, writeFileSync } from "node:fs"

import { nullValue, undefinedValue } from "./shared/runtime-values.ts"

import { execFileSync } from "node:child_process"

import path from "node:path"

import { pathToFileURL } from "node:url"

interface PValueEntry {
  name: string

  p: number
}

type RejectionCellInput = Parameters<typeof classifyRejectionCell>[0]

type SuiteEvidence = ReturnType<typeof buildSuiteEvidence>

const root = path.resolve(import.meta.dirname, "..", "..")

const outPath = path.join(root, "results", "statistics-evidence.json")

const CSPRNG_SEED_REASON = "web-crypto CSPRNG, no seed input"

const algo = (await import(
  pathToFileURL(path.join(root, "dist", "algo.js")).href
)) as {
  genStructuredGenoID: (layout: unknown) => string

  getStructuredGenerationMode: () => string

  genV7: () => string

  DBKEY_LAYOUT: {
    name: string
    fields: { start: number; length: number; type: string }[]
  }
}

const {
  genStructuredGenoID,

  getStructuredGenerationMode,

  genV7,

  DBKEY_LAYOUT,
} = algo

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

const v4 = await runBattery(
  "v4",
  () => crypto.randomUUID(),
  false,
  n,
  STANDARD_FREE_MASK,
)

const v7 = await runBattery("v7", () => genV7(), false, n, V7_FREE_MASK)

const batteryPValues = (battery: {
  monobitP: number

  runsP: number | null

  chiResults: { pos: number; p: number }[]
}): PValueEntry[] => {
  const entries: PValueEntry[] = [{ name: "monobit", p: battery.monobitP }]

  if (battery.runsP !== nullValue) {
    entries.push({ name: "runs", p: battery.runsP })
  }

  for (const chi of battery.chiResults) {
    entries.push({ name: `chi-square-byte-${chi.pos}`, p: chi.p })
  }

  return entries
}

const toolOnPath = (tool: string): boolean => {
  let command = "which"

  if (process.platform === "win32") {
    command = "where"
  }

  try {
    execFileSync(command, [tool], { stdio: "ignore" })

    return true
  } catch {
    return false
  }
}

const toolStatus = (tool: string): string | null => {
  if (toolOnPath(tool)) {
    return tool
  }

  return nullValue
}

const externalSuites = [
  {
    archivedArtifact: "results/nist-sp800-22-results.json",

    pinnedLimitations: [
      "SP 800-22 is withdrawn and is not sufficient evidence of cryptographic security",
    ],

    runner: "src/scripts/nist-bridge.py",

    suite: "nist-sp800-22" as const,

    tool: nullValue,

    toolName: "python3",
  },

  {
    archivedArtifact: "results/dieharder-results.md",

    pinnedLimitations: ["curated subset, not the full dieharder battery"],

    runner: "src/scripts/run-dieharder.ts",

    suite: "dieharder" as const,

    tool: toolStatus("dieharder"),

    toolName: "dieharder",
  },

  {
    archivedArtifact: "results/statistics/practrand.txt",

    pinnedLimitations: [
      "modern suite, included as required by the evidence policy",
    ],

    runner: "src/scripts/run-practrand.ts",

    suite: "practrand" as const,

    tool: toolStatus("practrand"),

    toolName: "practrand",
  },

  {
    archivedArtifact: "results/statistics/testu01.txt",

    pinnedLimitations: [
      "modern suite, included as required by the evidence policy",
    ],

    runner: "src/scripts/run-testu01.sh",

    suite: "testu01" as const,

    tool: toolStatus("TestU01"),

    toolName: "TestU01",
  },
].map((entry) => {
  const resolved = classifyExternalSuite({
    archivedArtifact: path.join(root, entry.archivedArtifact),

    pinnedLimitations: entry.pinnedLimitations,

    runner: entry.runner,

    sourceLabel: entry.archivedArtifact,

    suite: entry.suite,

    tool: entry.tool,

    toolName: entry.toolName,
  })

  return buildSuiteEvidence({
    generationPlan: mode,

    limitations: resolved.limitations,

    pValues: resolved.pValues,

    sampleBits: nullValue,

    seed: nullValue,

    seedReason: CSPRNG_SEED_REASON,

    source: resolved.source ?? undefinedValue,

    status: resolved.status,

    suite: entry.suite,
  })
})

const suites: SuiteEvidence[] = [
  buildSuiteEvidence({
    generationPlan: mode,

    limitations: [
      "monobit, runs, per-position chi-square, and correlation only",

      "does not test computational unpredictability",
    ],

    pValues: batteryPValues(structured),

    sampleBits: structured.nBits,

    seed: nullValue,

    seedReason: CSPRNG_SEED_REASON,

    status: "measured",

    suite: "in-house",
  }),

  ...externalSuites,
]

const sweepPath = path.join(root, "results", "rejection-sweep.json")

const sweep = JSON.parse(readFileSync(sweepPath, "utf8")) as {
  fieldSpace: number

  idsPerCell: number

  cells: RejectionCellInput[]
}

if (!Array.isArray(sweep.cells) || sweep.cells.length === 0) {
  throw new Error(
    "rejection sweep contains no cells; run bun run bench-rejection first",
  )
}

const rejectionCells = sweep.cells.map((cell) => classifyRejectionCell(cell))

const commit = execFileSync("git", ["rev-parse", "HEAD"], {
  cwd: root,
  encoding: "utf8",
}).trim()

const workingTree = execFileSync("git", ["status", "--porcelain"], {
  cwd: root,
  encoding: "utf8",
})

  .split("\n")

  .filter((line) => line.length > 0)

const bunVersion = process.versions.bun

let runtime = "node"

if (typeof bunVersion === "string") {
  runtime = "bun"
}

let runtimeVersion = process.versions.node

if (typeof bunVersion === "string") {
  runtimeVersion = bunVersion
}

const evidence = {
  command: "bun run stats:evidence",

  comparisons: {
    v4: { monobitP: v4.monobitP, nBits: v4.nBits, runsP: v4.runsP },

    v7: { monobitP: v7.monobitP, nBits: v7.nBits, runsP: v7.runsP },
  },

  environment: {
    arch: process.arch,

    platform: process.platform,

    runtime,

    runtimeVersion,
  },

  generationPlan: mode,

  implementationCommit: commit,

  rejection: {
    analyticalCells: rejectionCells.filter(
      (cell) => cell.basis === "analytical",
    ).length,

    cells: rejectionCells,

    fieldSpace: sweep.fieldSpace,

    idsPerCell: sweep.idsPerCell,

    measuredCells: rejectionCells.filter((cell) => cell.basis === "measured")
      .length,
  },

  sampleDefinitions: SAMPLE_DEFINITIONS,

  suites,

  workingTreeDirty: workingTree.length > 0,
}

mkdirSync(path.dirname(outPath), { recursive: true })

writeFileSync(outPath, `${JSON.stringify(evidence, nullValue, 2)}\n`)

const rejectedCount = (suite: SuiteEvidence): number => {
  if (!suite.multipleTesting) {
    return 0
  }

  return suite.multipleTesting.rejected.length
}

const failedSuites = suites.filter((suite) => rejectedCount(suite) > 0)

const missingSuites = suites.filter((suite) => suite.status === "unavailable")

for (const suite of suites) {
  const rejected = rejectedCount(suite)

  let suffix = ""

  if (rejected > 0) {
    suffix = ` (${rejected} rejected)`
  }

  console.log(`${suite.suite}: ${suite.status}${suffix}`)
}

console.log(
  `rejection cells: ${evidence.rejection.measuredCells} measured, ${evidence.rejection.analyticalCells} analytical`,
)

console.log(
  `limited suites: ${missingSuites.map((suite) => suite.suite).join(", ") || "none"}`,
)

if (failedSuites.length > 0) {
  for (const suite of failedSuites) {
    if (suite.multipleTesting) {
      console.error(
        `${suite.suite} rejected: ${suite.multipleTesting.rejected.join(", ")}`,
      )
    }
  }

  console.error("STATISTICS EVIDENCE FAILED")

  process.exitCode = 1
} else {
  console.log("STATISTICS EVIDENCE PASSED")
}
