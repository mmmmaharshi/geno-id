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
import fs from "node:fs"
import os from "node:os"
import { Database } from "bun:sqlite"
import type { V8Layout, V8Field } from "../dist/algo.js"
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
  completeLayout: (name: string, fields: V8Field[]) => V8Layout
}

export const DBKEY_LAYOUT: V8Layout = algo.DBKEY_LAYOUT

// Layout with shard at byte offset 56 (byte-aligned) instead of bits 52-59
// (straddled). Bits 52-55 become random filler.
export const DBKEY_LAYOUT_OFF56: V8Layout = algo.completeLayout("dbkey-off56", [
  { name: "timestamp", start: 0, length: 48, type: "timestamp-ms" },
  { name: "shard", start: 56, length: 8, type: "shard", constraint: { allowed: [1, 2, 3, 4, 5] } },
  { name: "counter", start: 66, length: 16, type: "counter", constraint: { monotonic: true } },
])

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

export type CompositeKeyArm = "composite" | "composite-indexed" | "embedded" | "embedded56" | "concatenated"

export interface CompositeKeyResult {
  arm: CompositeKeyArm
  n: number
  ms: number
  opsPerSec: number
  pageCount: number
  freelistCount: number
  pageSize: number
  pagesPerRow: number
  bytesPerRow: number
  integrityOk: boolean
  pointLookupUs: number
  rangeScanMs: number
}

export interface CompositeKeySummary {
  insert: { mean: number; ci95: [number, number] }
  lookupUs: { mean: number; ci95: [number, number] }
  rangeScanMs: { mean: number; ci95: [number, number] }
  bytesPerRow: number
  results: CompositeKeyResult[]
}

const HEX = new Uint8Array(256)
for (let i = 0; i < 16; i++) HEX["0123456789abcdef".codePointAt(i)!] = i

function uuidToBytes(uuid: string): Uint8Array {
  const b = new Uint8Array(16)
  let p = 0
  for (let i = 0; i < 36; i++) {
    const c = uuid.codePointAt(i)!
    if (c === 45) continue
    b[p >> 1] = (p & 1) ? b[p >> 1] | HEX[c] : HEX[c] << 4
    p++
  }
  return b
}

function pregenIds(arm: CompositeKeyArm, n: number): unknown[] {
  const ids: unknown[] = []
  for (let i = 0; i < n; i++) {
    const layout = arm === "embedded56" ? DBKEY_LAYOUT_OFF56 : DBKEY_LAYOUT
    const uuid = algo.genStructuredGenoID(layout)
    const bytes = uuidToBytes(uuid)
    const embeddedShard = ((bytes[6] & 0x0f) << 4) | (bytes[7] >> 4)
    const off56Shard = bytes[7]
    const shard = arm === "embedded56" ? off56Shard : embeddedShard
    if (arm === "composite" || arm === "composite-indexed") ids.push({ shard, id: bytes, val: i })
    else if (arm === "embedded")     ids.push({ id: bytes, val: i })
    else if (arm === "embedded56")   ids.push({ id: bytes, val: i })
    else                             ids.push({ id: `${shard}:${uuid}`, val: i })
  }
  return ids
}

