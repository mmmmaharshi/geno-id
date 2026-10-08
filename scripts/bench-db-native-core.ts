export const DISTRIBUTIONS = ["uniform", "hot-tenant", "bursty"] as const
export type Distribution = (typeof DISTRIBUTIONS)[number]

export const WORKLOADS = [
  "insert",
  "pointLookup",
  "rangeScan",
  "update",
  "delete",
  "maintenance",
  "concurrentWriters",
] as const
export type Workload = (typeof WORKLOADS)[number]

export const ENGINES = ["postgresql", "mysql-innodb"] as const
export type EngineName = (typeof ENGINES)[number]

export interface Percentiles {
  p50: number
  p95: number
  p99: number
  max: number
  samples: number
}

export function percentiles(values: readonly number[]): Percentiles {
  if (values.length === 0) return { p50: 0, p95: 0, p99: 0, max: 0, samples: 0 }
  const sorted = values.toSorted((left, right) => left - right)
  const at = (quantile: number): number => sorted.at(Math.min(sorted.length - 1, Math.floor(quantile * sorted.length))) ?? 0
  return { p50: at(0.5), p95: at(0.95), p99: at(0.99), max: sorted.at(-1) ?? 0, samples: sorted.length }
}

export function tenantFor(distribution: Distribution, index: number, random: () => number): number {
  if (distribution === "uniform") return 1 + (index % 1000)
  if (distribution === "hot-tenant") {
    return index % 10 === 0 ? 1 + Math.floor(random() * 3) : 4 + (index % 996)
  }
  return index % 10_000 < 8_000 ? 1 : 2 + (index % 7)
}

export interface EngineResult {
  engine: EngineName
  serverVersion: string
  serverConfig: Record<string, string>
  rows: number
  reps: number
  arms: Record<string, unknown>
  workloads: Workload[]
  distributions: Distribution[]
  queryPlans: Record<string, string>
  storage: Record<string, number>
  walBytes: number | null
  maintenance: Record<string, number>
}

export class NativeResultError extends Error {
  readonly code: string

  constructor(code: string, message: string) {
    super(message)
    this.name = "NativeResultError"
    this.code = code
  }
}

export function validateNativeResult(result: EngineResult): void {
  if (!ENGINES.includes(result.engine)) throw new NativeResultError("unknown-engine", `unknown engine ${result.engine}`)
  if (!result.serverVersion) throw new NativeResultError("missing-server-version", "server version is required")
  if (Object.keys(result.serverConfig).length === 0) {
    throw new NativeResultError("missing-server-config", "server configuration is required")
  }
  if (result.reps < 5) throw new NativeResultError("insufficient-reps", `primary cells need at least 5 reps, got ${result.reps}`)
  if (result.rows <= 0) throw new NativeResultError("missing-rows", "row count is required")
  for (const workload of WORKLOADS) {
    if (!result.workloads.includes(workload)) {
      throw new NativeResultError("missing-workload", `workload ${workload} is missing`)
    }
  }
  for (const distribution of DISTRIBUTIONS) {
    if (!result.distributions.includes(distribution)) {
      throw new NativeResultError("missing-distribution", `distribution ${distribution} is missing`)
    }
  }
  if (Object.keys(result.arms).length === 0) throw new NativeResultError("missing-arms", "no key arms were measured")
  for (const arm of Object.keys(result.arms)) {
    const cell = result.arms[arm] as { reps?: number; insert?: Percentiles; pointLookup?: Percentiles; rangeScan?: unknown; update?: Percentiles; delete?: Percentiles; maintenance?: Percentiles; concurrentWriters?: number } | undefined
    if (!cell) throw new NativeResultError("missing-arm", `arm ${arm} is empty`)
    if ((cell.reps ?? 0) < 5) throw new NativeResultError("insufficient-reps", `arm ${arm} has ${cell.reps ?? 0} reps`)
    for (const metric of ["insert", "pointLookup", "update", "delete", "maintenance"] as const) {
      const value = cell[metric]
      if (!value || value.samples === 0) {
        throw new NativeResultError("missing-metric", `arm ${arm} has no ${metric} samples`)
      }
    }
    if (cell.rangeScan === undefined) {
      throw new NativeResultError("missing-metric", `arm ${arm} has no rangeScan result`)
    }
    if (cell.concurrentWriters === undefined) {
      throw new NativeResultError("missing-metric", `arm ${arm} has no concurrentWriters result`)
    }
  }
  if (Object.keys(result.queryPlans).length === 0) {
    throw new NativeResultError("missing-query-plan", "at least one query plan is required")
  }
  if (Object.keys(result.storage).length === 0) {
    throw new NativeResultError("missing-storage", "storage metrics are required")
  }
  if (Object.keys(result.maintenance).length === 0) {
    throw new NativeResultError("missing-maintenance", "maintenance metrics are required")
  }
  if (result.walBytes === null) {
    throw new NativeResultError("missing-wal", "WAL or redo-log size is required")
  }
}
