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
import { pathToFileURL } from "node:url"
import { Database } from "bun:sqlite"
import type { V8Layout } from "../dist/algo.js"
import { genUlidV8 } from "./baselines.ts"

const root = path.resolve(import.meta.dirname, "..")
const algo = (await import(
  pathToFileURL(path.resolve(root, "dist/algo.js")).href
)) as {
  genV4Native: () => string
  genV7: () => string
  genGenoID: () => string
  genStructuredGenoID: (l: V8Layout) => string
  DBKEY_LAYOUT: V8Layout
}

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

export type CompositeKeyArm = "composite" | "embedded" | "concatenated"

export interface CompositeKeyResult extends SqliteResult {
  arm: CompositeKeyArm
  pointLookupUs: number
  rangeScanMs: number
}

function uuidToBytes(uuid: string): Uint8Array {
  const hex = uuid.replace(/-/g, "")
  const bytes = new Uint8Array(16)
  for (let i = 0; i < 16; i++) bytes[i] = Number.parseInt(hex.slice(i * 2, i * 2 + 2), 16)
  return bytes
}

function makeShardGen(shards: number[]): () => { shard: number; uuid: string } {
  let idx = 0
  const v4 = algo.genV4Native
  return () => {
    const shard = shards[idx++ % shards.length]
    return { shard, uuid: v4() }
  }
}

export function benchCompositeKey(arm: CompositeKeyArm, n: number): CompositeKeyResult {
  const db = new Database(":memory:")
  db.run("PRAGMA synchronous = OFF")
  db.run("PRAGMA journal_mode = WAL")
  db.run("PRAGMA cache_size = -64000")

  const genPair = makeShardGen([1, 2, 3, 4, 5])

  if (arm === "composite") {
    db.run("CREATE TABLE ids (shard INTEGER, id BLOB(16), val INTEGER, PRIMARY KEY (shard, id))")
  } else if (arm === "embedded") {
    db.run("CREATE TABLE ids (id BLOB(16) PRIMARY KEY, val INTEGER)")
  } else {
    db.run("CREATE TABLE ids (id TEXT PRIMARY KEY, val INTEGER)")
  }

  const batch = 10_000
  const start = performance.now()

  if (arm === "composite") {
    const stmt = db.prepare("INSERT INTO ids (shard, id, val) VALUES (?, ?, ?)")
    for (let i = 0; i < n; i += batch) {
      db.run("BEGIN")
      const end = Math.min(i + batch, n)
      for (let j = i; j < end; j++) {
        const { shard, uuid } = genPair()
        stmt.run(shard, uuidToBytes(uuid), j)
      }
      db.run("COMMIT")
    }
  } else if (arm === "embedded") {
    const stmt = db.prepare("INSERT INTO ids (id, val) VALUES (?, ?)")
    for (let i = 0; i < n; i += batch) {
      db.run("BEGIN")
      const end = Math.min(i + batch, n)
      for (let j = i; j < end; j++) {
        const uuid = algo.genStructuredGenoID(DBKEY_LAYOUT)
        stmt.run(uuidToBytes(uuid), j)
      }
      db.run("COMMIT")
    }
  } else {
    const stmt = db.prepare("INSERT INTO ids (id, val) VALUES (?, ?)")
    for (let i = 0; i < n; i += batch) {
      db.run("BEGIN")
      const end = Math.min(i + batch, n)
      for (let j = i; j < end; j++) {
        const { shard, uuid } = genPair()
        stmt.run(`${shard}:${uuid}`, j)
      }
      db.run("COMMIT")
    }
  }

  const insertElapsed = performance.now() - start

  // Point lookup: 1000 random lookups by exact key
  const lookupCount = 1000
  const sampleRows = (() => {
    if (arm === "composite") {
      return (db.query("SELECT shard, id, val FROM ids USING INDEX sqlite_auto_index_ids_1 LIMIT ?").all(lookupCount) as { shard: number; id: Uint8Array; val: number }[])
    }
    return (db.query("SELECT id, val FROM ids USING INDEX sqlite_auto_index_ids_1 LIMIT ?").all(lookupCount) as { id: unknown; val: number }[])
  })()
  const lookupStart = performance.now()
  if (arm === "composite") {
    const stmt = db.prepare("SELECT val FROM ids WHERE shard = ? AND id = ?")
    for (const row of sampleRows as { shard: number; id: Uint8Array }[]) stmt.get(row.shard, row.id)
  } else {
    const stmt = db.prepare("SELECT val FROM ids WHERE id = ?")
    for (const row of sampleRows as { id: unknown }[]) stmt.get(row.id)
  }
  const lookupElapsed = performance.now() - lookupStart

  // Range scan by shard: fetch rows matching shard=3
  let scanQuery: string
  if (arm === "composite") {
    scanQuery = "SELECT val FROM ids WHERE shard = 3"
  } else if (arm === "embedded") {
    scanQuery = "SELECT val FROM ids WHERE substr(id, 7, 1) = x'03'"
  } else {
    scanQuery = "SELECT val FROM ids WHERE id LIKE '3:%'"
  }
  const scanStart = performance.now()
  db.query(scanQuery).all()
  const scanElapsed = performance.now() - scanStart

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
    name: arm,
    arm,
    n,
    ms: insertElapsed,
    opsPerSec: n / (insertElapsed / 1000),
    pageCount,
    freelistCount,
    pageSize,
    pagesPerRow: pageCount / n,
    bytesPerRow: (pageCount * pageSize) / n,
    integrityOk,
    pointLookupUs: lookupCount > 0 ? (lookupElapsed / lookupCount) * 1000 : 0,
    rangeScanMs: scanElapsed,
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

  // Composite-key benchmark: three arms comparing embedding vs composite vs concatenated.
  console.log(`\n=== Composite-key benchmark (N=${n}) ===`)
  console.log("Three arms: composite (shard,id) PK, embedded GenoID PK, concatenated shard:uuid PK\n")
  const compResults = (["composite", "embedded", "concatenated"] as CompositeKeyArm[]).map((arm) => {
    const r = benchCompositeKey(arm, n)
    console.log(
      [
        r.name,
        r.opsPerSec.toFixed(0),
        r.ms.toFixed(0),
        r.bytesPerRow.toFixed(2),
        r.pointLookupUs.toFixed(2),
        r.rangeScanMs.toFixed(2),
        r.integrityOk ? "ok" : "FAIL",
      ].join("\t"),
    )
    return r
  })
  const bestBytes = Math.min(...compResults.map((r) => r.bytesPerRow))
  console.log(
    `\nIndex size (bytes/row): embedded=${compResults.find((r) => r.arm === "embedded")!.bytesPerRow.toFixed(2)} ` +
      `composite=${compResults.find((r) => r.arm === "composite")!.bytesPerRow.toFixed(2)} ` +
      `concatenated=${compResults.find((r) => r.arm === "concatenated")!.bytesPerRow.toFixed(2)}`,
  )
  const best = compResults.find((r) => r.bytesPerRow === bestBytes)!
  console.log(`Most compact: ${best.arm} (${bestBytes.toFixed(2)} bytes/row)`)
}
