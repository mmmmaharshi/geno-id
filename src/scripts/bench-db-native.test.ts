import assert from "node:assert/strict"
import { fromAny } from "@total-typescript/shoehorn"
import { test } from "node:test"
import {
  DISTRIBUTIONS,
  WORKLOADS,
  NativeResultError,
  enginesWithResults,
  percentiles,
  tenantFor,
  validateNativeResult,
} from "./bench-db-native-core.ts"
import type { EngineResult } from "./bench-db-native-core.ts"

const random = (): number => 0.5

test("percentiles orders samples and reports the count", () => {
  const result = percentiles([5, 1, 4, 2, 3])

  assert.equal(result.samples, 5)
  assert.equal(result.max, 5)
  assert.equal(result.p50, 3)
  assert.equal(result.p95, 5)
  assert.equal(result.p99, 5)
  assert.equal(percentiles([]).samples, 0)
})

test("tenantFor spreads uniform keys and concentrates hot-tenant keys", () => {
  const uniform = new Set(Array.from({ length: 200 }, (_, index) => tenantFor("uniform", index, random)))
  const hot = new Set(Array.from({ length: 200 }, (_, index) => tenantFor("hot-tenant", index, random)))

  assert.equal(uniform.size, 200)
  assert.ok(hot.size < uniform.size)
  assert.equal(tenantFor("uniform", 0, random), 1)
  assert.equal(tenantFor("uniform", 1000, random), 1)
  assert.equal(tenantFor("bursty", 0, random), 1)
  assert.notEqual(tenantFor("bursty", 8000, random), 1)
})

function baseResult(overrides: Partial<EngineResult> = {}): EngineResult {
  const cell = {
    concurrentWriters: 1000,
    delete: percentiles([1, 2, 3]),
    insert: percentiles([1, 2, 3]),
    maintenance: percentiles([1, 2, 3]),
    pointLookup: percentiles([1, 2, 3]),
    rangeScan: { ms: 4, plan: "Index Scan", rows: 100 },
    reps: 5,
    update: percentiles([1, 2, 3]),
  }
  return {
    arms: { uuid_v7: cell },
    distributions: [...DISTRIBUTIONS],
    engine: "postgresql",
    maintenance: { uuid_v7: 12 },
    queryPlans: { rangeScan: "Index Scan using t_pkey" },
    reps: 5,
    rows: 1000,
    serverConfig: { shared_buffers: "64MB" },
    serverVersion: "PostgreSQL 16.4",
    storage: { tableBytes: 1024 },
    walBytes: 2048,
    workloads: [...WORKLOADS],
    ...overrides,
  }
}

test("validateNativeResult accepts a complete paired result", () => {
  assert.doesNotThrow(() => validateNativeResult(baseResult()))
})

test("validateNativeResult rejects fewer than five reps", () => {
  assert.throws(
    () => validateNativeResult(baseResult({ reps: 3 })),
    (error: unknown) => error instanceof NativeResultError && error.code === "insufficient-reps",
  )
})

test("validateNativeResult rejects a missing workload", () => {
  assert.throws(
    () => validateNativeResult(baseResult({ workloads: WORKLOADS.filter((entry) => entry !== "delete") })),
    (error: unknown) => error instanceof NativeResultError && error.code === "missing-workload",
  )
})

test("validateNativeResult rejects a missing distribution", () => {
  assert.throws(
    () => validateNativeResult(baseResult({ distributions: ["uniform"] })),
    (error: unknown) => error instanceof NativeResultError && error.code === "missing-distribution",
  )
})

test("validateNativeResult rejects missing WAL metrics", () => {
  assert.throws(
    () => validateNativeResult(baseResult({ walBytes: null })),
    (error: unknown) => error instanceof NativeResultError && error.code === "missing-wal",
  )
})

test("validateNativeResult rejects a missing server version", () => {
  assert.throws(
    () => validateNativeResult(baseResult({ serverVersion: "" })),
    (error: unknown) => error instanceof NativeResultError && error.code === "missing-server-version",
  )
})

test("validateNativeResult rejects an arm without range scan evidence", () => {
  const result = baseResult()
  const arm = { ...(fromAny<Record<string, unknown>, unknown>(result.arms.uuid_v7)) }
  delete arm.rangeScan
  assert.throws(
    () => validateNativeResult({ ...result, arms: { uuid_v7: arm } }),
    (error: unknown) => error instanceof NativeResultError && error.code === "missing-metric",
  )
})

test("enginesWithResults lists only the engines the artifact actually measured", () => {
  assert.deepEqual(enginesWithResults({ postgresql: baseResult() }), ["postgresql"])
  assert.deepEqual(
    enginesWithResults({ "mysql-innodb": baseResult(), postgresql: baseResult() }),
    ["postgresql", "mysql-innodb"],
  )
  assert.deepEqual(enginesWithResults({}), [])
})
