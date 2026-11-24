/// <reference types="node" />
import assert from "node:assert/strict"
import path from "node:path"
import { test } from "node:test"
import { pathToFileURL } from "node:url"

import { need } from "../shared/need.ts"

const root = path.resolve(import.meta.dirname, "..", "..")

const algo: unknown = await import(
  pathToFileURL(path.join(root, "dist/algo.js")).href
)

const { inferWorkload } = algo as {
  inferWorkload: (
    trace: readonly unknown[],

    schema: {
      readonly name: string
      readonly fields: readonly { readonly name: string }[]
    }
  ) => {
    profile: {
      readWeight: number

      writeWeight: number

      fields: { name: string; role: string; selectivity?: number }[]
    }

    weights: Record<string, number>

    cardinalities: Record<string, number>
  }
}

const schema = { fields: [{ name: "tenant" }, { name: "region" }], name: "exp" }

const point = (
  op: string,
  filters: Readonly<Record<string, number>>,
  matched = 10,
  scanned = 1000
): {
  filters: Readonly<Record<string, number>>
  kind: "point"
  matched: number
  op: string
  scanned: number
} => ({ filters, kind: "point", matched, op, scanned })

void test("inferWorkload recovers weights and roles from a skewed trace", () => {
  const trace = [
    ...Array.from({ length: 80 }, (_, i) =>
      point("read", { tenant: (i % 8) + 1 })
    ),

    ...Array.from({ length: 15 }, (_, i) => ({
      filters: { region: (i % 4) + 1 },

      kind: "range",

      matched: 250,

      op: "read",

      scanned: 1000,
    })),

    ...Array.from({ length: 5 }, () => ({
      filters: {},
      kind: "scan",
      op: "write",
    })),
  ]

  const inferred = inferWorkload(trace, schema)

  assert.equal(inferred.profile.readWeight, 95)

  assert.equal(inferred.profile.writeWeight, 5)

  assert.equal(inferred.weights.tenant, 80)

  assert.equal(inferred.weights.region, 15)

  const role = new Map(inferred.profile.fields.map((f) => [f.name, f.role]))

  assert.equal(role.get("region"), "partition")

  assert.equal(role.get("tenant"), "lookup")

  assert.equal(inferred.cardinalities.tenant, 8)

  assert.equal(inferred.cardinalities.region, 4)
})

void test("inferWorkload estimates selectivity from matched/scanned pairs", () => {
  const trace = [
    point("read", { tenant: 1 }, 10, 1000),

    point("read", { tenant: 2 }, 30, 1000),
  ]

  const inferred = inferWorkload(trace, schema)

  const tenant = need(inferred.profile.fields.find((f) => f.name === "tenant"))

  assert.ok(Math.abs((tenant.selectivity ?? -1) - 0.02) < 1e-9)
})

void test("inferWorkload rejects an empty trace", () => {
  assert.throws(() => inferWorkload([], schema), /non-empty/u)
})

void test("inferWorkload rejects filters on unknown fields", () => {
  assert.throws(
    () => inferWorkload([point("read", { ghost: 1 })], schema),
    /ghost/u
  )
})

void test("inferWorkload rejects garbage events", () => {
  assert.throws(
    () => inferWorkload([{ filters: {}, kind: "point", op: "delete" }], schema),
    /op/u
  )

  assert.throws(
    () => inferWorkload([{ filters: {}, kind: "fetch", op: "read" }], schema),
    /kind/u
  )
})
