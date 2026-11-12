// Workload-driven layout planning, end to end (future.md item 1).
//
// Closes the loop the paper admits is open: weights are inferred from a
// query trace (inferWorkload) instead of hand-declared, the Smith-rule
// planner (planBitAllocation) orders fields by inferred weight, and the
// planned layout is measured against a hand-ordered layout on the traced
// workload in SQLite. The trace is synthetic but seeded and archived, so
// the loop — not the trace — is the claim under test.
//
// Usage: bun run scripts/bench-workload.ts
//   Env: WORKLOAD_N (inserts, default 200000), WORKLOAD_REPS (default 5),
//        WORKLOAD_LOOKUPS (default 500), WORKLOAD_OUT (default
//        results/workload-planning.json), WORKLOAD_SEED (default 0x9e3779b9).

import { mkdirSync, writeFileSync } from "node:fs"
import os from "node:os"
import path from "node:path"
import { performance } from "node:perf_hooks"
import { Database } from "bun:sqlite"
import { pathToFileURL } from "node:url"
import { aggregateReps } from "./bench-db.ts"

const root = path.resolve(import.meta.dirname, "..")
const algo = await import(pathToFileURL(path.join(root, "dist/algo.js")).href)

const {
  completeLayout,
  genStructuredGenoID,
  inferWorkload,
  planBitAllocation,
  uuidToBytes,
} = algo as {
  completeLayout: (name: string, fields: unknown[]) => { name: string; fields: { name: string; start: number; length: number }[] }
  genStructuredGenoID: (layout: unknown) => string
  inferWorkload: (
    trace: unknown[],
    schema: { name: string; fields: { name: string }[] },
  ) => {
    profile: { readWeight: number; writeWeight: number; fields: { name: string; role: string }[] }
    weights: Record<string, number>
    cardinalities: Record<string, number>
  }
  planBitAllocation: (input: {
    budget?: number
    fields: { name: string; cardinality: number; weight: number }[]
  }) => {
    feasible: boolean
    reason?: string
    fields: { name: string; bits: number; offset: number }[]
    randomBits: number
  }
  uuidToBytes: (uuid: string) => Uint8Array
}

const N = Number(process.env.WORKLOAD_N ?? 200_000)
const REPS = Math.max(1, Number(process.env.WORKLOAD_REPS ?? 5))
const LOOKUPS = Number(process.env.WORKLOAD_LOOKUPS ?? 500)
const OUT = process.env.WORKLOAD_OUT ?? "results/workload-planning.json"
const SEED = Number(process.env.WORKLOAD_SEED ?? 0x9e3779b9) >>> 0

// Seeded xorshift32: the trace distribution is fixed and archived.
function rng32(seed: number): () => number {
  let s = seed >>> 0 || 1
  return () => {
    s ^= s << 13
    s ^= s >>> 17
    s ^= s << 5
    return (s >>> 0) / 0x1_0000_0000
  }
}

const TENANT_VALUES = [0, 1, 2, 3, 4, 5, 6, 7]
const REGION_VALUES = [0, 1, 2, 3]

interface TraceEvent {
  op: "read" | "write"
  kind: "point" | "range" | "scan"
  filters: Record<string, number>
}

// 80% tenant point reads, 15% region range reads, 5% blind writes.
function generateTrace(n: number, rand: () => number): TraceEvent[] {
  const trace: TraceEvent[] = []
  for (let i = 0; i < n; i++) {
    const r = rand()
    if (r < 0.8) {
      trace.push({ op: "read", kind: "point", filters: { tenant: TENANT_VALUES[Math.floor(rand() * 8)] } })
    } else if (r < 0.95) {
      trace.push({ op: "read", kind: "range", filters: { region: REGION_VALUES[Math.floor(rand() * 4)] } })
    } else {
      trace.push({ op: "write", kind: "scan", filters: {} })
    }
  }
  return trace
}

const schema = { name: "workload-exp", fields: [{ name: "tenant" }, { name: "region" }] }

function tenantField(start: number) {
  return { name: "tenant", start, length: 3, type: "shard", constraint: { allowed: [0, 1, 2, 3, 4, 5, 6, 7] } }
}

