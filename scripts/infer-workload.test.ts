import assert from "node:assert/strict"
import { test } from "node:test"
import { pathToFileURL } from "node:url"
import path from "node:path"

const root = path.resolve(import.meta.dirname, "..")
const algo = await import(pathToFileURL(path.join(root, "dist/algo.js")).href)

const { inferWorkload } = algo as {
  inferWorkload: (
    trace: unknown[],
    schema: { name: string; fields: { name: string }[] },
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

const schema = { name: "exp", fields: [{ name: "tenant" }, { name: "region" }] }

function point(op: string, filters: Record<string, number>, matched = 10, scanned = 1000) {
  return { op, kind: "point", filters, matched, scanned }
}

test("inferWorkload recovers weights and roles from a skewed trace", () => {
  const trace = [
    ...Array.from({ length: 80 }, (_, i) => point("read", { tenant: (i % 8) + 1 })),
    ...Array.from({ length: 15 }, (_, i) => ({
      op: "read",
      kind: "range",
      filters: { region: (i % 4) + 1 },
      matched: 250,
      scanned: 1000,
    })),
    ...Array.from({ length: 5 }, () => ({ op: "write", kind: "scan", filters: {} })),
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

test("inferWorkload estimates selectivity from matched/scanned pairs", () => {
  const trace = [
    point("read", { tenant: 1 }, 10, 1000),
    point("read", { tenant: 2 }, 30, 1000),
  ]
  const inferred = inferWorkload(trace, schema)
  const tenant = inferred.profile.fields.find((f) => f.name === "tenant")!
  assert.ok(Math.abs((tenant.selectivity ?? -1) - 0.02) < 1e-9)
})

test("inferWorkload rejects an empty trace", () => {
  assert.throws(() => inferWorkload([], schema), /non-empty/)
})

test("inferWorkload rejects filters on unknown fields", () => {
  assert.throws(() => inferWorkload([point("read", { ghost: 1 })], schema), /ghost/)
})

test("inferWorkload rejects garbage events", () => {
  assert.throws(() => inferWorkload([{ op: "delete", kind: "point", filters: {} }], schema), /op/)
  assert.throws(() => inferWorkload([{ op: "read", kind: "fetch", filters: {} }], schema), /kind/)
})
