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
    if (!stopped && entry.p > threshold) stopped = true
    return { ...entry, adjusted: running, threshold, reject: !stopped }
  })
  return {
    method: "holm-bonferroni",
    alpha,
    entries: adjusted,
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
    k: cell.k,
    allowedSize: cell.allowedSize,
    density: cell.density,
    basis,
    genoRepairsPerId: cell.genoRepairsPerId,
    genoNsPerId: cell.genoNsPerId,
    measuredTrialsPerId: basis === "measured" ? cell.rejectionTrialsPerId : null,
    measuredNsPerId: basis === "measured" ? cell.rejectionNsPerId : null,
    analyticalExpectedTrialsPerId: basis === "analytical" ? cell.rejectionTrialsPerId : null,
    extrapolatedNsPerId: basis === "analytical" ? cell.genoNsPerId * cell.rejectionTrialsPerId : null,
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
  runner: string
  tool: string | null
  pinnedLimitations: readonly string[]
}): ExternalSuiteResult {
  if (existsSync(input.archivedArtifact)) {
    return {
      status: "external",
      source: input.archivedArtifact,
      pValues: [],
      limitations: [...input.pinnedLimitations],
    }
  }
  if (input.tool === null) {
    return {
      status: "unavailable",
      source: input.runner,
      pValues: [],
      limitations: [
        ...input.pinnedLimitations,
        `${input.tool} is not installed; install it and rerun to convert this to measured`,
      ],
    }
  }
  return {
    status: "unavailable",
    source: input.runner,
    pValues: [],
    limitations: [
      ...input.pinnedLimitations,
      `no archived output at ${input.archivedArtifact}; run ${input.runner} to produce it`,
    ],
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
    suite: input.suite,
    status: input.status,
    generationPlan: input.generationPlan,
    sampleBits: input.sampleBits,
    seed: input.seed ?? null,
    seedReason: input.seedReason ?? null,
    source: input.source ?? null,
    pValues: input.pValues,
    multipleTesting:
      input.pValues.length > 0 ? holmBonferroni(input.pValues, input.alpha ?? 0.05) : null,
    limitations,
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
  const mask = new Array<number>(16).fill(0)
  for (const field of fields) {
    if (field.type !== "random") continue
    for (let offset = 0; offset < field.length; offset++) {
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
  uniformity: {
    ids: 50_000,
    seedPolicy: "web-crypto CSPRNG, unseeded; the pinned sample size is the recorded definition",
  },
  in_house: {
    ids: 200_000,
    seedPolicy: "web-crypto CSPRNG, unseeded; the battery sample size is recorded per run",
  },
}
