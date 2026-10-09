import { mkdirSync, writeFileSync } from "node:fs"
import { execFileSync } from "node:child_process"
import os from "node:os"
import path from "node:path"
import { Database } from "bun:sqlite"
import { benchCompositeKeyRepeated } from "./bench-sqlite.ts"
import type { CompositeKeyArm, CompositeKeySummary } from "./bench-sqlite.ts"

// Archives the SQLite composite-key experiment that backs Table tab:composite.
// The benchmark itself lives in bench-sqlite.ts; this wrapper adds the
// environment, provenance, and plan evidence the manuscript table needs so
// every printed number traces to a committed artifact.

const root = path.resolve(import.meta.dirname, "..")
const N = Number(process.env.SQLITE_N ?? 100_000)
const TRIALS = Math.max(5, Number(process.env.SQLITE_TRIALS ?? 10))
const LOOKUPS = Number(process.env.SQLITE_LOOKUPS ?? 100)
const OUT = process.env.SQLITE_OUT ?? "results/db-sqlite-composite.json"

const ARMS: CompositeKeyArm[] = ["composite", "composite-indexed", "embedded", "embedded56", "concatenated"]

// Query-plan evidence for the boundary-crossing lookup: an unindexed
// composite key cannot seek by identifier alone, which is why the
// secondary-index arm is the fair comparison.
function queryPlans(): Record<string, unknown> {
  const db = new Database(":memory:")
  db.run("CREATE TABLE ids (shard INTEGER, id BLOB(16), val INTEGER, PRIMARY KEY (shard, id)) WITHOUT ROWID")
  const bare = db.query("EXPLAIN QUERY PLAN SELECT val FROM ids WHERE id = ?").all({})
  db.run("CREATE INDEX idx_id ON ids(id)")
  const indexed = db.query("EXPLAIN QUERY PLAN SELECT val FROM ids WHERE id = ?").all({})
  db.close()
  return {
    composite_bare_id_lookup: bare,
    composite_indexed_bare_id_lookup: indexed,
  }
}

function runtimeVersion(): string {
  const bun = (globalThis as { Bun?: { version: string } }).Bun
  return bun ? `Bun ${bun.version}` : `Node ${process.version}`
}

function gitSha(): string {
  try {
    return execFileSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf-8" }).trim()
  } catch {
    return "unknown"
  }
}

const summaries: Record<string, CompositeKeySummary> = {}
const started = performance.now()
for (const arm of ARMS) {
  console.log(`\n=== ${arm} (N=${N}, ${TRIALS} trials) ===`)
  summaries[arm] = await benchCompositeKeyRepeated(arm, N, TRIALS, LOOKUPS)
}
const elapsedMs = performance.now() - started

const embedded = summaries.embedded
const embedded56 = summaries.embedded56
const composite = summaries.composite
const compositeIndexed = summaries["composite-indexed"]
const concatenated = summaries.concatenated

const report = {
  experiment: "db-sqlite-composite",
  description:
    "Five-arm SQLite composite-key comparison under WITHOUT ROWID clustered storage; the only variable is where the shard field resides",
  engine: "sqlite",
  rows: N,
  trials: TRIALS,
  lookupsPerTrial: LOOKUPS,
  arms: Object.fromEntries(
    Object.entries(summaries).map(([arm, s]) => [
      arm,
      {
        insertRowsPerSec: s.insert,
        pointLookupUs: s.lookupUs,
        shardRangeScanMs: s.rangeScanMs,
        bytesPerRow: s.bytesPerRow,
        integrityOk: s.results.every((r) => r.integrityOk),
        freelistCountMax: Math.max(...s.results.map((r) => r.freelistCount)),
        perTrial: s.results.map((r) => ({
          insertRowsPerSec: r.opsPerSec,
          pointLookupUs: r.pointLookupUs,
          shardRangeScanMs: r.rangeScanMs,
          bytesPerRow: r.bytesPerRow,
          pageCount: r.pageCount,
          pageSize: r.pageSize,
        })),
      },
    ]),
  ),
  queryPlans: queryPlans(),
  derived: {
    secondary_index_storage_ratio: compositeIndexed.bytesPerRow / embedded.bytesPerRow,
    secondary_index_insert_ratio: compositeIndexed.insert.mean / embedded.insert.mean,
    secondary_index_lookup_ratio: compositeIndexed.lookupUs.mean / embedded.lookupUs.mean,
    concatenated_storage_ratio: concatenated.bytesPerRow / embedded.bytesPerRow,
    concatenated_insert_ratio: concatenated.insert.mean / embedded.insert.mean,
    embedded_off56_lookup_ratio: embedded56.lookupUs.mean / embedded.lookupUs.mean,
    composite_insert_ratio_vs_embedded: composite.insert.mean / embedded.insert.mean,
    composite_shard_scan_ratio_vs_embedded: composite.rangeScanMs.mean / embedded.rangeScanMs.mean,
  },
  environment: {
    os: `${os.platform()} ${os.release()} ${os.arch()}`,
    cpuModel: os.cpus()[0]?.model ?? "unknown",
    logicalCores: os.cpus().length,
    runtime: runtimeVersion(),
    commitSha: gitSha(),
    generatedAt: new Date().toISOString(),
  },
  elapsedMsTotal: Math.round(elapsedMs * 100) / 100,
}

mkdirSync(path.dirname(path.resolve(root, OUT)), { recursive: true })
writeFileSync(path.resolve(root, OUT), `${JSON.stringify(report, null, 2)}\n`)

console.log("\n=== Composite-key summary (mean of trials) ===")
console.log(["arm", "insert rows/s", "CI95", "bytes/row", "lookup us", "CI95", "range ms"].join("\t"))
for (const arm of ARMS) {
  const s = summaries[arm]
  console.log(
    [
      arm,
      Math.round(s.insert.mean).toString(),
      `${Math.round(s.insert.ci95[0])}-${Math.round(s.insert.ci95[1])}`,
      s.bytesPerRow.toFixed(2),
      s.lookupUs.mean.toFixed(2),
      `${s.lookupUs.ci95[0].toFixed(2)}-${s.lookupUs.ci95[1].toFixed(2)}`,
      s.rangeScanMs.mean.toFixed(2),
    ].join("\t"),
  )
}
console.log(`\nwrote ${OUT} (${(report.elapsedMsTotal / 1000).toFixed(1)}s)`)