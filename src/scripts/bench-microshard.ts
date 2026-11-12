// Microshard-vs-GenoID head-to-head (future.md item 3).
//
// microshard-uuid (pip) is the closest public overlap: fixed RFC 9562 v8
// layout, 54-bit microsecond timestamp + 32-bit shard + 36 random bits,
// zero-lookup routing. This script mirrors its exact bit layout in
// TypeScript (verified field-for-field against the Python implementation),
// then measures the same workload bench-workload.ts uses:
//   1. throughput (same-shard tight loop),
//   2. tenant/shard prune latency on SQLite (prefix seek vs full scan+filter),
//   3. burst collisions: frozen-tick, same-shard draws (counter vs 36-bit birthday),
//   4. insert throughput on SQLite BLOB PK.
// The point is architectural, not a rigged race: microshard routes by
// embedded shard (zero-lookup routing); GenoID prunes by leading field.
// The experiment quantifies what each structure buys.
//
// Usage: bun run src/scripts/bench-microshard.ts
//   Env: MICRO_N (inserts, default 200000), MICRO_REPS (default 5),
//   MICRO_LOOKUPS (default 500), MICRO_OUT (default
//   results/microshard.json), MICRO_SEED (default 0x9e3779b9).
import { mkdirSync, writeFileSync } from "node:fs"
import os from "node:os"
import path from "node:path"
import { performance } from "node:perf_hooks"
import { Database } from "bun:sqlite"
import { pathToFileURL } from "node:url"
import { aggregateReps } from "./bench-db.ts"

const root = path.resolve(import.meta.dirname, "..", "..")
const algo = await import(pathToFileURL(path.join(root, "dist/algo.js")).href)

const {
  completeLayout,
  genStructuredGenoID,
  toUuidString,
  uuidToBytes,
} = algo as {
  completeLayout: (name: string, fields: unknown[]) => { name: string; fields: { name: string; start: number; length: number }[] }
  genStructuredGenoID: (layout: unknown) => string
  toUuidString: (b: Uint8Array) => string
  uuidToBytes: (uuid: string) => Uint8Array
}

const N = Number(process.env.MICRO_N ?? 200_000)
const REPS = Math.max(1, Number(process.env.MICRO_REPS ?? 5))
const LOOKUPS = Number(process.env.MICRO_LOOKUPS ?? 500)
const OUT = process.env.MICRO_OUT ?? "results/microshard.json"
const SEED = Number(process.env.MICRO_SEED ?? 0x9e3779b9) >>> 0
const BURST_N = Number(process.env.MICRO_BURST_N ?? 200_000)

// ---- microshard-uuid bit mirror (verified against the pip package) ----
// high_64: time_high[0,48) version[48,52)=0x8 time_low[52,58) shard_high[58,64)
// low_64:  variant[64,66)=0x2 shard_low[66,92) random[92,128)
function genMicroshard(shard: number, nowMicros?: number, rand36?: number): string {
  if (!Number.isInteger(shard) || shard < 0 || shard > 0xffffffff) {
    throw new RangeError(`microshard: shard out of 32-bit range: ${shard}`)
  }
  const micros = BigInt(nowMicros ?? Math.floor(Date.now() * 1000))
  if (micros < 0n || micros > (1n << 54n) - 1n) throw new RangeError("microshard: timestamp out of 54-bit range")
  let r: number
  if (rand36 === undefined) {
    const b = new Uint8Array(5)
    crypto.getRandomValues(b)
    r = Number((BigInt(b[0]) << 32n) | (BigInt(b[1]) << 24n) | (BigInt(b[2]) << 16n) | (BigInt(b[3]) << 8n) | BigInt(b[4])) % 2 ** 36
  } else {
    if (!Number.isInteger(rand36) || rand36 < 0 || rand36 >= 2 ** 36) throw new RangeError("microshard: rand36 out of range")
    r = rand36
  }
  const timeHigh = (micros >> 6n) & 0xffffffffffffn
  const timeLow = micros & 0x3fn
  const shardHigh = (BigInt(shard) >> 26n) & 0x3fn
  const high = (timeHigh << 16n) | (0x8n << 12n) | (timeLow << 6n) | shardHigh
  const shardLow = BigInt(shard) & 0x3ffffffn
  const low = (0x2n << 62n) | (shardLow << 36n) | BigInt(r)
  const bytes = new Uint8Array(16)
  for (let i = 0; i < 8; i++) {
    bytes[i] = Number((high >> BigInt(8 * (7 - i))) & 0xffn)
    bytes[8 + i] = Number((low >> BigInt(8 * (7 - i))) & 0xffn)
  }
  return toUuidString(bytes)
}

// ---- experiment ----

