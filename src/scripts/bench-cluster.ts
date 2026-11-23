import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import os from "node:os"
import path from "node:path"
import { pathToFileURL } from "node:url"
import { Database } from "bun:sqlite"
import type { V8Field, V8Layout } from "../../dist/algo.js"
import { gitSha, runtimeVersion } from "./shared/cli-utils.ts"

// Small local multi-shard experiment. Shards are in-process SQLite files on one
// host, not a distributed service. It measures (a) a shard-major scan against
// the frozen single-index result at the same row count and (b) the cost of a
// reshard plus a versioned dual-read window using readStructured over
// dbkey.v1 and dbkey.v2. No algorithm source is changed by this script.

const root = path.resolve(import.meta.dirname, "..", "..")
const algo = (await import(pathToFileURL(path.resolve(root, "dist/algo.js")).href)) as {
  completeLayout: (name: string, fields: V8Field[]) => V8Layout
  genStructuredGenoID: (layout: V8Layout) => string
  composeStructured: (
    layout: V8Layout,
    a: Uint8Array,
    b: Uint8Array,
    select: number,
  ) => Uint8Array
  readStructured: (uuid: string, layout: V8Layout) => Record<string, number>
  uuidToBytes: (uuid: string) => Uint8Array
  toUuidString: (bytes: Uint8Array) => string
}

const ROWS = Number(process.env.CLUSTER_ROWS ?? 100_000)
const TRIALS = Math.max(1, Number(process.env.CLUSTER_TRIALS ?? 5))
const PROBES = Math.max(1, Number(process.env.CLUSTER_PROBES ?? 200))
const MIGRATE_ROWS = Math.max(
  1,
  Number(process.env.CLUSTER_MIGRATE ?? Math.floor(ROWS / 5)),
)
const OUT = process.env.CLUSTER_OUT ?? "results/cluster-experiment.json"
const REFERENCE_PATH = "results/db-sqlite-composite.json"

const V1_SHARDS = [1, 2, 3, 4, 5]
const V2_SHARDS = [1, 2, 3, 4, 5, 6, 7, 8]
const MIGRATION_TARGETS = [6, 7, 8]

function round2(n: number): number {
  return Math.round(n * 100) / 100
}

function mean(xs: number[]): number {
  return xs.reduce((a, b) => a + b, 0) / xs.length
}

function versionedLayout(name: string, generation: number, allowed: number[]): V8Layout {
  return algo.completeLayout(name, [
    { length: 48, name: "timestamp", start: 0, type: "timestamp-ms" },
    { constraint: { allowed }, length: 8, name: "shard", start: 52, type: "shard" },
    { length: 4, name: "gen", start: 60, type: "fixed", value: generation },
    { constraint: { monotonic: true }, length: 16, name: "counter", start: 66, type: "counter" },
  ])
}

const v1 = versionedLayout("dbkey.v1", 1, V1_SHARDS)
const v2 = versionedLayout("dbkey.v2", 2, V2_SHARDS)
const v1Allowed = new Set(V1_SHARDS)
const v2Allowed = new Set(V2_SHARDS)

const selectFromV1 = (() => {
  let mask = 0
  for (const name of ["timestamp", "counter"]) {
    mask |= 1 << v2.fields.findIndex((f) => f.name === name)
  }
  return mask
})()

const straddledShard = (bytes: Uint8Array): number => ((bytes[6] & 0x0f) << 4) | (bytes[7] >> 4)

const reference = JSON.parse(
  readFileSync(path.resolve(root, REFERENCE_PATH), "utf-8"),
) as {
  rows: number
  arms: Record<string, { shardRangeScanMs: { mean: number } }>
}
if (reference.rows !== ROWS) {
  throw new Error(`cluster: reference rows ${reference.rows} != CLUSTER_ROWS ${ROWS}`)
}
const referenceRawMs = reference.arms.embedded.shardRangeScanMs.mean

const tmpDir = process.env.CLUSTER_TMP
  ? path.resolve(process.env.CLUSTER_TMP)
  : path.join(os.tmpdir(), `genoid-cluster-${process.pid}`)
