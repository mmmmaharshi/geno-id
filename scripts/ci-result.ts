export interface EnvInfo {
  runtime: string
  bun: string | null
  node: string
  platform: string
  arch: string
  cpuModel: string
  cpuCount: number
  totalMemoryMB: number
}

export interface BenchEntry {
  name: string
  opsPerSec: number
  usPerOp: number
  /** 95% confidence interval of opsPerSec across repeated trials. */
  ci95: [number, number]
  /** Sample standard deviation of opsPerSec across repeated trials. */
  std: number
  /** Coefficient of variation (std / mean). */
  cv: number
  /** Number of repeated trials. */
  trials: number
  /** Raw per-trial ops/sec values. */
  samples: number[]
  /** Two-tailed Welch t-test p-value vs the baseline generator (CIBenchmarkResult.baselineName). */
  welchP?: number
  /** Cohen's d effect size vs the baseline generator (positive = faster than baseline). */
  cohensD?: number
}

export interface ComparisonEntry {
  name: string
  a: string
  b: string
  /** Ratio mean_a / mean_b. >1 means a is faster. */
  ratio: number
  welchP: number
  cohensD: number
  /** Name of the faster generator. */
  faster: string
}

export interface CollisionEntry {
  name: string
  n: number
  collisions: number
}

export interface CIBenchmarkResult {
  environment: EnvInfo
  /** Generator each benchmark's Welch p / Cohen's d is computed against. */
  baselineName?: string
  benchmarks: BenchEntry[]
  collisions: CollisionEntry[]
  /** Pairwise comparisons for the specific pairs the paper asserts. */
  comparisons?: ComparisonEntry[]
}
