/// <reference types="node" />

import {
  DISTRIBUTIONS,
  NativeResultError,
  WORKLOADS,
  enginesWithResults,
  percentiles,
  tenantFor,
  validateNativeResult,
} from "./bench-db-native-core.ts"

import assert from "node:assert/strict"

import { fromAny } from "@total-typescript/shoehorn"

import { test } from "node:test"

type EngineResult = Parameters<typeof validateNativeResult>[0]

const nullValue: null = JSON.parse("null") as null

const random = (): number => 0.5

void test("percentiles orders samples and reports the count", () => {
  const result = percentiles([5, 1, 4, 2, 3])

  assert.equal(result.samples, 5)

  assert.equal(result.max, 5)

  assert.equal(result.p50, 3)

  assert.equal(result.p95, 5)

  assert.equal(result.p99, 5)

  assert.equal(percentiles([]).samples, 0)
})

void test("tenantFor spreads uniform keys and concentrates hot-tenant keys", () => {
  const uniform = new Set(
    Array.from({ length: 200 }, (_, index) =>
      tenantFor("uniform", index, random),
    ),
  )

  const hot = new Set(
    Array.from({ length: 200 }, (_, index) =>
      tenantFor("hot-tenant", index, random),
    ),
  )

  assert.equal(uniform.size, 200)

  assert.ok(hot.size < uniform.size)

  assert.equal(tenantFor("uniform", 0, random), 1)

  assert.equal(tenantFor("uniform", 1000, random), 1)

  assert.equal(tenantFor("bursty", 0, random), 1)

  assert.notEqual(tenantFor("bursty", 8000, random), 1)
})

const baseResult = (overrides: Partial<EngineResult> = {}): EngineResult => {
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

  return Object.assign(
    Object.create(Object.prototype) as EngineResult,
    {
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
    },
    overrides,
  )
}

void test("validateNativeResult accepts a complete paired result", () => {
  assert.doesNotThrow(() => {
    validateNativeResult(baseResult())
  })
})

const assertNativeResultError = (action: () => void, code: string): void => {
  let caught: unknown = nullValue

  try {
    action()
  } catch (error) {
    caught = error
  }

  assert.ok(caught instanceof NativeResultError)

  assert.equal(caught.code, code)
}

void test("validateNativeResult rejects fewer than five reps", () => {
  assertNativeResultError(
    () => {
      validateNativeResult(baseResult({ reps: 3 }))
    },

    "insufficient-reps",
  )
})

void test("validateNativeResult rejects a missing workload", () => {
  assertNativeResultError(
    () => {
      validateNativeResult(
        baseResult({
          workloads: WORKLOADS.filter((entry) => entry !== "delete"),
        }),
      )
    },

    "missing-workload",
  )
})

void test("validateNativeResult rejects a missing distribution", () => {
  assertNativeResultError(
    () => {
      validateNativeResult(baseResult({ distributions: ["uniform"] }))
    },

    "missing-distribution",
  )
})

void test("validateNativeResult rejects missing WAL metrics", () => {
  assertNativeResultError(
    () => {
      validateNativeResult(baseResult({ walBytes: nullValue }))
    },

    "missing-wal",
  )
})

void test("validateNativeResult rejects a missing server version", () => {
  assertNativeResultError(
    () => {
      validateNativeResult(baseResult({ serverVersion: "" }))
    },

    "missing-server-version",
  )
})

void test("validateNativeResult rejects an arm without range scan evidence", () => {
  const result = baseResult()

  const arm = Object.assign(
    Object.create(Object.prototype) as Record<string, unknown>,
    fromAny<Record<string, unknown>, unknown>(result.arms.uuid_v7),
  )

  delete arm.rangeScan

  assertNativeResultError(
    () => {
      validateNativeResult(
        Object.assign(Object.create(Object.prototype) as EngineResult, result, {
          arms: { uuid_v7: arm },
        }),
      )
    },

    "missing-metric",
  )
})

void test("enginesWithResults lists only the engines the artifact actually measured", () => {
  assert.deepEqual(enginesWithResults({ postgresql: baseResult() }), [
    "postgresql",
  ])

  assert.deepEqual(
    enginesWithResults({
      "mysql-innodb": baseResult(),
      postgresql: baseResult(),
    }),

    ["postgresql", "mysql-innodb"],
  )

  assert.deepEqual(enginesWithResults({}), [])
})