function regionField(start: number) {
  return { name: "region", start, length: 2, type: "shard", constraint: { allowed: [0, 1, 2, 3] } }
}

const rand = rng32(SEED)
const trace = generateTrace(10_000, rand)
const inferred = inferWorkload(trace, schema)
console.log("inferred weights:", JSON.stringify(inferred.weights))
console.log("inferred roles:", JSON.stringify(inferred.profile.fields.map((f) => `${f.name}:${f.role}`)))

const plan = planBitAllocation({
  fields: Object.entries(inferred.weights).map(([name, weight]) => ({
    name,
    cardinality: inferred.cardinalities[name],
    weight,
  })),
})
if (!plan.feasible) throw new Error(`planner infeasible: ${plan.reason}`)
const smithOrder = plan.fields.map((f) => f.name)
console.log("smith order:", smithOrder.join(","), `randomBits=${plan.randomBits}`)

function layoutFor(order: string[], tag: string) {
  const starts = new Map<string, number>()
  let cursor = 0
  for (const name of order) {
    const bits = name === "tenant" ? 3 : 2
    starts.set(name, cursor)
    cursor += bits
  }
  return completeLayout(`workload-${tag}`, [
    tenantField(starts.get("tenant")!),
    regionField(starts.get("region")!),
  ])
}

// Hand baseline: declaration order (region buried tenant is the plausible
// hand mistake the planner must beat — region first, tenant second).
const planned = layoutFor(smithOrder, "planned")
const hand = layoutFor(["region", "tenant"], "hand")

function buildTable(layout: unknown, label: string): { db: Database; ids: Uint8Array[] } {
  const db = new Database(":memory:")
  db.run("CREATE TABLE ids (id BLOB(16) PRIMARY KEY) WITHOUT ROWID")
  const ids: Uint8Array[] = []
  const insert = db.prepare("INSERT INTO ids (id) VALUES (?)")
  const insertStart = performance.now()
  for (let i = 0; i < N; i++) {
    const bytes = uuidToBytes(genStructuredGenoID(layout))
    ids.push(bytes)
    insert.run(bytes)
  }
  const insertMs = performance.now() - insertStart
  console.log(`  ${label}: ${(N / (insertMs / 1000)).toFixed(0)} rows/s`)
  return { db, ids }
}

// Tenant point lookup as PK range terms. The tenant field is 3 bits at
// `start`; every byte-0 value consistent with tenant=t forms runs that the
// PK index can seek. A leading tenant (start 0) is one run; a buried tenant
// is several — the mechanism the experiment measures.
function tenantRanges(tenant: number, start: number): [number, number][] {
  const values: number[] = []
  for (let b = 0; b < 256; b++) {
    if (((b >> (7 - (start + 2))) & 7) === tenant) values.push(b)
  }
  const runs: [number, number][] = []
  let runStart = values[0]
  let prev = values[0]
  for (const v of values.slice(1)) {
    if (v !== prev + 1) {
      runs.push([runStart, prev])
      runStart = v
    }
    prev = v
  }
  runs.push([runStart, prev])
  return runs
}

function benchLookups(db: Database, tenants: number[], start: number): number[] {
  const times: number[] = []
  for (let r = 0; r < REPS; r++) {
    const startMs = performance.now()
    for (let i = 0; i < LOOKUPS; i++) {
      const t = tenants[(r * LOOKUPS + i) % tenants.length]
      const terms = tenantRanges(t, start)
        .map(() => "(id >= ? AND id <= ?)")
        .join(" OR ")
      const stmt = db.prepare(`SELECT COUNT(*) AS n FROM ids WHERE ${terms}`)
      const params: Uint8Array[] = []
      for (const [lo, hi] of tenantRanges(t, start)) {
        const loB = new Uint8Array(16)
        const hiB = new Uint8Array(16).fill(0xff)
        loB[0] = lo
        hiB[0] = hi
        params.push(loB, hiB)
      }
      stmt.get(...params)
    }
    times.push(((performance.now() - startMs) / LOOKUPS) * 1000)
  }
  return times
}

const plannedTables = buildTable(planned, "planned")
const handTables = buildTable(hand, "hand")