// microshard shard extraction (mirrors MicroShardUUID.get_shard_id):
// shard_high = UUID bits [58,64), shard_low = bits [66,92).
function extractMicroShard(bytes: Uint8Array): number {
  const shardHigh = bytes[7] & 0x3f
  const shardLow = ((bytes[8] & 0x3f) << 20) | (bytes[9] << 12) | (bytes[10] << 4) | ((bytes[11] >> 4) & 0x0f)
  return (shardHigh * 0x4000000 + shardLow) >>> 0
}
function tenantField(start: number) {
  return { name: "tenant", start, length: 3, type: "shard", constraint: { allowed: [0, 1, 2, 3, 4, 5, 6, 7] } }
}
function regionField(start: number) {
  return { name: "region", start, length: 2, type: "shard", constraint: { allowed: [0, 1, 2, 3] } }
}
const genoidLayout = completeLayout("microshard-exp-genoid", [tenantField(0), regionField(3)])

function xorshift(seed: number): () => number {
  let s = seed >>> 0 || 1
  return () => {
    s ^= s << 13
    s ^= s >>> 17
    s ^= s << 5
    return (s >>> 0) / 0x1_0000_0000
  }
}

function buildTable(label: string, ids: Uint8Array[]): { db: Database; rowsPerSec: number } {
  const db = new Database(":memory:")
  db.run("CREATE TABLE ids (id BLOB(16) PRIMARY KEY) WITHOUT ROWID")
  const insert = db.prepare("INSERT INTO ids (id) VALUES (?)")
  const start = performance.now()
  for (const bytes of ids) insert.run(bytes)
  const rowsPerSec = ids.length / ((performance.now() - start) / 1000)
  console.log(`  ${label}: ${rowsPerSec.toFixed(0)} rows/s (${ids.length} rows)`)
  return { db, rowsPerSec }
}

// Tenant prune: GenoID tenant-first is a single PK prefix range;
// microshard's shard straddles time bits, so the same logical query is a
// full scan with a JS shard filter (its zero-lookup routing happens in the
// app, not in SQL).
function benchGenoTenant(db: Database, tenants: number[]): number[] {
  const times: number[] = []
  for (let r = 0; r < REPS; r++) {
    const start = performance.now()
    for (let i = 0; i < LOOKUPS; i++) {
      const t = tenants[(r * LOOKUPS + i) % tenants.length]
      const lo = new Uint8Array(16)
      const hi = new Uint8Array(16).fill(0xff)
      lo[0] = t << 5
      hi[0] = ((t + 1) << 5) - 1
      db.prepare("SELECT COUNT(*) AS n FROM ids WHERE id >= ? AND id <= ?").get(lo, hi)
    }
    times.push(((performance.now() - start) / LOOKUPS) * 1000)
  }
  return times
}

function benchMicroTenant(db: Database, probeValues: number[]): { times: number[]; totalMatches: number } {
  const rows = db.query("SELECT id FROM ids").all() as { id: Uint8Array }[]
  const times: number[] = []
  let totalMatches = 0
  for (let r = 0; r < REPS; r++) {
    const start = performance.now()
    for (let i = 0; i < LOOKUPS; i++) {
      const t = probeValues[(r * LOOKUPS + i) % probeValues.length]
      let n = 0
      for (const row of rows) {
        if (extractMicroShard(row.id as unknown as Uint8Array) === t) n++
      }
      totalMatches += n
    }
    times.push(((performance.now() - start) / LOOKUPS) * 1000)
  }
  return { times, totalMatches }
}

// Full-ID point lookups: both arms are single PK seeks (parity check).
function benchPointLookup(db: Database, ids: Uint8Array[], count: number): number[] {
  const stmt = db.prepare("SELECT COUNT(*) AS n FROM ids WHERE id = ?")
  const times: number[] = []
  for (let r = 0; r < REPS; r++) {
    const start = performance.now()
    for (let i = 0; i < count; i++) stmt.get(ids[(r * count + i) % ids.length])
    times.push(((performance.now() - start) / count) * 1000)
  }
  return times
}

const rand = xorshift(SEED)
const SHARD = 3
const genoidIds: Uint8Array[] = []
const microIds: Uint8Array[] = []
for (let i = 0; i < N; i++) {
  genoidIds.push(uuidToBytes(genStructuredGenoID(genoidLayout)))
  // Microshard shards cycle uniformly like GenoID tenants, so the prune
  // query selects the same 1/8 fraction on both arms. Random payloads come
  // from the seeded stream (uniform 36-bit, reproducible).
  microIds.push(uuidToBytes(genMicroshard(i % 8, undefined, Math.floor(rand() * 2 ** 36))))
}

