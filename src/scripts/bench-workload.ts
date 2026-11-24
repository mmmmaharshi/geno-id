import {
  andBits,
  orBits,
  shiftLeftBits,
  shiftRightBits,
  shiftRightUnsignedBits,
  xorBits,
} from "../shared/bitwise.ts"
import { mkdirSync, writeFileSync } from "node:fs"

import { nullValue, undefinedValue } from "./shared/runtime-values.ts"

import { Database } from "bun:sqlite"

import { PGlite } from "@electric-sql/pglite"

import { aggregateReps } from "./bench-db.ts"

import { mapPool } from "./shared/pool.ts"

import { need } from "../shared/need.ts"

import os from "node:os"

import path from "node:path"

import { pathToFileURL } from "node:url"

import { performance } from "node:perf_hooks"

// Workload-driven layout planning, end to end (future.md item 1).

//

// Closes the loop the paper admits is open: weights are inferred from a

// Query trace (inferWorkload) instead of hand-declared, the Smith-rule

// Planner (planBitAllocation) orders fields by inferred weight, and the

// Planned layout is measured against a hand-ordered layout on the traced

// Workload in SQLite. The trace is synthetic but seeded and archived, so

// The loop — not the trace — is the claim under test.

//

// Usage: bun run src/scripts/bench-workload.ts

//   Env: WORKLOAD_N (inserts, default 200000), WORKLOAD_REPS (default 5),

//        WORKLOAD_LOOKUPS (default 500), WORKLOAD_OUT (default

//        Results/workload-planning.json), WORKLOAD_SEED (default 0x9e3779b9).

const root = path.resolve(import.meta.dirname, "..", "..")

const algo = (await import(
  pathToFileURL(path.join(root, "dist/algo.js")).href
)) as {
  completeLayout: (name: string, fields: readonly unknown[]) => Layout

  genStructuredGenoID: (layout: unknown) => string

  inferWorkload: (
    trace: readonly unknown[],

    schema: Readonly<{ name: string; fields: readonly { name: string }[] }>,
  ) => {
    profile: {
      readWeight: number
      writeWeight: number
      fields: { name: string; role: string }[]
    }

    weights: Record<string, number>

    cardinalities: Record<string, number>
  }

  planBitAllocation: (input: {
    budget?: number

    fields: readonly { name: string; cardinality: number; weight: number }[]
  }) => {
    feasible: boolean

    reason?: string

    fields: { name: string; bits: number; offset: number }[]

    randomBits: number
  }

  uuidToBytes: (uuid: string) => Uint8Array
}

const {
  completeLayout,

  genStructuredGenoID,

  inferWorkload,

  planBitAllocation,

  uuidToBytes,
} = algo

const N = Number(process.env.WORKLOAD_N ?? 200_000)

const REPS = Math.max(1, Number(process.env.WORKLOAD_REPS ?? 5))

const LOOKUPS = Number(process.env.WORKLOAD_LOOKUPS ?? 500)

const OUT = process.env.WORKLOAD_OUT ?? "results/workload-planning.json"

const SEED = Math.trunc(Number(process.env.WORKLOAD_SEED ?? 0x9E_37_79_B9))

// Seeded xorshift32: the trace distribution is fixed and archived.