const probeTenants = Array.from({ length: LOOKUPS }, (_, i) => i % 8)
function fieldStart(layout: { fields: { name: string; start: number }[] }, name: string): number {
  const field = layout.fields.find((f) => f.name === name)
  if (!field) throw new Error(`layout is missing field ${name}`)
  return field.start
}
const plannedStart = fieldStart(planned, "tenant")
const handStart = fieldStart(hand, "tenant")

function countTenant(db: Database, tenant: number, start: number): number {
  const terms = tenantRanges(tenant, start)
    .map(() => "(id >= ? AND id <= ?)")
    .join(" OR ")
  const params: Uint8Array[] = []
  for (const [lo, hi] of tenantRanges(tenant, start)) {
    const loB = new Uint8Array(16)
    const hiB = new Uint8Array(16).fill(0xff)
    loB[0] = lo
    hiB[0] = hi
    params.push(loB, hiB)
  }
  const row = db.prepare(`SELECT COUNT(*) AS n FROM ids WHERE ${terms}`).get(...params) as { n: number }
  return row.n
}

// The two tables hold independent random draws, so cross-table counts differ
// by chance. Integrity instead checks each layout's range query against a
// JS bit-decode of the same table's stored IDs.
function decodeTenant(bytes: Uint8Array, start: number): number {
  let v = 0
  for (let i = 0; i < 3; i++) {
    const bit = start + i
    v = (v << 1) | ((bytes[bit >> 3] >> (7 - (bit & 7))) & 1)
  }
  return v
}

for (const [label, tables, start] of [
  ["planned", plannedTables, plannedStart],
  ["hand", handTables, handStart],
] as const) {
  const expected = new Array<number>(8).fill(0)
  for (const bytes of tables.ids) expected[decodeTenant(bytes, start)]++
  for (let t = 0; t < 8; t++) {
    const got = countTenant(tables.db, t, start)
    if (got !== expected[t]) throw new Error(`${label} tenant ${t}: SQL count ${got} != decoded ${expected[t]}`)
  }
}
console.log("  integrity: SQL range counts match JS bit-decodes on both layouts")

const plannedUs = benchLookups(plannedTables.db, probeTenants, plannedStart)
const handUs = benchLookups(handTables.db, probeTenants, handStart)
const plannedStats = aggregateReps(plannedUs)
const handStats = aggregateReps(handUs)
console.log(`  tenant lookup planned: ${plannedStats.mean.toFixed(2)} us (CI ${plannedStats.ci95[0].toFixed(2)}-${plannedStats.ci95[1].toFixed(2)})`)
console.log(`  tenant lookup hand:    ${handStats.mean.toFixed(2)} us (CI ${handStats.ci95[0].toFixed(2)}-${handStats.ci95[1].toFixed(2)})`)

plannedTables.db.close()
handTables.db.close()

const report = {
  experiment: "workload-planning",
  description:
    "Trace (seeded, archived params) -> inferWorkload weights/roles -> planBitAllocation Smith order -> SQLite tenant-lookup latency, planned vs hand order",
  trace: { seed: SEED, events: trace.length, mix: "0.80 tenant-point / 0.15 region-range / 0.05 write" },
  inferred: { weights: inferred.weights, cardinalities: inferred.cardinalities, roles: inferred.profile.fields },
  plan: { smithOrder, randomBits: plan.randomBits },
  handOrder: ["region", "tenant"],
  lookupUs: { planned: plannedStats, hand: handStats, ratio: handStats.mean / plannedStats.mean },
  environment: {
    os: `${os.platform()} ${os.release()} ${os.arch()}`,
    runtime: process.versions.bun ? `Bun ${process.versions.bun}` : `Node ${process.version}`,
    generatedAt: new Date().toISOString(),
  },
}

mkdirSync(path.dirname(path.resolve(root, OUT)), { recursive: true })
writeFileSync(path.resolve(root, OUT), `${JSON.stringify(report, null, 2)}\n`)
console.log(`\nwrote ${OUT} (planned/hand lookup ratio ${report.lookupUs.ratio.toFixed(2)}x)`)