mkdirSync(tmpDir, { recursive: true })

function openShard(shard: number): Database {
  const db = new Database(path.join(tmpDir, `shard-${shard}.db`))
  db.run("PRAGMA synchronous = OFF; PRAGMA journal_mode = WAL; PRAGMA cache_size = -64000")
  db.run("CREATE TABLE ids (id BLOB(16) PRIMARY KEY, val INTEGER) WITHOUT ROWID")
  return db
}

const shards = new Map<number, Database>()
for (const shard of V2_SHARDS) {shards.set(shard, openShard(shard))}

const rows: { uuid: string; bytes: Uint8Array; shard: number; val: number }[] = []
console.log(`generating ${ROWS} v1 identifiers across ${V1_SHARDS.length} shards`)
for (let i = 0; i < ROWS; i += 1) {
  const uuid = algo.genStructuredGenoID(v1)
  const bytes = algo.uuidToBytes(uuid)
  rows.push({ bytes, shard: straddledShard(bytes), uuid, val: i })
}

const insertStart = performance.now()
for (const shard of V1_SHARDS) {
  const db = shards.get(shard)!
  const insert = db.prepare("INSERT INTO ids (id, val) VALUES (?, ?)")
  db.run("BEGIN")
  for (const row of rows) {
    if (row.shard !== shard) {continue}
    insert.run(row.bytes, row.val)
  }
  db.run("COMMIT")
}
const insertMs = performance.now() - insertStart

const scanPerTrial: number[][] = []
const sweepPerTrial: number[] = []
for (let t = 0; t < TRIALS; t += 1) {
  const times: number[] = []
  for (const shard of V1_SHARDS) {
    const db = shards.get(shard)!
    const start = performance.now()
    db.query("SELECT val FROM ids").all()
    times.push(performance.now() - start)
  }
  scanPerTrial.push(times.map(round2))
  sweepPerTrial.push(round2(times.reduce((a, b) => a + b, 0)))
}
const scanSamples = scanPerTrial.flat()
const scanMeanMs = round2(mean(scanSamples))
const sweepMeanMs = round2(mean(sweepPerTrial))

console.log(`resharding ${MIGRATE_ROWS} rows from v1 shards to v2 shards ${MIGRATION_TARGETS.join(",")}`)
const donors = new Map<number, Uint8Array>()
for (const target of MIGRATION_TARGETS) {
  for (;;) {
    const candidate = algo.uuidToBytes(algo.genStructuredGenoID(v2))
    if (straddledShard(candidate) === target) {
      donors.set(target, candidate)
      break
    }
  }
}

const migrated: { uuid: string; bytes: Uint8Array; shard: number; val: number }[] = []
const migratedFlags = new Uint8Array(ROWS)
const reshardStart = performance.now()
let done = 0
while (done < MIGRATE_ROWS) {
  const batchEnd = Math.min(done + 10_000, MIGRATE_ROWS)
  for (const shard of V2_SHARDS) {shards.get(shard)!.run("BEGIN")}
  for (let i = done; i < batchEnd; i += 1) {
    const source = rows[i]
    const target = MIGRATION_TARGETS[i % MIGRATION_TARGETS.length]
    const bytes = algo.composeStructured(v2, source.bytes, donors.get(target)!, selectFromV1)
    const uuid = algo.toUuidString(bytes)
    shards.get(target)!.prepare("INSERT INTO ids (id, val) VALUES (?, ?)").run(bytes, source.val)
    shards.get(source.shard)!.prepare("DELETE FROM ids WHERE id = ?").run(source.bytes)
    migrated.push({ bytes, shard: target, uuid, val: source.val })
    migratedFlags[i] = 1
  }
  for (const shard of V2_SHARDS) {shards.get(shard)!.run("COMMIT")}
  done = batchEnd
}
const reshardMs = performance.now() - reshardStart

let dualReadCalls = 0
let singleReadCalls = 0

