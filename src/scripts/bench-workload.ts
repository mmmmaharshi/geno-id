// Workload-driven layout planning, end to end (future.md item 1).
//
// Closes the loop the paper admits is open: weights are inferred from a
// query trace (inferWorkload) instead of hand-declared, the Smith-rule
// planner (planBitAllocation) orders fields by inferred weight, and the
// planned layout is measured against a hand-ordered layout on the traced
// workload in SQLite. The trace is synthetic but seeded and archived, so
// the loop — not the trace — is the claim under test.
//
// Usage: bun run src/scripts/bench-workload.ts
//   Env: WORKLOAD_N (inserts, default 200000), WORKLOAD_REPS (default 5),
//        WORKLOAD_LOOKUPS (default 500), WORKLOAD_OUT (default
//        results/workload-planning.json), WORKLOAD_SEED (default 0x9e3779b9).

import { mkdirSync, writeFileSync } from "node:fs"
import os from "node:os"
import path from "node:path"
import { performance } from "node:perf_hooks"
import { Database } from "bun:sqlite"
import { PGlite } from "@electric-sql/pglite"
import { pathToFileURL } from "node:url"
import { aggregateReps } from "./bench-db.ts"

const root = path.resolve(import.meta.dirname, "..", "..")
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
// Overridable as shares "tenant,region,write", e.g. "0.1,0.8,0.1".
function generateTrace(n: number, rand: () => number, mix: [number, number, number]): TraceEvent[] {
  const trace: TraceEvent[] = []
  for (let i = 0; i < n; i++) {
    const r = rand()
    if (r < mix[0]) {
      trace.push({ op: "read", kind: "point", filters: { tenant: TENANT_VALUES[Math.floor(rand() * 8)] } })
    } else if (r < mix[0] + mix[1]) {
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
const mixParts = (process.env.WORKLOAD_MIX ?? "0.8,0.15,0.05").split(",").map(Number)
if (mixParts.length !== 3 || mixParts.some((x) => !(x >= 0))) {
  throw new Error(`WORKLOAD_MIX must be "tenant,region,write" shares, got ${process.env.WORKLOAD_MIX}`)
}
const trace = generateTrace(10_000, rand, [mixParts[0], mixParts[1], mixParts[2]])
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

const ENGINES = (process.env.WORKLOAD_ENGINES ?? "sqlite,pg").split(",").map((s) => s.trim())
for (const e of ENGINES) {
  if (e !== "sqlite" && e !== "pg") throw new Error(`WORKLOAD_ENGINES must list sqlite and/or pg, got ${process.env.WORKLOAD_ENGINES}`)
}

// Minimal dialect adapter: SQLite (bun:sqlite, in-memory) and PostgreSQL
// (PGlite, embedded real Postgres). Both store 16-byte keys and answer the
// same PK range queries; only the DDL, placeholders, and count type differ.
interface BenchDb {
  readonly engine: string
  createIdsTable(): Promise<void>
  insertIds(ids: Uint8Array[]): Promise<number>
  countRanges(ranges: [number, number][]): Promise<number>
  close(): Promise<void>
}

function rangeBounds(range: [number, number]): [Uint8Array, Uint8Array] {
  const loB = new Uint8Array(16)
  const hiB = new Uint8Array(16).fill(0xff)
  loB[0] = range[0]
  hiB[0] = range[1]
  return [loB, hiB]
}

function makeSqliteDb(): BenchDb {
  const db = new Database(":memory:")
  return {
    engine: "sqlite",
    async createIdsTable(): Promise<void> {
      db.run("CREATE TABLE ids (id BLOB(16) PRIMARY KEY) WITHOUT ROWID")
    },
    async insertIds(ids: Uint8Array[]): Promise<number> {
      const insert = db.prepare("INSERT INTO ids (id) VALUES (?)")
      const start = performance.now()
      for (const bytes of ids) insert.run(bytes)
      return ids.length / ((performance.now() - start) / 1000)
    },
    async countRanges(ranges: [number, number][]): Promise<number> {
      const terms = ranges.map(() => "(id >= ? AND id <= ?)").join(" OR ")
      const params: Uint8Array[] = []
      for (const r of ranges) params.push(...rangeBounds(r))
      const row = db.prepare(`SELECT COUNT(*) AS n FROM ids WHERE ${terms}`).get(...params) as { n: number }
      return row.n
    },
    async close(): Promise<void> {
      db.close()
    },
  }
}

function makePgDb(): BenchDb {
  const db = new PGlite()
  return {
    engine: "postgres",
    async createIdsTable(): Promise<void> {
      await db.query("CREATE TABLE ids (id BYTEA PRIMARY KEY)")
    },
    async insertIds(ids: Uint8Array[]): Promise<number> {
      const start = performance.now()
      await db.query("BEGIN")
      for (let i = 0; i < ids.length; i += 500) {
        const chunk = ids.slice(i, i + 500)
        const values = chunk.map((_, j) => `($${j + 1})`).join(",")
        await db.query(`INSERT INTO ids (id) VALUES ${values}`, chunk as unknown as string[])
      }
      await db.query("COMMIT")
      return ids.length / ((performance.now() - start) / 1000)
    },
    async countRanges(ranges: [number, number][]): Promise<number> {
      let i = 0
      const terms = ranges.map(() => `(id >= $${++i} AND id <= $${++i})`).join(" OR ")
      const params: Uint8Array[] = []
      for (const r of ranges) params.push(...rangeBounds(r))
      const result = await db.query(`SELECT COUNT(*) AS n FROM ids WHERE ${terms}`, params)
      return Number((result.rows[0] as { n: string }).n)
    },
    async close(): Promise<void> {
      await db.close()
    },
  }
}

async function openDb(engine: string): Promise<BenchDb> {
  return engine === "pg" ? makePgDb() : makeSqliteDb()
}

// Field-equality lookup as PK range terms. A length-L field at bit `start`
// matches 2^(8-L) byte-0 values (when fully inside byte 0) forming runs the
// PK index can seek: 1 run when leading, several when buried.
function fieldRanges(value: number, start: number, length: number): [number, number][] {
  const shift = 7 - (start + length - 1)
  const mask = (1 << length) - 1
  const values: number[] = []
  for (let b = 0; b < 256; b++) {
    if (((b >> shift) & mask) === value) values.push(b)
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

async function benchLookups(
  db: BenchDb,
  values: number[],
  start: number,
  length: number,
): Promise<number[]> {
  const times: number[] = []
  for (let r = 0; r < REPS; r++) {
    const startMs = performance.now()
    for (let i = 0; i < LOOKUPS; i++) {
      const t = values[(r * LOOKUPS + i) % values.length]
      await db.countRanges(fieldRanges(t, start, length))
    }
    times.push(((performance.now() - startMs) / LOOKUPS) * 1000)
  }
  return times
}

function fieldStart(layout: { fields: { name: string; start: number }[] }, name: string): number {
  const field = layout.fields.find((f) => f.name === name)
  if (!field) throw new Error(`layout is missing field ${name}`)
  return field.start
}

// The measured query is the workload's hot field: tenant point lookups when
// tenant dominates, region range probes when region does.
const hotField =
  inferred.weights.tenant >= inferred.weights.region
    ? { name: "tenant", values: [0, 1, 2, 3, 4, 5, 6, 7], length: 3 }
    : { name: "region", values: [0, 1, 2, 3], length: 2 }
const probeValues = Array.from({ length: LOOKUPS }, (_, i) => hotField.values[i % hotField.values.length])
const plannedStart = fieldStart(planned, hotField.name)
const handStart = fieldStart(hand, hotField.name)

// IDs are generated once per layout so every engine measures the same multiset.
function genIds(layout: unknown): Uint8Array[] {
  const ids: Uint8Array[] = []
  for (let i = 0; i < N; i++) ids.push(uuidToBytes(genStructuredGenoID(layout)))
  return ids
}
const plannedIds = genIds(planned)
const handIds = genIds(hand)

interface EngineArm {
  insertRowsPerSec: number
  insertReps: number[]
  lookupUs: { mean: number; ci95: [number, number] }
  integrityOk: boolean
}

const INSERT_REPS = 2

const engines: Record<string, { planned: EngineArm; hand: EngineArm; ratio: number }> = {}
for (const engine of ENGINES) {
  console.log(`=== engine: ${engine} ===`)
  // Warmup (discarded): settle JIT/WASM paths so the first timed arm is not
  // systematically favoured — earlier runs showed a first-table advantage.
  const warm = await openDb(engine)
  await warm.createIdsTable()
  await warm.insertIds(plannedIds.slice(0, 5000))
  await warm.close()
  // Alternating timed reps: P,H,P,H. Any residual drift hits both arms equally.
  const insertReps: Record<"planned" | "hand", number[]> = { planned: [], hand: [] }
  const layouts = { planned: plannedIds, hand: handIds } as const
  for (let rep = 0; rep < INSERT_REPS; rep++) {
    for (const label of ["planned", "hand"] as const) {
      const db = await openDb(engine)
      await db.createIdsTable()
      insertReps[label].push(await db.insertIds(layouts[label]))
      await db.close()
    }
  }
  const arms: Record<string, EngineArm> = {}
  for (const [label, ids, start] of [
    ["planned", plannedIds, plannedStart],
    ["hand", handIds, handStart],
  ] as const) {
    const db = await openDb(engine)
    await db.createIdsTable()
    await db.insertIds(ids)
    const expected = new Array<number>(hotField.values.length).fill(0)
    for (const bytes of ids) expected[decodeField(bytes, start, hotField.length)]++
    for (const v of hotField.values) {
      const got = await db.countRanges(fieldRanges(v, start, hotField.length))
      if (got !== expected[v]) throw new Error(`${engine} ${label} ${hotField.name} ${v}: SQL count ${got} != decoded ${expected[v]}`)
    }
    const us = await benchLookups(db, probeValues, start, hotField.length)
    await db.close()
    const mean = insertReps[label].reduce((a, b) => a + b, 0) / insertReps[label].length
    arms[label] = { insertRowsPerSec: Math.round(mean), insertReps: insertReps[label].map(Math.round), lookupUs: aggregateReps(us), integrityOk: true }
  }
  const ratio = arms.hand.lookupUs.mean / arms.planned.lookupUs.mean
  engines[engine] = { ...arms, ratio } as (typeof engines)[string]
  console.log(`  integrity: SQL range counts match JS bit-decodes on both layouts`)
  console.log(`  insert planned: ${arms.planned.insertRowsPerSec} rows/s [${arms.planned.insertReps.join(",")}] hand: ${arms.hand.insertRowsPerSec} rows/s [${arms.hand.insertReps.join(",")}]`)
  console.log(`  ${hotField.name} lookup planned: ${arms.planned.lookupUs.mean.toFixed(2)} us (CI ${arms.planned.lookupUs.ci95[0].toFixed(2)}-${arms.planned.lookupUs.ci95[1].toFixed(2)})`)
  console.log(`  ${hotField.name} lookup hand:    ${arms.hand.lookupUs.mean.toFixed(2)} us (CI ${arms.hand.lookupUs.ci95[0].toFixed(2)}-${arms.hand.lookupUs.ci95[1].toFixed(2)})`)
}

const report = {
  experiment: "workload-planning",
  description:
    "Trace (seeded, archived params) -> inferWorkload weights/roles -> planBitAllocation Smith order -> hot-field lookup latency, planned vs hand order, per engine",
  trace: { seed: SEED, events: trace.length, mix: `tenant-point ${mixParts[0]} / region-range ${mixParts[1]} / write ${mixParts[2]}` },
  inferred: { weights: inferred.weights, cardinalities: inferred.cardinalities, roles: inferred.profile.fields },
  plan: { smithOrder, randomBits: plan.randomBits },
  handOrder: ["region", "tenant"],
  hotQuery: hotField.name,
  engines,
  // Legacy top-level shape (SQLite) preserved for existing citations.
  lookupUs: (engines.sqlite as { planned: EngineArm; hand: EngineArm; ratio: number } | undefined)
    ? {
        planned: engines.sqlite.planned.lookupUs,
        hand: engines.sqlite.hand.lookupUs,
        ratio: engines.sqlite.ratio,
      }
    : undefined,
  environment: {
    os: `${os.platform()} ${os.release()} ${os.arch()}`,
    runtime: process.versions.bun ? `Bun ${process.versions.bun}` : `Node ${process.version}`,
    postgres: "PGlite (embedded PostgreSQL)",
    generatedAt: new Date().toISOString(),
  },
}

// The two layouts hold independent random draws, so cross-layout counts differ
// by chance. Integrity instead checks each layout's range query against a
// JS bit-decode of the same table's stored IDs.
function decodeField(bytes: Uint8Array, start: number, length: number): number {
  let v = 0
  for (let i = 0; i < length; i++) {
    const bit = start + i
    v = (v << 1) | ((bytes[bit >> 3] >> (7 - (bit & 7))) & 1)
  }
  return v
}

mkdirSync(path.dirname(path.resolve(root, OUT)), { recursive: true })
writeFileSync(path.resolve(root, OUT), `${JSON.stringify(report, null, 2)}\n`)
console.log(`\nwrote ${OUT}`)
