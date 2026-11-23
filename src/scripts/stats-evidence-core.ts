import { existsSync } from "node:fs"

export type StatisticalSuite = "in-house" | "nist-sp800-22" | "dieharder" | "practrand" | "testu01"

export type SuiteStatus = "measured" | "external" | "unavailable"

export interface PValueEntry {
  name: string
  p: number
}

export interface AdjustedPValue extends PValueEntry {
  adjusted: number
  threshold: number
  reject: boolean
}

export interface MultipleTestingResult {
  method: "holm-bonferroni"
  alpha: number
  entries: AdjustedPValue[]
  rejected: string[]
}

export function holmBonferroni(entries: readonly PValueEntry[], alpha = 0.05): MultipleTestingResult {
  const sorted = entries.toSorted((left, right) => left.p - right.p)
  const total = sorted.length
  let running = 0
  let stopped = false
  const adjusted = sorted.map((entry, index) => {
    running = Math.max(running, Math.min(1, entry.p * (total - index)))
    const threshold = alpha / (total - index)
    if (!stopped && entry.p > threshold) {stopped = true}
    return { ...entry, adjusted: running, reject: !stopped, threshold }
  })
  return {
    alpha,
    entries: adjusted,
    method: "holm-bonferroni",
    rejected: adjusted.filter((entry) => entry.reject).map((entry) => entry.name),
  }
}

export interface RejectionCellInput {
  k: number
  allowedSize: number
  density: number
  genoRepairsPerId: number
  genoNsPerId: number
  rejectionTrialsPerId: number
  rejectionTrialsMeasured: boolean
  rejectionNsPerId: number | null
  speedupVsGeno: number
}

export interface RejectionCellEvidence {
  k: number
  allowedSize: number
  density: number
  basis: "measured" | "analytical"
  genoRepairsPerId: number
  genoNsPerId: number
  measuredTrialsPerId: number | null
  measuredNsPerId: number | null
  analyticalExpectedTrialsPerId: number | null
  extrapolatedNsPerId: number | null
  speedupVsGeno: number
}

export function classifyRejectionCell(cell: RejectionCellInput): RejectionCellEvidence {
  if (!cell.rejectionTrialsMeasured && cell.rejectionNsPerId !== null) {
    throw new Error("analytical cell cannot report measured runtime")
  }
  const basis = cell.rejectionTrialsMeasured ? "measured" : "analytical"
  return {
    allowedSize: cell.allowedSize,
    analyticalExpectedTrialsPerId: basis === "analytical" ? cell.rejectionTrialsPerId : null,
    basis,
    density: cell.density,
    extrapolatedNsPerId: basis === "analytical" ? cell.genoNsPerId * cell.rejectionTrialsPerId : null,
    genoNsPerId: cell.genoNsPerId,
    genoRepairsPerId: cell.genoRepairsPerId,
    k: cell.k,
    measuredNsPerId: basis === "measured" ? cell.rejectionNsPerId : null,
    measuredTrialsPerId: basis === "measured" ? cell.rejectionTrialsPerId : null,
    speedupVsGeno: cell.speedupVsGeno,
  }
}

export interface ExternalSuiteResult {
  status: "measured" | "external" | "unavailable"
  source: string | null
  pValues: PValueEntry[]
  limitations: string[]
}

export function classifyExternalSuite(input: {
  suite: StatisticalSuite
  archivedArtifact: string
  /** Repo-relative label for the archived artifact; the archived path itself is machine-specific. */
  sourceLabel?: string
  runner: string
  tool: string | null
  /** Name of the tool, used when `tool` is null (the tool is not installed). */
  toolName?: string
  pinnedLimitations: readonly string[]
}): ExternalSuiteResult {
  if (existsSync(input.archivedArtifact)) {
    return {
      limitations: [...input.pinnedLimitations],
      pValues: [],
      source: input.sourceLabel ?? input.archivedArtifact,
      status: "external",
    }
  }
  if (input.tool === null) {
    return {
      limitations: [
        ...input.pinnedLimitations,
        `${input.toolName ?? input.suite} is not installed; install it and rerun to convert this to measured`,
      ],
      pValues: [],
      source: input.runner,
      status: "unavailable",
    }
  }
  return {
    limitations: [
      ...input.pinnedLimitations,
      `no archived output at ${input.archivedArtifact}; run ${input.runner} to produce it`,
    ],
    pValues: [],
    source: input.runner,
    status: "unavailable",
  }
}

export interface SuiteEvidenceInput {
  suite: StatisticalSuite
  status: SuiteStatus
  generationPlan: string | null
  sampleBits: number | null
  pValues: PValueEntry[]
  alpha?: number
  seed?: number | null
  seedReason?: string | null
  source?: string
  limitations?: string[]
}

export interface SuiteEvidence {
  suite: StatisticalSuite
  status: SuiteStatus
  generationPlan: string | null
  sampleBits: number | null
  seed: number | null
  seedReason: string | null
  source: string | null
  pValues: PValueEntry[]
  multipleTesting: MultipleTestingResult | null
  limitations: string[]
}

export function buildSuiteEvidence(input: SuiteEvidenceInput): SuiteEvidence {
  const limitations = input.limitations ?? []
  if (input.status === "measured" && (!input.sampleBits || input.pValues.length === 0)) {
    throw new Error("measured suite requires sample bits and p-values")
  }
  if (input.status === "unavailable" && limitations.length === 0) {
    throw new Error("unavailable suite requires a limitation")
  }
  if (input.status === "external" && !input.source) {
    throw new Error("external suite requires an artifact source")
  }
  return {
    generationPlan: input.generationPlan,
    limitations,
    multipleTesting:
      input.pValues.length > 0 ? holmBonferroni(input.pValues, input.alpha ?? 0.05) : null,
    pValues: input.pValues,
    sampleBits: input.sampleBits,
    seed: input.seed ?? null,
    seedReason: input.seedReason ?? null,
    source: input.source ?? null,
    status: input.status,
    suite: input.suite,
  }
}

export interface SampleDefinition {
  ids: number
  seedPolicy: string
}

export interface LayoutBitField {
  start: number
  length: number
  type: string
}

export function freeMaskForLayout(fields: readonly LayoutBitField[]): number[] {
  const mask = Array.from<number>({ length: 16 }).fill(0)
  for (const field of fields) {
    if (field.type !== "random") {continue}
    for (let offset = 0; offset < field.length; offset += 1) {
      const position = field.start + offset
      const byte = position >> 3
      mask[byte] |= 1 << (7 - (position & 7))
    }
  }
  return mask
}

export const SAMPLE_DEFINITIONS: Readonly<Record<"collision" | "uniformity" | "in_house", SampleDefinition>> = {
  collision: {
    ids: 2_000_000,
    seedPolicy: "web-crypto CSPRNG, unseeded; the pinned sample size is the recorded definition",
  },
  in_house: {
    ids: 200_000,
    seedPolicy: "web-crypto CSPRNG, unseeded; the battery sample size is recorded per run",
  },
  uniformity: {
    ids: 50_000,
    seedPolicy: "web-crypto CSPRNG, unseeded; the pinned sample size is the recorded definition",
  },
}