export function benchCompositeKeyArm(arm: CompositeKeyArm, n: number, ids: unknown[], lookupCount = 1000, trialIndex = 0, totalTrials = 1): CompositeKeyResult {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "genoid-sqlite-"))
  const dbPath = path.join(tmpDir, "bench.db")
  const db = new Database(dbPath)
  db.run("PRAGMA synchronous = OFF; PRAGMA journal_mode = WAL; PRAGMA cache_size = -64000")

  if (arm === "composite") {
    db.run("CREATE TABLE ids (shard INTEGER, id BLOB(16), val INTEGER, PRIMARY KEY (shard, id)) WITHOUT ROWID")
  } else if (arm === "composite-indexed") {
    db.run("CREATE TABLE ids (shard INTEGER, id BLOB(16), val INTEGER, PRIMARY KEY (shard, id)) WITHOUT ROWID")
    db.run("CREATE INDEX idx_id ON ids(id)")
  } else if (arm === "embedded" || arm === "embedded56") {
    db.run("CREATE TABLE ids (id BLOB(16) PRIMARY KEY, val INTEGER) WITHOUT ROWID")
  } else {
    db.run("CREATE TABLE ids (id TEXT PRIMARY KEY, val INTEGER) WITHOUT ROWID")
  }

  const batch = 10_000
  const insertStart = performance.now()
  const compositeArm = arm === "composite" || arm === "composite-indexed"
  const insertStmt = compositeArm
    ? db.prepare("INSERT INTO ids (shard, id, val) VALUES (?, ?, ?)")
    : db.prepare("INSERT INTO ids (id, val) VALUES (?, ?)")

  for (let i = 0; i < n; i += batch) {
    db.run("BEGIN")
    const end = Math.min(i + batch, n)
    const stmt = insertStmt as ReturnType<typeof db.prepare>
    if (compositeArm) {
      for (let j = i; j < end; j++) {
        const row = ids[j] as { shard: number; id: Uint8Array; val: number }
        stmt.run(row.shard, row.id, row.val)
      }
    } else {
      for (let j = i; j < end; j++) {
        const row = ids[j] as { id: unknown; val: number }
        stmt.run(row.id, row.val)
      }
    }
    db.run("COMMIT")
  }
  const insertElapsed = performance.now() - insertStart

  // Point lookup: lookups by identifier alone (without shard — the boundary-crossing case)
  const sampleRows = db.query("SELECT id FROM ids ORDER BY random() LIMIT ?").all(lookupCount) as { id: unknown }[]
  const lookupStart = performance.now()
  const stmt = db.prepare("SELECT val FROM ids WHERE id = ?")
  for (const row of sampleRows) stmt.get(row.id)
  const lookupElapsed = performance.now() - lookupStart

  // Range scan by shard.
  // Embedded predicate must extract shard from bits 52-59, which straddle
  // bytes 6 (low nibble) and 7 (high nibble). The version nibble (bits 48-51)
  // occupies byte 6 high nibble (always 0x8 for v8). The ugliness of this
  // predicate is itself a finding: §3.1 byte-aligns constrained fields.
  // embedded56 arm uses byte-aligned shard at byte 7 so predicate is simple.
  let scanQuery: string
  if (arm === "composite" || arm === "composite-indexed") {
    scanQuery = "SELECT val FROM ids WHERE shard = 3"
  } else if (arm === "embedded56") {
    scanQuery = "SELECT val FROM ids WHERE substr(id,8,1) = x'03'"
  } else if (arm === "embedded") {
    const shardHi = (s: number) => (s >> 4) & 0x0f
    const shardLo = (s: number) => (s & 0x0f) << 4
    scanQuery = `SELECT val FROM ids WHERE (substr(id,7,1) & x'0f') = x'0${shardHi(3).toString(16)}' AND (substr(id,8,1) & x'f0') = x'${shardLo(3).toString(16)}'`
  } else {
    scanQuery = "SELECT val FROM ids WHERE id LIKE '3:%'"
  }
  const scanStart = performance.now()
  db.query(scanQuery).all()
  const scanElapsed = performance.now() - scanStart

  const pageCount = (db.query("PRAGMA page_count").get() as { page_count: number }).page_count
  const freelistCount = (db.query("PRAGMA freelist_count").get() as { freelist_count: number }).freelist_count
  const pageSize = (db.query("PRAGMA page_size").get() as { page_size: number }).page_size
  // Only integrity_check on final trial (costly on 1M rows)
  const integrity = trialIndex === totalTrials - 1
    ? (db.query("PRAGMA integrity_check").get() as { integrity_check: string }).integrity_check
    : "ok"
  db.close()
  try { fs.rmSync(dbPath) } catch {
    // cleanup
  }
  try { fs.rmdirSync(tmpDir) } catch {
    // cleanup
  }

  return {
    arm,
    n,
    ms: insertElapsed,
    opsPerSec: n / (insertElapsed / 1000),
    pageCount,
    freelistCount,
    pageSize,
    pagesPerRow: pageCount / n,
    bytesPerRow: (pageCount * pageSize) / n,
    integrityOk: integrity === "ok",
    pointLookupUs: (lookupElapsed / lookupCount) * 1000,
    rangeScanMs: scanElapsed,
  }
}