function dualRead(uuid: string): { generation: number; shard: number } {
  dualReadCalls += 1
  const v1Fields = algo.readStructured(uuid, v1)
  if (v1Fields.gen === 1 && v1Allowed.has(v1Fields.shard)) {
    return { generation: 1, shard: v1Fields.shard }
  }
  dualReadCalls += 1
  const v2Fields = algo.readStructured(uuid, v2)
  if (v2Fields.gen === 2 && v2Allowed.has(v2Fields.shard)) {
    return { generation: 2, shard: v2Fields.shard }
  }
  throw new Error("cluster: dual read found no versioned layout for identifier")
}

function singleRead(uuid: string, generation: number): { generation: number; shard: number } {
  singleReadCalls += 1
  const fields = algo.readStructured(uuid, generation === 1 ? v1 : v2)
  return { generation, shard: fields.shard }
}

const cohort: { uuid: string; generation: number }[] = []
for (let i = MIGRATE_ROWS, n = 0; n < PROBES; i += 1) {
  if (migratedFlags[i] === 0) {
    cohort.push({ generation: 1, uuid: rows[i].uuid })
    n += 1
  }
}
for (let i = 0; i < PROBES; i += 1) {
  cohort.push({ generation: 2, uuid: migrated[i].uuid })
}

const dualSamples: number[] = []
const singleSamples: number[] = []
let dualChecksum = 0
let singleChecksum = 0
let v1Resolved = 0
let v2Resolved = 0
for (const { uuid, generation } of cohort) {
  dualChecksum += dualRead(uuid).shard
  singleChecksum += singleRead(uuid, generation).shard
}
for (let t = 0; t < TRIALS; t += 1) {
  if (t === 0) {
    for (const { uuid, generation } of cohort) {
      const got = dualRead(uuid)
      if (got.generation !== generation) {
        throw new Error("cluster: dual read resolved the wrong generation")
      }
      if (got.shard !== algo.readStructured(uuid, v2).shard) {
        throw new Error("cluster: dual read resolved the wrong shard")
      }
      if (got.generation === 2) {v2Resolved += 1}
      else {v1Resolved += 1}
    }
  }
  let sink = 0
  const dualStart = performance.now()
  for (const { uuid } of cohort) {sink += dualRead(uuid).shard}
  dualSamples.push(((performance.now() - dualStart) * 1000) / cohort.length)
  dualChecksum += sink

  sink = 0
  const singleStart = performance.now()
  for (const { uuid, generation } of cohort) {sink += singleRead(uuid, generation).shard}
  singleSamples.push(((performance.now() - singleStart) * 1000) / cohort.length)
  singleChecksum += sink
}

const dualMeanUs = round2(mean(dualSamples))
const singleMeanUs = round2(mean(singleSamples))
const postCounts: Record<string, number> = {}
let integrityOk = true
for (const shard of V2_SHARDS) {
  const db = shards.get(shard)!
  postCounts[String(shard)] = (db.query("SELECT COUNT(*) AS n FROM ids").get() as { n: number }).n
  const integrity = (db.query("PRAGMA integrity_check").get() as { integrity_check: string })
    .integrity_check
  integrityOk &&= integrity === "ok"
  db.close()
}
if (postCounts["6"] === 0 || postCounts["7"] === 0 || postCounts["8"] === 0) {
  throw new Error("cluster: a v2 shard is empty after resharding")
}

