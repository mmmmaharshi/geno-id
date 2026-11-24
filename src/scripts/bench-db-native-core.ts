import { nullValue, undefinedValue } from "./shared/runtime-values.ts"

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

/**
 * The engines an artifact actually measured, in canonical order. The result
 * file must list only these, not every engine the harness supports: a
 * PostgreSQL-only run declares `engines: [postgresql]`, so no reader infers
 * an InnoDB measurement that was never taken.
 *
 * @param {Readonly<Record<string, unknown>>} results Measured engine results.
 * @returns {EngineName[]} Engines with result data, in canonical order.
 */

export const enginesWithResults = (
  results: Record<string, unknown>
): EngineName[] => ENGINES.filter((name) => name in results)

export const SERVER_ENV: Record<EngineName, string> = {
  "mysql-innodb":
    "MYSQL_HOST / MYSQL_PORT / MYSQL_USER / MYSQL_PASSWORD / MYSQL_DB",

  postgresql: "PG_HOST / PG_PORT / PG_USER / PG_PASSWORD / PG_DB",
}

export const serverTarget = (
  name: EngineName,

  env: Record<string, string | undefined>
): { host: string; port: number } => {
  if (name === "postgresql") {
    return {
      host: env.PG_HOST ?? "localhost",
      port: Number(env.PG_PORT ?? 5432),
    }
  }

  return {
    host: env.MYSQL_HOST ?? "localhost",
    port: Number(env.MYSQL_PORT ?? 3306),
  }
}

export const unreachableMessage = (
  name: EngineName,
  target: Readonly<{ host: string; port: number }>
): string[] => [
  `No ${name} server reachable at ${target.host}:${target.port}.`,

  "This benchmark measures a real database server, so it cannot run here.",

  `Start the server, or point the harness at one with: ${SERVER_ENV[name]}`,
]

export interface Percentiles {
  p50: number

  p95: number

  p99: number

  max: number

  samples: number
}

export const percentiles = (values: readonly number[]): Percentiles => {
  if (values.length === 0) {
    return { max: 0, p50: 0, p95: 0, p99: 0, samples: 0 }
  }

  const sorted = values.toSorted((left, right) => left - right)

  const at = (quantile: number): number =>
    sorted.at(
      Math.min(sorted.length - 1, Math.floor(quantile * sorted.length))
    ) ?? 0

  return {
    max: sorted.at(-1) ?? 0,
    p50: at(0.5),
    p95: at(0.95),
    p99: at(0.99),
    samples: sorted.length,
  }
}

export const tenantFor = (
  distribution: Distribution,
  index: number,
  random: () => number
): number => {
  if (distribution === "uniform") {
    return 1 + (index % 1000)
  }

  if (distribution === "hot-tenant") {
    let tenant = 4 + (index % 996)

    if (index % 10 === 0) {
      tenant = 1 + Math.floor(random() * 3)
    }

    return tenant
  }

  let tenant = 1

  if (index % 10_000 >= 8000) {
    tenant = 2 + (index % 7)
  }

  return tenant
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
  public readonly code: string

  public constructor(code: string, message: string) {
    super(message)

    this.name = "NativeResultError"

    this.code = code
  }
}

interface ArmCell {
  concurrentWriters?: number

  delete?: Percentiles

  insert?: Percentiles

  maintenance?: Percentiles

  pointLookup?: Percentiles

  rangeScan?: unknown

  reps?: number

  update?: Percentiles
}

const PRIMARY_METRICS = [
  "insert",
  "pointLookup",
  "update",
  "delete",
  "maintenance",
] as const

const validateArm = (arm: string, value: unknown): void => {
  const cell = value as ArmCell | undefined

  if (!cell) {
    throw new NativeResultError("missing-arm", `arm ${arm} is empty`)
  }

  if ((cell.reps ?? 0) < 5) {
    throw new NativeResultError(
      "insufficient-reps",
      `arm ${arm} has ${cell.reps ?? 0} reps`
    )
  }

  for (const metric of PRIMARY_METRICS) {
    const samples = cell[metric]

    if (!samples || samples.samples === 0) {
      throw new NativeResultError(
        "missing-metric",
        `arm ${arm} has no ${metric} samples`
      )
    }
  }

  if (cell.rangeScan === undefinedValue) {
    throw new NativeResultError(
      "missing-metric",
      `arm ${arm} has no rangeScan result`
    )
  }

  if (cell.concurrentWriters === undefinedValue) {
    throw new NativeResultError(
      "missing-metric",
      `arm ${arm} has no concurrentWriters result`
    )
  }
}

export const validateNativeResult = (result: Readonly<EngineResult>): void => {
  if (!ENGINES.includes(result.engine)) {
    throw new NativeResultError(
      "unknown-engine",
      `unknown engine ${result.engine}`
    )
  }

  if (!result.serverVersion) {
    throw new NativeResultError(
      "missing-server-version",
      "server version is required"
    )
  }

  if (Object.keys(result.serverConfig).length === 0) {
    throw new NativeResultError(
      "missing-server-config",
      "server configuration is required"
    )
  }

  if (result.reps < 5) {
    throw new NativeResultError(
      "insufficient-reps",
      `primary cells need at least 5 reps, got ${result.reps}`
    )
  }

  if (result.rows <= 0) {
    throw new NativeResultError("missing-rows", "row count is required")
  }

  for (const workload of WORKLOADS) {
    if (!result.workloads.includes(workload)) {
      throw new NativeResultError(
        "missing-workload",
        `workload ${workload} is missing`
      )
    }
  }

  for (const distribution of DISTRIBUTIONS) {
    if (!result.distributions.includes(distribution)) {
      throw new NativeResultError(
        "missing-distribution",
        `distribution ${distribution} is missing`
      )
    }
  }

  if (Object.keys(result.arms).length === 0) {
    throw new NativeResultError("missing-arms", "no key arms were measured")
  }

  for (const arm of Object.keys(result.arms)) {
    validateArm(arm, result.arms[arm])
  }

  if (Object.keys(result.queryPlans).length === 0) {
    throw new NativeResultError(
      "missing-query-plan",
      "at least one query plan is required"
    )
  }

  if (Object.keys(result.storage).length === 0) {
    throw new NativeResultError(
      "missing-storage",
      "storage metrics are required"
    )
  }

  if (Object.keys(result.maintenance).length === 0) {
    throw new NativeResultError(
      "missing-maintenance",
      "maintenance metrics are required"
    )
  }

  if (result.walBytes === nullValue) {
    throw new NativeResultError(
      "missing-wal",
      "WAL or redo-log size is required"
    )
  }
}