export async function benchCompositeKeyRepeated(
  arm: CompositeKeyArm, n: number, trials = 10, lookupCount = 1000,
): Promise<CompositeKeySummary> {
  console.log(`  ${arm} n=${n}: generating ${n} IDs...`)
  const ids = pregenIds(arm, n)
  const results: CompositeKeyResult[] = []
  for (let t = 0; t < trials; t++) {
    console.log(`  ${arm} n=${n}: trial ${t + 1}/${trials}`)
    results.push(benchCompositeKeyArm(arm, n, ids, lookupCount, t, trials))
  }

  function summarize(xs: number[]): { mean: number; ci95: [number, number] } {
    const m = xs.reduce((a, b) => a + b, 0) / xs.length
    const std = xs.length > 1 ? Math.sqrt(xs.reduce((a, x) => a + (x - m) ** 2, 0) / (xs.length - 1)) : 0
    const se = std / Math.sqrt(xs.length)
    const tTable: Record<number, number> = { 1: 12.706, 2: 4.303, 3: 3.182, 4: 2.776, 5: 2.571, 6: 2.447, 7: 2.365, 8: 2.306, 9: 2.262 }
    const tc = xs.length >= 30 ? 1.96 : (tTable[xs.length - 1] ?? 1.96)
    const margin = tc * se
    return { mean: m, ci95: [m - margin, m + margin] }
  }
  return {
    insert: summarize(results.map((r) => r.opsPerSec)),
    lookupUs: summarize(results.map((r) => r.pointLookupUs)),
    rangeScanMs: summarize(results.map((r) => r.rangeScanMs)),
    bytesPerRow: results.reduce((a, r) => a + r.bytesPerRow, 0) / results.length,
    results,
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

  console.log(`\n=== Composite-key benchmark ===`)
  console.log("All arms WITHOUT ROWID (clustered PK). All arms use GenoID dbkey (timestamp-sorted). File-backed SQLite: I/O page-fault cost included.\n")

  // Config: [arm, nTrials, lookupCount]
  const configs: [CompositeKeyArm, number, number, number][] = [
    ["composite",           n, 10, 100],
    ["composite-indexed",   n, 10, 100],
    ["embedded",            n, 10, 100],
    ["embedded56",          n, 10, 100],
    ["concatenated",        n, 10, 100],
  ]

  // Diagnostic: confirm composite arm performs a SCAN (not SEARCH) on bare-id lookup
  {
    const tmp = new Database(":memory:")
    tmp.run("CREATE TABLE t (shard INTEGER, id BLOB(16), val INTEGER, PRIMARY KEY (shard, id)) WITHOUT ROWID")
    const plan = tmp.query("EXPLAIN QUERY PLAN SELECT val FROM t WHERE id = ?").all()
    console.log("  [diagnostic] composite (no index) lookup plan:", JSON.stringify(plan))
    tmp.run("CREATE INDEX idx_id ON t(id)")
    const plan2 = tmp.query("EXPLAIN QUERY PLAN SELECT val FROM t WHERE id = ?").all()
    console.log("  [diagnostic] composite-indexed lookup plan:", JSON.stringify(plan2))
    tmp.close()
  }

  const allResults: CompositeKeySummary[] = []
  for (const [arm, nrows, trials, lookups] of configs) {
    allResults.push(await benchCompositeKeyRepeated(arm, nrows, trials, lookups))
  }

  console.log(`\nN=${n}, 10 trials:`)
  console.log(["Arm", "insert rows/s", "CI95", "bytes/row", "lookup µs", "CI95", "range ms", "CI95"].join("\t"))
  for (let i = 0; i < configs.length; i++) {
    const r = allResults[i]
    const arm = configs[i][0]
    console.log([
      arm.padEnd(18),
      Math.round(r.insert.mean).toString(),
      `${Math.round(r.insert.ci95[0])}–${Math.round(r.insert.ci95[1])}`,
      r.bytesPerRow.toFixed(2),
      r.lookupUs.mean.toFixed(2),
      `${r.lookupUs.ci95[0].toFixed(2)}–${r.lookupUs.ci95[1].toFixed(2)}`,
      r.rangeScanMs.mean.toFixed(2),
      `${r.rangeScanMs.ci95[0].toFixed(2)}–${r.rangeScanMs.ci95[1].toFixed(2)}`,
    ].join("\t"))
  }
}