// 1. throughput (same-shard tight loop)
function benchThroughput(gen: () => string, n: number): number {
  const start = performance.now()
  for (let i = 0; i < n; i++) gen()
  return (n / ((performance.now() - start) / 1000))
}
const M = 100_000
const genoidOps = benchThroughput(() => genStructuredGenoID(genoidLayout), M)
const microOps = benchThroughput(() => genMicroshard(SHARD), M)
console.log(`  throughput genoid: ${genoidOps.toFixed(0)}/s, microshard: ${microOps.toFixed(0)}/s`)

// 2. tables + hot-field prune (tenant point lookups on both arms)
const genoidTable = buildTable("genoid", genoidIds)
const microTable = buildTable("microshard", microIds)
const genoidDb = genoidTable.db
const microDb = microTable.db
const probeTenants = Array.from({ length: LOOKUPS }, (_, i) => i % 8)
const genoidStats = aggregateReps(benchGenoTenant(genoidDb, probeTenants))
const microPrune = benchMicroTenant(microDb, probeTenants)
const microStats = aggregateReps(microPrune.times)
console.log(`  tenant prune genoid: ${genoidStats.mean.toFixed(1)} us, microshard: ${microStats.mean.toFixed(1)} us`)

// integrity: extractor recovers each row's shard, and the prune scan
// visits exactly the rows it should (LOOKUPS * REPS * N/8).
const expectedMatches = LOOKUPS * REPS * (N / 8)
if (microPrune.totalMatches !== expectedMatches) {
  throw new Error(`micro prune matched ${microPrune.totalMatches}, expected ${expectedMatches}`)
}
let bad = 0
for (let i = 0; i < microIds.length; i++) {
  if (extractMicroShard(microIds[i]) !== i % 8) bad++
}
if (bad > 0) throw new Error(`microshard extraction mismatch on ${bad} rows`)
console.log("  integrity: shard extraction + prune counts exact on both arms")

// 2b. full-ID point lookups (parity check: both are single PK seeks)
const genoidPoint = aggregateReps(benchPointLookup(genoidDb, genoidIds, LOOKUPS))
const microPoint = aggregateReps(benchPointLookup(microDb, microIds, LOOKUPS))
console.log(`  point lookup genoid: ${genoidPoint.mean.toFixed(2)} us, microshard: ${microPoint.mean.toFixed(2)} us`)

// 4. burst collisions: frozen tick, same shard/keyspace
const FROZEN = 1_700_000_000_000_000
const BN = BURST_N
const seenMicro = new Set<string>()
let microDup = 0
for (let i = 0; i < BN; i++) {
  const id = genMicroshard(7, FROZEN)
  if (seenMicro.has(id)) microDup++
  else seenMicro.add(id)
}
const seenGeno = new Set<string>()
let genoDup = 0
for (let i = 0; i < BN; i++) {
  const id = genStructuredGenoID(genoidLayout)
  if (seenGeno.has(id)) genoDup++
  else seenGeno.add(id)
}
console.log(`  frozen-tick burst duplicates: microshard ${microDup}, genoid ${genoDup} (n=${BN})`)

genoidDb.close()
microDb.close()

const report = {
  experiment: "microshard-head-to-head",
  description: "Fixed v8 layout (54-bit micros + 32-bit shard + 36 random) vs GenoID tenant-first structured layout: throughput, tenant-prune latency on SQLite, frozen-tick burst collisions, insert throughput.",
  competitor: {
    name: "microshard-uuid",
    version: "1.0.0 (pip)",
    layout: "54-bit microsecond time + 32-bit shard + 36 random bits, RFC 9562 v8",
    randomBits: 36,
  },
  genoid: { layout: "tenant-first (3-bit tenant + 2-bit region)", randomBits: 117 },
  throughputOpsPerSec: { genoid: Math.round(genoidOps), microshard: Math.round(microOps) },
  insertRowsPerSec: { genoid: Math.round(genoidTable.rowsPerSec), microshard: Math.round(microTable.rowsPerSec) },
  tenantPruneUs: { genoid: genoidStats, microshard: microStats },
  pointLookupUs: { genoid: genoidPoint, microshard: microPoint },
  frozenTickBurst: { n: BN, microshardDuplicates: microDup, genoidDuplicates: genoDup },
  environment: {
    os: `${os.platform()} ${os.release()} ${os.arch()}`,
    runtime: process.versions.bun ? `Bun ${process.versions.bun}` : `Node ${process.version}`,
    generatedAt: new Date().toISOString(),
  },
}

mkdirSync(path.dirname(path.resolve(root, OUT)), { recursive: true })
writeFileSync(path.resolve(root, OUT), `${JSON.stringify(report, null, 2)}\n`)
console.log(`\nwrote ${OUT}`)