const rng32 = (seed: number): () => number => {
  let s = Math.trunc(seed)

  return () => {
    s = xorBits(s, shiftLeftBits(s, 13))

    s = xorBits(s, shiftRightUnsignedBits(s, 17))

    s = xorBits(s, shiftLeftBits(s, 5))

    return Math.trunc(s) / 0x1_00_00_00_00
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

const generateTrace = (
  n: number,
  rand: () => number,
  mix: readonly [number, number, number],
): TraceEvent[] => {
  const trace: TraceEvent[] = []

  for (let i = 0; i < n; i += 1) {
    const r = rand()

    if (r < mix[0]) {
      trace.push({
        filters: { tenant: TENANT_VALUES[Math.floor(rand() * 8)] },
        kind: "point",
        op: "read",
      })
    } else if (r < mix[0] + mix[1]) {
      trace.push({
        filters: { region: REGION_VALUES[Math.floor(rand() * 4)] },
        kind: "range",
        op: "read",
      })
    } else {
      trace.push({ filters: {}, kind: "scan", op: "write" })
    }
  }

  return trace
}

interface LayoutField {
  constraint?: { allowed: number[] }

  length: number

  name: string

  start: number

  type: string
}

interface Layout {
  name: string

  fields: LayoutField[]
}

const schema = {
  fields: [{ name: "tenant" }, { name: "region" }],
  name: "workload-exp",
}

const tenantField = (start: number): LayoutField => ({
  constraint: { allowed: [0, 1, 2, 3, 4, 5, 6, 7] },
  length: 3,
  name: "tenant",
  start,
  type: "shard",
})

const regionField = (start: number): LayoutField => ({
  constraint: { allowed: [0, 1, 2, 3] },
  length: 2,
  name: "region",
  start,
  type: "shard",
})

const rand = rng32(SEED)

const mixParts = (process.env.WORKLOAD_MIX ?? "0.8,0.15,0.05")
  .split(",")
  .map(Number)

if (mixParts.length !== 3 || mixParts.some((x) => !(x >= 0))) {
  throw new Error(
    `WORKLOAD_MIX must be "tenant,region,write" shares, got ${process.env.WORKLOAD_MIX}`,
  )
}

const trace = generateTrace(10_000, rand, [
  mixParts[0],
  mixParts[1],
  mixParts[2],
])

const inferred = inferWorkload(trace, schema)

console.log("inferred weights:", JSON.stringify(inferred.weights))

console.log(
  "inferred roles:",
  JSON.stringify(inferred.profile.fields.map((f) => `${f.name}:${f.role}`)),
)

const plan = planBitAllocation({
  fields: Object.entries(inferred.weights).map(([name, weight]) => ({
    cardinality: inferred.cardinalities[name],

    name,

    weight,
  })),
})

if (!plan.feasible) {
  throw new Error(`planner infeasible: ${plan.reason}`)
}

const smithOrder = plan.fields.map((f) => f.name)

console.log(
  "smith order:",
  smithOrder.join(","),
  `randomBits=${plan.randomBits}`,
)

const layoutFor = (order: readonly string[], tag: string): Layout => {
  const starts = new Map<string, number>()

  let cursor = 0

  for (const name of order) {
    let bits = 2

    if (name === "tenant") {
      bits = 3
    }

    starts.set(name, cursor)

    cursor += bits
  }

  const tenantStart = need(starts.get("tenant"))

  const regionStart = need(starts.get("region"))

  return completeLayout(`workload-${tag}`, [
    tenantField(tenantStart),

    regionField(regionStart),
  ])
}

// Hand baseline: declaration order (region buried tenant is the plausible

// Hand mistake the planner must beat — region first, tenant second).

const planned = layoutFor(smithOrder, "planned")

const hand = layoutFor(["region", "tenant"], "hand")

const engineNames = (process.env.WORKLOAD_ENGINES ?? "sqlite,pg")
  .split(",")
  .map((s) => s.trim())

for (const engine of engineNames) {
  if (engine !== "sqlite" && engine !== "pg") {
    throw new Error(
      `WORKLOAD_ENGINES must list sqlite and/or pg, got ${process.env.WORKLOAD_ENGINES}`,
    )
  }
}

const ENGINES = engineNames as ("sqlite" | "pg")[]

// Minimal dialect adapter: SQLite (bun:sqlite, in-memory) and PostgreSQL

// (PGlite, embedded real Postgres). Both store 16-byte keys and answer the

// Same PK range queries; only the DDL, placeholders, and count type differ.

interface BenchDb {
  readonly engine: string

  createIdsTable: () => void | Promise<void>

  insertIds: (ids: readonly Uint8Array[]) => number | Promise<number>

  countRanges: (
    ranges: readonly  [number, number][],
  ) => number | Promise<number>

  close: () => void | Promise<void>
}

const rangeBounds = (
  range: readonly [number, number],
): [Uint8Array, Uint8Array] => {
  const loB = new Uint8Array(16)

  const hiB = new Uint8Array(16).fill(0xFF)

  const [lo0] = range
  loB[0] = lo0

  const [, hi0] = range
  hiB[0] = hi0

  return [loB, hiB]
}

const makeSqliteDb = (): BenchDb => {
  const db = new Database(":memory:")

  return {
    close(): void {
      db.close()
    },

    countRanges(ranges: readonly  [number, number][]): number {
      const terms = ranges.map(() => "(id >= ? AND id <= ?)").join(" OR ")

      const params: Uint8Array[] = []

      for (const r of ranges) {
        params.push(...rangeBounds(r))
      }

      const row = db
        .prepare(`SELECT COUNT(*) AS n FROM ids WHERE ${terms}`)
        .get(...params) as { n: number }

      return row.n
    },

    createIdsTable(): void {
      db.run("CREATE TABLE ids (id BLOB(16) PRIMARY KEY) WITHOUT ROWID")
    },

    engine: "sqlite",

    insertIds(ids: readonly Uint8Array[]): number {
      const insert = db.prepare("INSERT INTO ids (id) VALUES (?)")

      const start = performance.now()

      for (const bytes of ids) {
        insert.run(bytes)
      }

      return ids.length / ((performance.now() - start) / 1000)
    },
  }
}

const makePgDb = (): BenchDb => {
  const db = new PGlite()

  return {
    async close(): Promise<void> {
      await db.close()
    },

    async countRanges(
      ranges: readonly  [number, number][],
    ): Promise<number> {
      let i = 0

      const terms = ranges
        .map(() => {
          i += 1
          const lo = i
          i += 1
          const hi = i
          return `(id >= ${lo} AND id <= ${hi})`
        })
        .join(" OR ")

      const params: Uint8Array[] = []

      for (const r of ranges) {
        params.push(...rangeBounds(r))
      }

      const result = await db.query(
        `SELECT COUNT(*) AS n FROM ids WHERE ${terms}`,
        params,
      )

      return Number((result.rows[0] as { n: string }).n)
    },

    async createIdsTable(): Promise<void> {
      await db.query("CREATE TABLE ids (id BYTEA PRIMARY KEY)")
    },

    engine: "postgres",

    async insertIds(ids: readonly Uint8Array[]): Promise<number> {
      const start = performance.now()

      await db.query("BEGIN")

      const insertChunk = async (offset: number): Promise<void> => {
        if (offset >= ids.length) {
          return
        }

        const chunk = ids.slice(offset, offset + 500)

        const values = chunk.map((_, j) => `($${j + 1})`).join(",")

        await db.query(`INSERT INTO ids (id) VALUES ${values}`, chunk)

        await insertChunk(offset + 500)
      }

      await insertChunk(0)

      await db.query("COMMIT")

      return ids.length / ((performance.now() - start) / 1000)
    },
  }
}

const openDb = (engine: string): BenchDb => {
  if (engine === "pg") {
    return makePgDb()
  }

  return makeSqliteDb()
}

// Field-equality lookup as PK range terms. A length-L field at bit `start`

// Matches 2^(8-L) byte-0 values (when fully inside byte 0) forming runs the

// PK index can seek: 1 run when leading, several when buried.

const fieldRanges = (
  value: number,
  start: number,
  length: number,
): [number, number][] => {
  const shift = 7 - (start + length - 1)

  const mask = shiftLeftBits(1, length) - 1

  const values: number[] = []

  for (let b = 0; b < 256; b += 1) {
    if (andBits(shiftRightBits(b, shift), mask) === value) {
      values.push(b)
    }
  }

  const runs: [number, number][] = []

  let runStart = need(values[0])

  let prev = runStart

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

const benchLookups = async (
  db: Readonly<BenchDb>,

  values: readonly number[],

  start: number,

  length: number,
): Promise<number[]> => {
  const times: number[] = []

  const runRep = async (r: number): Promise<void> => {
    if (r >= REPS) {
      return
    }

    const startMs = performance.now()

    const runLookup = async (i: number): Promise<void> => {
      if (i >= LOOKUPS) {
        return
      }

      const t = values[(r * LOOKUPS + i) % values.length]

      await db.countRanges(fieldRanges(t, start, length))

      await runLookup(i + 1)
    }

    await runLookup(0)

    times.push(((performance.now() - startMs) / LOOKUPS) * 1000)

    await runRep(r + 1)
  }

  await runRep(0)

  return times
}

const fieldStart = (
  layout: Readonly<{ fields: readonly { name: string; start: number }[] }>,
  name: string,
): number => {
  const field = layout.fields.find((f) => f.name === name)

  if (!field) {
    throw new Error(`layout is missing field ${name}`)
  }

  return field.start
}

// The measured query is the workload's hot field: tenant point lookups when

// Tenant dominates, region range probes when region does.

let hotField = { length: 2, name: "region", values: [0, 1, 2, 3] }

if (inferred.weights.tenant >= inferred.weights.region) {
  hotField = { length: 3, name: "tenant", values: [0, 1, 2, 3, 4, 5, 6, 7] }
}

const probeValues = Array.from(
  { length: LOOKUPS },
  (_, i) => hotField.values[i % hotField.values.length],
)

const plannedStart = fieldStart(planned, hotField.name)

const handStart = fieldStart(hand, hotField.name)

// IDs are generated once per layout so every engine measures the same multiset.

const genIds = (layout: unknown): Uint8Array[] => {
  const ids: Uint8Array[] = []

  for (let i = 0; i < N; i += 1) {
    ids.push(uuidToBytes(genStructuredGenoID(layout)))
  }

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

const decodeField = (
  bytes: Readonly<Uint8Array>,
  start: number,
  length: number,
): number => {
  let v = 0

  for (let i = 0; i < length; i += 1) {
    const bit = start + i

    const byteIndex = shiftRightBits(bit, 3)

    const byte = bytes[byteIndex]

    const shifted = shiftRightBits(byte, 7 - andBits(bit, 7))

    v = orBits(shiftLeftBits(v, 1), andBits(shifted, 1))
  }

  return v
}

const INSERT_REPS = 2

const engines: Partial<Record<"sqlite" | "pg", {
  planned: EngineArm
  hand: EngineArm
  ratio: number
}>> = {}

await mapPool(
  ENGINES,
  async (engine) => {
    console.log(`=== engine: ${engine} ===`)

    // Warmup (discarded): settle JIT/WASM paths so the first timed arm is not

    // Systematically favoured — earlier runs showed a first-table advantage.

    const warm = openDb(engine)

    await warm.createIdsTable()

    await warm.insertIds(plannedIds.slice(0, 5000))

    await warm.close()

    // Alternating timed reps: P,H,P,H. Any residual drift hits both arms equally.

    const insertReps: Record<"planned" | "hand", number[]> = {
      hand: [],
      planned: [],
    }

    const layouts = { hand: handIds, planned: plannedIds } as const

    const insertOrder = Array.from(
      { length: INSERT_REPS },
      () => ["planned", "hand"] as const,
    ).flat()

    await mapPool(
      insertOrder,
      async (label) => {
        const db = openDb(engine)

        await db.createIdsTable()

        insertReps[label].push(await db.insertIds(layouts[label]))

        await db.close()
      },
      1,
    )

    const arms: Record<string, EngineArm> = {}

    await mapPool(
      [
        ["planned", plannedIds, plannedStart],

        ["hand", handIds, handStart],
      ] as const,
      async ([label, ids, start]) => {
        const db = openDb(engine)

        await db.createIdsTable()

        await db.insertIds(ids)

        const expected = Array.from<number>({
          length: hotField.values.length,
        }).fill(0)

        for (const bytes of ids) {
          expected[decodeField(bytes, start, hotField.length)] += 1
        }

        await mapPool(
          hotField.values,
          async (v) => {
            const got = await db.countRanges(
              fieldRanges(v, start, hotField.length),
            )

            if (got !== expected[v]) {
              throw new Error(
                `${engine} ${label} ${hotField.name} ${v}: SQL count ${got} != decoded ${expected[v]}`,
              )
            }
          },
          1,
        )

        const us = await benchLookups(db, probeValues, start, hotField.length)

        await db.close()

        const mean =
          insertReps[label].reduce((a, b) => a + b, 0) /
          insertReps[label].length

        arms[label] = {
          insertReps: insertReps[label].map((value) => Math.round(value)),
          insertRowsPerSec: Math.round(mean),
          integrityOk: true,
          lookupUs: aggregateReps(us),
        }
      },
      1,
    )

    const ratio = arms.hand.lookupUs.mean / arms.planned.lookupUs.mean

    engines[engine] = { hand: arms.hand, planned: arms.planned, ratio }

    console.log(
      `  integrity: SQL range counts match JS bit-decodes on both layouts`,
    )

    console.log(
      `  insert planned: ${arms.planned.insertRowsPerSec} rows/s [${arms.planned.insertReps.join(",")}] hand: ${arms.hand.insertRowsPerSec} rows/s [${arms.hand.insertReps.join(",")}]`,
    )

    console.log(
      `  ${hotField.name} lookup planned: ${arms.planned.lookupUs.mean.toFixed(2)} us (CI ${arms.planned.lookupUs.ci95[0].toFixed(2)}-${arms.planned.lookupUs.ci95[1].toFixed(2)})`,
    )

    console.log(
      `  ${hotField.name} lookup hand:    ${arms.hand.lookupUs.mean.toFixed(2)} us (CI ${arms.hand.lookupUs.ci95[0].toFixed(2)}-${arms.hand.lookupUs.ci95[1].toFixed(2)})`,
    )
  },
  1,
)

const bunVersion = process.versions.bun

let runtime = `Node ${process.version}`

if (typeof bunVersion === "string") {
  runtime = `Bun ${bunVersion}`
}

const sqliteEngine = engines.sqlite

let lookupUs: {
  hand: EngineArm["lookupUs"]
  planned: EngineArm["lookupUs"]
  ratio: number
} | undefined = undefinedValue

if (sqliteEngine) {
  lookupUs = {
    hand: sqliteEngine.hand.lookupUs,
    planned: sqliteEngine.planned.lookupUs,
    ratio: sqliteEngine.ratio,
  }
}

const report = {
  description:
    "Trace (seeded, archived params) -> inferWorkload weights/roles -> planBitAllocation Smith order -> hot-field lookup latency, planned vs hand order, per engine",

  engines,

  environment: {
    generatedAt: new Date().toISOString(),

    os: `${os.platform()} ${os.release()} ${os.arch()}`,

    postgres: "PGlite (embedded PostgreSQL)",

    runtime,
  },

  experiment: "workload-planning",

  handOrder: ["region", "tenant"],

  hotQuery: hotField.name,

  inferred: {
    cardinalities: inferred.cardinalities,
    roles: inferred.profile.fields,
    weights: inferred.weights,
  },

  // Legacy top-level shape (SQLite) preserved for existing citations.

  lookupUs,

  plan: { randomBits: plan.randomBits, smithOrder },

  trace: {
    events: trace.length,
    mix: `tenant-point ${mixParts[0]} / region-range ${mixParts[1]} / write ${mixParts[2]}`,
    seed: SEED,
  },
}

mkdirSync(path.dirname(path.resolve(root, OUT)), { recursive: true })

writeFileSync(
  path.resolve(root, OUT),
  `${JSON.stringify(report, nullValue, 2)}\n`,
)

console.log(`\nwrote ${OUT}`)