const report = {
  deployment: {
    host: {
      commitSha: gitSha(root),
      cpuModel: os.cpus()[0]?.model ?? "unknown",
      generatedAt: new Date().toISOString(),
      logicalCores: os.cpus().length,
      os: `${os.platform()} ${os.release()} ${os.arch()}`,
      runtime: runtimeVersion(),
    },
    kind: "in-process SQLite files on one host",
    limits: [
      "Single host with in-process SQLite files; no network dispatch, replication, consensus, or cross-node clock skew",
      "Shard-major scan reads one shard file in full; the comparator is one frozen single-index shard scan at the same row count, not a hosted multi-node baseline",
      "Reshard rewrites the shard and generation fields for a bounded cohort; no online traffic, backpressure, or rollback is modelled",
      "Small local cluster; these numbers are not production-scale evidence",
    ],
    migratedRows: MIGRATE_ROWS,
    nodes: 1,
    perShardRowsBefore: Math.floor(ROWS / V1_SHARDS.length),
    probesPerGeneration: PROBES,
    readSamplesPerArm: PROBES * 2 * TRIALS,
    rows: ROWS,
    shardCountAfter: V2_SHARDS.length,
    shardCountBefore: V1_SHARDS.length,
    trials: TRIALS,
  },
  derived: {
    dual_read_overhead_ratio: round2(dualMeanUs / singleMeanUs),
    shard_major_scan_ratio_vs_single_index: round2(referenceRawMs / scanMeanMs),
    v2_resolved_fraction: round2(v2Resolved / (v1Resolved + v2Resolved)),
  },
  description:
    "Small local multi-shard experiment: in-process SQLite shard files on one host, not a distributed service and not production-scale evidence",
  experiment: "cluster-shard-scan-reshard",
  layouts: {
    migrationTargets: MIGRATION_TARGETS,
    v1: {
      allowedShards: V1_SHARDS,
      generation: 1,
      name: v1.name,
      shardField: { length: 8, start: 52 },
    },
    v2: {
      allowedShards: V2_SHARDS,
      generation: 2,
      name: v2.name,
      shardField: { length: 8, start: 52 },
    },
    versionField: { length: 4, start: 60 },
  },
  load: {
    elapsedMs: round2(insertMs),
    rowsPerSec: Math.round(ROWS / (insertMs / 1000)),
  },
  reshard: {
    dualRead: {
      checksum: dualChecksum,
      meanUs: dualMeanUs,
      readStructuredCalls: dualReadCalls,
      readsPerTrial: cohort.length,
      samplesUs: dualSamples,
      trials: dualSamples.length,
      v1Resolved,
      v2Resolved,
    },
    elapsedMs: round2(reshardMs),
    integrityOk,
    postShardRowCounts: postCounts,
    rowsMigrated: migrated.length,
    rowsPerSec: Math.round(migrated.length / (reshardMs / 1000)),
    singleRead: {
      checksum: singleChecksum,
      meanUs: singleMeanUs,
      readStructuredCalls: singleReadCalls,
      readsPerTrial: cohort.length,
      samplesUs: singleSamples,
      trials: singleSamples.length,
    },
  },
  scan: {
    ddl: "CREATE TABLE ids (id BLOB(16) PRIMARY KEY, val INTEGER) WITHOUT ROWID",
    reference: {
      arm: "embedded",
      path: REFERENCE_PATH,
      rawShardRangeScanMs: referenceRawMs,
      rows: reference.rows,
      shardRangeScanMs: round2(referenceRawMs),
    },
    shardMajor: {
      fullSweepMeanMs: sweepMeanMs,
      fullSweepPerTrialMs: sweepPerTrial,
      meanMs: scanMeanMs,
      perTrialMs: scanPerTrial,
      samples: scanSamples.length,
    },
    shardMajorQuery: "SELECT val FROM ids",
  },
}

if (!integrityOk) {throw new Error("cluster: SQLite integrity check failed")}
mkdirSync(path.dirname(path.resolve(root, OUT)), { recursive: true })
writeFileSync(path.resolve(root, OUT), `${JSON.stringify(report, null, 2)}\n`)
try {
  rmSync(tmpDir, { force: true, recursive: true })
} catch {
  console.log(`left temporary shard files at ${tmpDir}`)
}

console.log(`\n=== Local multi-shard result ===`)
console.log(`shard-major scan: ${scanMeanMs} ms vs single index ${report.scan.reference.shardRangeScanMs} ms (${report.derived.shard_major_scan_ratio_vs_single_index}x)`)
console.log(`reshard: ${report.reshard.rowsPerSec} rows/s over ${migrated.length} rows`)
console.log(`dual read: ${dualMeanUs} us vs single layout ${singleMeanUs} us (${report.derived.dual_read_overhead_ratio}x)`)
console.log(`wrote ${OUT}`)
