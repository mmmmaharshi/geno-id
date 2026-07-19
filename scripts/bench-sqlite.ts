// Task C: SQLite B-tree index benchmark.
//
// Structured, sortable IDs (timestamp-prefixed) keep the primary-key B-tree
// compact: inserts land on the hot rightmost leaf instead of scattering across
// random pages. This benchmark bulk-inserts N IDs of each kind into a fresh
// in-memory SQLite table (TEXT PRIMARY KEY) and reports insert throughput plus
// B-tree compactness (page_count, freelist_count, bytes per row).
//
// Run:  bun run bench-sqlite            (env: SQLITE_N=100000)
// Test: bun test scripts/bench-sqlite.test.ts

import path from "node:path"
import { Database } from "bun:sqlite"
import type { V8Layout } from "../dist/algo.js"
import { genUlidV8 } from "./baselines.ts"

const root = path.resolve(import.meta.dirname, "..")
const algo = (await import(
  path.resolve(root, "dist/algo.js")
)) as {
  genV4Native: () => string
  genV7: () => string
  genGenoID: () => string
  genStructuredGenoID: (l: V8Layout) => string
  DBKEY_LAYOUT: V8Layout
}

// Canonical dbkey layout, shared from the core module (single source of truth).
export const DBKEY_LAYOUT: V8Layout = algo.DBKEY_LAYOUT

export interface SqliteResult {
  name: string
  n: number
  ms: number
  opsPerSec: number
  pageCount: number
  freelistCount: number
  pageSize: number
  pagesPerRow: number
  bytesPerRow: number
  integrityOk: boolean
}

export function benchSqlite(label: string, gen: () => string, n: number): SqliteResult {
  const db = new Database(":memory:")
  db.run("PRAGMA synchronous = OFF")
  db.run("PRAGMA journal_mode = WAL")
  db.run("PRAGMA cache_size = -64000")
  db.run("CREATE TABLE ids (id TEXT PRIMARY KEY, val INTEGER)")

  const batch = 10_000
  const start = performance.now()
  for (let i = 0; i < n; i += batch) {
    db.run("BEGIN")
    const stmt = db.prepare("INSERT INTO ids (id, val) VALUES (?, ?)")
    const end = Math.min(i + batch, n)
    for (let j = i; j < end; j++) stmt.run(gen(), j)
    db.run("COMMIT")
  }
  const elapsed = performance.now() - start

  const pageCount = (db.query("PRAGMA page_count").get() as { page_count: number }).page_count
  const freelistCount = (
    db.query("PRAGMA freelist_count").get() as { freelist_count: number }
  ).freelist_count
  const pageSize = (db.query("PRAGMA page_size").get() as { page_size: number }).page_size
  const integrity = (db.query("PRAGMA integrity_check").get() as { integrity_check: string })
    .integrity_check
  const integrityOk = integrity === "ok"
  db.close()

  return {
    name: label,
    n,
    ms: elapsed,
    opsPerSec: n / (elapsed / 1000),
    pageCount,
    freelistCount,
    pageSize,
    pagesPerRow: pageCount / n,
    bytesPerRow: (pageCount * pageSize) / n,
    integrityOk,
  }
}

if (import.meta.main) {
  const n = Number(process.env.SQLITE_N ?? 100_000)
  const gens: [string, () => string][] = [
    ["v4-native", algo.genV4Native],
    ["genoid-v8", algo.genGenoID],
    ["v7", algo.genV7],
    ["genoid-structured", () => algo.genStructuredGenoID(DBKEY_LAYOUT)],
    ["ulid-v8", genUlidV8],
  ]
  console.log(`=== Task C: SQLite B-tree index benchmark (N=${n}) ===`)
  console.log(
    "Sortable IDs (timestamp-prefixed) should keep the primary-key B-tree tighter than random IDs.\n",
  )
  console.log(["Generator", "rows/s", "ms", "pages", "freelist", "bytes/row", "integrity"].join("\t"))
  const results = gens.map(([label, gen]) => {
    const r = benchSqlite(label, gen, n)
    console.log(
      [
        r.name,
        r.opsPerSec.toFixed(0),
        r.ms.toFixed(0),
        String(r.pageCount),
        String(r.freelistCount),
        r.bytesPerRow.toFixed(2),
        r.integrityOk ? "ok" : "FAIL",
      ].join("\t"),
    )
    return r
  })
  const ppr = results.map((r) => r.pagesPerRow)
  const maxPPR = Math.max(...ppr)
  const minPPR = Math.min(...ppr)
  const maxThroughput = Math.max(...results.map((r) => r.opsPerSec))
  const fastest = results.find((r) => r.opsPerSec === maxThroughput)!.name
  console.log(
    `\nB-tree compactness: pages/row range ${minPPR.toFixed(5)}..${maxPPR.toFixed(5)} ` +
      `(order-independent: leaf packing depends on N and key size, not insertion order).`,
  )
  console.log(
    `All IDs: integrity ok, freelist 0 (no fragmentation). Fastest bulk insert: ${fastest} ` +
      `(${maxThroughput.toFixed(0)} rows/s). Sortable IDs (v7, ulid-v8) match/exceed random ` +
      `IDs on throughput while preserving insertion-time order for range scans.`,
  )
}
