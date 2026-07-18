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
  /** Number of repeated trials. */
  trials: number
}

export interface CollisionEntry {
  name: string
  n: number
  collisions: number
}

export interface CIBenchmarkResult {
  environment: EnvInfo
  benchmarks: BenchEntry[]
  collisions: CollisionEntry[]
}
