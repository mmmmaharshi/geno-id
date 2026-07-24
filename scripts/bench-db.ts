// ===========================================================================
// bench-db — zero-install database index-locality benchmark.
//
// Question: do time-ordered / structured UUID primary keys give better B-tree
// index locality than random v4 — faster sustained inserts — and can GenoID's
// declared fields answer a partition query straight from the key, with no
// secondary index the other schemes must pay for?
//
// Zero external software: uses bun:sqlite (built into Bun). Two table modes
// reproduce the two real-world index layouts:
//   • clustered  (WITHOUT ROWID) → the PK *is* the B-tree — InnoDB-like; random
//                                  keys reshuffle the clustered store.
//   • secondary  (rowid table)   → the PK is a secondary B-tree — Postgres-like.
//
// HONEST SCOPE: the strong, reproducible signal here is INSERT THROUGHPUT
// (random keys are markedly slower — matches the published ULID/Shopify result).
// SQLite repacks pages aggressively, so final on-disk SIZE diverges far less
// than InnoDB would in production; size is reported as secondary, and a native
// Postgres/InnoDB run (or --engine=pglite) is the place for absolute size/split
// numbers. Results are RELATIVE and instantly reproducible: `bun run bench-db`.
//
// Usage:
//   bun run bench-db --rows=500000 --mode=clustered|secondary|both \
//     --runs=3 --sample-every=100000 --cache-mb=16 --out=results/db-sqlite.json
// ===========================================================================

import { Database } from "bun:sqlite"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { pathToFileURL } from "node:url"

// --- generators (built artifact + baselines) -------------------------------

const root = path.resolve(import.meta.dirname, "..")
const algo = (await import(pathToFileURL(path.resolve(root, "dist/algo.js")).href)) as {
  genV4Native: () => string
  genV7: () => string
  genGenoID: () => string
  genStructuredGenoID: (l: unknown) => string
  completeLayout: (name: string, fields: unknown[]) => unknown
  uuidToBytes: (uuid: string) => Uint8Array
  DBKEY_LAYOUT: unknown
}
const { genPgUuidV8, genUlidV8 } = (await import(
  pathToFileURL(path.resolve(root, "scripts/baselines.ts")).href
)) as { genPgUuidV8: () => string; genUlidV8: () => string }

// Shard-leading layout: shard occupies byte 0, so rows for a given shard form a
// contiguous PK range — a partition scan becomes a key range scan, no index.
// (Trades some time-insert-locality for query pruning — a choice fixed-layout
// schemes cannot make; that trade-off is itself a result worth reporting.)
const SHARDFIRST_LAYOUT = algo.completeLayout("shardfirst", [
  { name: "shard", start: 0, length: 8, type: "shard", constraint: { allowed: [1, 2, 3, 4, 5] } },
  // 40-bit timestamp (bits 8–47) stops before the reserved v8 version nibble
  // at bits 48–51; ~34-year ms range, ample for ordering within a shard.
  { name: "timestamp", start: 8, length: 40, type: "timestamp-ms" },
  { name: "counter", start: 66, length: 16, type: "counter", constraint: { monotonic: true } },
])

// 16-byte big-endian sequential counter — the ideal-locality lower bound.
let _seq = 0
function seqKey(): Uint8Array {
  const b = new Uint8Array(16)
  let x = ++_seq
  for (let j = 15; j >= 8; j--) {
    b[j] = x & 0xff
    x = Math.floor(x / 256)
  }
  return b
}

interface Arm { name: string; key: () => Uint8Array }
const ARMS: Arm[] = [
  { name: "bigint_seq", key: seqKey },
  { name: "uuid_v4", key: () => algo.uuidToBytes(algo.genV4Native()) },
  { name: "uuid_v7", key: () => algo.uuidToBytes(algo.genV7()) },
  { name: "pg_uuid_v8", key: () => algo.uuidToBytes(genPgUuidV8()) },
  { name: "ulid_v8", key: () => algo.uuidToBytes(genUlidV8()) },
  { name: "genoid_v8", key: () => algo.uuidToBytes(algo.genGenoID()) },
  { name: "genoid_structured", key: () => algo.uuidToBytes(algo.genStructuredGenoID(algo.DBKEY_LAYOUT)) },
  { name: "genoid_shardfirst", key: () => algo.uuidToBytes(algo.genStructuredGenoID(SHARDFIRST_LAYOUT)) },
]

// --- CLI -------------------------------------------------------------------

function arg(name: string, def: string): string {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`))
  return hit ? hit.slice(name.length + 3) : def
}
const ROWS = Number(arg("rows", "500000"))
const RUNS = Number(arg("runs", "3"))
const SAMPLE_EVERY = Number(arg("sample-every", "100000"))
const CACHE_MB = Number(arg("cache-mb", "16"))
// clustered | secondary | both
const MODE_ARG = arg("mode", "both")
const BLOB_BYTES = Number(arg("blob-bytes", "64"))
const OUT = arg("out", "results/db-sqlite.json")

// --- seeded payload (identical across arms; only the PK differs) ------------

function mulberry32(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a |= 0
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t ^= t + Math.imul(t ^ (t >>> 7), 61 | t)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

// --- stats (mean + 95% CI, small-df Student t) -----------------------------

const T95: Record<number, number> = { 1: 12.706, 2: 4.303, 3: 3.182, 4: 2.776, 5: 2.571, 6: 2.447, 7: 2.365, 8: 2.306, 9: 2.262 }
function meanCI(xs: number[]): { mean: number; ci95: [number, number] } {
  const n = xs.length
  const m = xs.reduce((a, b) => a + b, 0) / n
  if (n < 2) return { mean: m, ci95: [m, m] }
  const sd = Math.sqrt(xs.reduce((a, x) => a + (x - m) ** 2, 0) / (n - 1))
  const t = n - 1 >= 30 ? 1.96 : (T95[n - 1] ?? 1.96)
  const margin = (t * sd) / Math.sqrt(n)
  return { mean: m, ci95: [m - margin, m + margin] }
}

// --- one arm, one run ------------------------------------------------------

interface ArmRun {
  insertTotalRowsPerSec: number
  insertSeries: { atRows: number; rowsPerSec: number }[]
  pageCount: number
  pageBytes: number
  freePages: number
  pagesPerRow: number
  sampleKeys: Uint8Array[]
}

function ddl(mode: string): string {
  return `CREATE TABLE t (id BLOB PRIMARY KEY, tenant INTEGER, ts INTEGER, payload BLOB)${mode === "clustered" ? " WITHOUT ROWID" : ""}`
}

function runArm(arm: Arm, mode: string, dir: string): ArmRun {
  const file = path.join(dir, `${arm.name}-${mode}.db`)
  try { fs.rmSync(file, { force: true }) } catch {
    /* ignore */
  }
  const db = new Database(file)
  db.exec(`PRAGMA page_size=4096; PRAGMA journal_mode=WAL; PRAGMA synchronous=NORMAL; PRAGMA cache_size=${-CACHE_MB * 1024};`)
  db.exec(ddl(mode))
  const insert = db.prepare("INSERT OR IGNORE INTO t (id, tenant, ts, payload) VALUES (?, ?, ?, ?)")

  const rng = mulberry32(42)
  const payload = new Uint8Array(BLOB_BYTES)
  for (let i = 0; i < BLOB_BYTES; i++) payload[i] = (rng() * 256) | 0

  const series: { atRows: number; rowsPerSec: number }[] = []
  const sampleKeys: Uint8Array[] = []
  const sampleStride = Math.max(1, Math.floor(ROWS / 5000))
  const BATCH = 10_000
  const t0 = process.hrtime.bigint()
  let lastT = t0
  let lastN = 0

  db.exec("BEGIN")
  for (let i = 0; i < ROWS; i++) {
    const id = arm.key()
    const tenant = (rng() * 5 | 0) + 1
    insert.run(id, tenant, i, payload)
    if (i % sampleStride === 0 && sampleKeys.length < 5000) sampleKeys.push(id)
    if ((i + 1) % BATCH === 0) { db.exec("COMMIT"); db.exec("BEGIN") }
    if ((i + 1) % SAMPLE_EVERY === 0) {
      const now = process.hrtime.bigint()
      const dt = Number(now - lastT) / 1e9
      series.push({ atRows: i + 1, rowsPerSec: Math.round((i + 1 - lastN) / dt) })
      lastT = now; lastN = i + 1
    }
  }
  db.exec("COMMIT")
  const total = ROWS / (Number(process.hrtime.bigint() - t0) / 1e9)

  const pageCount = (db.query("PRAGMA page_count").get() as { page_count: number }).page_count
  const pageSize = (db.query("PRAGMA page_size").get() as { page_size: number }).page_size
  const freePages = (db.query("PRAGMA freelist_count").get() as { freelist_count: number }).freelist_count

  const out: ArmRun = {
    insertTotalRowsPerSec: Math.round(total),
    insertSeries: series,
    pageCount,
    pageBytes: pageCount * pageSize,
    freePages,
    pagesPerRow: Number((pageCount / ROWS).toFixed(4)),
    sampleKeys,
  }
  db.close()
  try { fs.rmSync(file, { force: true }); fs.rmSync(`${file}-wal`, { force: true }); fs.rmSync(`${file}-shm`, { force: true }) } catch {
    /* ignore */
  }
  return out
}

// --- point lookup + shard-prune experiment (one representative build) ------

function readExperiments(dir: string): {
  pointLookupUs: Record<string, number>
  shard: { genoidRangeMs: number; baselineNoIndexMs: number; baselineIndexedMs: number; baselineExtraIndexBytes: number; genoidExtraIndexBytes: number; matched: number; total: number }
} {
  // Rebuild two arms in clustered mode for reads: genoid_shardfirst + uuid_v7.
  const pointLookupUs: Record<string, number> = {}
  const built: Record<string, Database> = {}
  for (const armName of ["genoid_shardfirst", "uuid_v7", "genoid_structured", "uuid_v4"]) {
    const arm = ARMS.find((a) => a.name === armName) as Arm
    const file = path.join(dir, `read-${armName}.db`)
    try { fs.rmSync(file, { force: true }) } catch {
      /* file may not exist */
    }
    const db = new Database(file)
    db.exec(`PRAGMA page_size=4096; PRAGMA cache_size=${-CACHE_MB * 1024};`)
    db.exec(ddl("clustered"))
    const insert = db.prepare("INSERT OR IGNORE INTO t (id, tenant, ts, payload) VALUES (?, ?, ?, ?)")
    const rng = mulberry32(42)
    const payload = new Uint8Array(BLOB_BYTES)
    const samples: Uint8Array[] = []
    const stride = Math.max(1, Math.floor(ROWS / 5000))
    db.exec("BEGIN")
    for (let i = 0; i < ROWS; i++) {
      const id = arm.key()
      insert.run(id, (rng() * 5 | 0) + 1, i, payload)
      if (i % stride === 0 && samples.length < 5000) samples.push(id)
      if ((i + 1) % 10_000 === 0) { db.exec("COMMIT"); db.exec("BEGIN") }
    }
    db.exec("COMMIT")
    // point lookup
    const q = db.prepare("SELECT tenant FROM t WHERE id = ?")
    const t0 = process.hrtime.bigint()
    for (const k of samples) q.get(k)
    pointLookupUs[armName] = Number(((Number(process.hrtime.bigint() - t0) / 1e3) / samples.length).toFixed(2))
    built[armName] = db
  }

  // Shard-prune: "rows for partition 3".
  const K = 3
  const lo = new Uint8Array(16); lo[0] = K
  const hi = new Uint8Array(16); hi[0] = K + 1

  // GenoID shard-first: PK range scan, no index, 0 extra bytes.
  const gdb = built.genoid_shardfirst
  let s = process.hrtime.bigint()
  const matched = (gdb.query("SELECT count(*) c FROM t WHERE id >= ? AND id < ?").get(lo, hi) as { c: number }).c
  const genoidRangeMs = Number((Number(process.hrtime.bigint() - s) / 1e6).toFixed(3))
  const total = (gdb.query("SELECT count(*) c FROM t").get() as { c: number }).c

  // Baseline (uuid_v7): partition lives only in the `tenant` column.
  const bdb = built.uuid_v7
  const pagesBefore = (bdb.query("PRAGMA page_count").get() as { page_count: number }).page_count
  s = process.hrtime.bigint()
  bdb.query("SELECT count(*) c FROM t WHERE tenant = ?").get(K)
  const baselineNoIndexMs = Number((Number(process.hrtime.bigint() - s) / 1e6).toFixed(3))
  bdb.exec("CREATE INDEX idx_tenant ON t(tenant)")
  const pagesAfter = (bdb.query("PRAGMA page_count").get() as { page_count: number }).page_count
  const pageSize = (bdb.query("PRAGMA page_size").get() as { page_size: number }).page_size
  s = process.hrtime.bigint()
  bdb.query("SELECT count(*) c FROM t WHERE tenant = ?").get(K)
  const baselineIndexedMs = Number((Number(process.hrtime.bigint() - s) / 1e6).toFixed(3))

  for (const db of Object.values(built)) db.close()
  try { for (const f of fs.readdirSync(dir)) if (f.startsWith("read-")) fs.rmSync(path.join(dir, f), { force: true }) } catch {
    /* ignore */
  }

  return {
    pointLookupUs,
    shard: {
      genoidRangeMs,
      baselineNoIndexMs,
      baselineIndexedMs,
      baselineExtraIndexBytes: (pagesAfter - pagesBefore) * pageSize,
      genoidExtraIndexBytes: 0,
      matched,
      total,
    },
  }
}

// --- write-amplification: the insert tax to make partition queries fast -----
// A non-structured key must carry a secondary index on the partition column to
// answer "rows for partition k" quickly — and pay a B-tree write on EVERY
// insert to maintain it. GenoID embeds the partition in the PK, so it needs no
// such index: full insert throughput, zero index storage. This measures both.

function loadForWriteAmp(arm: Arm, dir: string, withIndex: boolean, rows: number): { rowsPerSec: number; pageBytes: number } {
  const file = path.join(dir, `wa-${arm.name}-${withIndex ? "idx" : "noidx"}.db`)
  try { fs.rmSync(file, { force: true }) } catch {
    /* ignore */
  }
  const db = new Database(file)
  db.exec(`PRAGMA page_size=4096; PRAGMA journal_mode=WAL; PRAGMA synchronous=NORMAL; PRAGMA cache_size=${-CACHE_MB * 1024};`)
  db.exec(ddl("clustered"))
  // maintained on every insert
  if (withIndex) db.exec("CREATE INDEX idx_tenant ON t(tenant)")
  const insert = db.prepare("INSERT OR IGNORE INTO t (id, tenant, ts, payload) VALUES (?, ?, ?, ?)")
  const rng = mulberry32(42)
  const payload = new Uint8Array(BLOB_BYTES)
  const t0 = process.hrtime.bigint()
  db.exec("BEGIN")
  for (let i = 0; i < rows; i++) {
    insert.run(arm.key(), (rng() * 5 | 0) + 1, i, payload)
    if ((i + 1) % 10_000 === 0) { db.exec("COMMIT"); db.exec("BEGIN") }
  }
  db.exec("COMMIT")
  const rowsPerSec = Math.round(rows / (Number(process.hrtime.bigint() - t0) / 1e9))
  const pc = (db.query("PRAGMA page_count").get() as { page_count: number }).page_count
  const ps = (db.query("PRAGMA page_size").get() as { page_size: number }).page_size
  db.close()
  try { fs.rmSync(file, { force: true }); fs.rmSync(`${file}-wal`, { force: true }); fs.rmSync(`${file}-shm`, { force: true }) } catch {
    /* ignore */
  }
  return { rowsPerSec, pageBytes: pc * ps }
}

// --- driver ----------------------------------------------------------------

const modes = MODE_ARG === "both" ? ["clustered", "secondary"] : [MODE_ARG]
const dir = fs.mkdtempSync(path.join(os.tmpdir(), "genoid-db-"))

const result: Record<string, unknown> = {
  engine: "bun:sqlite",
  sqliteVersion: (new Database(":memory:").query("SELECT sqlite_version() v").get() as { v: string }).v,
  hardware: { platform: os.platform(), arch: os.arch(), cpu: os.cpus()[0]?.model, cores: os.cpus().length, memMB: Math.round(os.totalmem() / 1048576) },
  config: { rows: ROWS, runs: RUNS, sampleEvery: SAMPLE_EVERY, cacheMb: CACHE_MB, blobBytes: BLOB_BYTES },
  note: "Relative index-locality benchmark. Headline = insert throughput (SQLite repacks pages, so on-disk size diverges less than production InnoDB). Anchor: uuid_v4 -> uuid_v7 insert speedup reproduces the published ULID result. Partition differentiator is STORAGE + WRITE-AMPLIFICATION, not read latency: GenoID answers a partition query from the PK with zero index (a range scan, slower than an indexed probe), while non-structured keys must carry a secondary index — paying its insert tax and storage (see writeAmplification).",
  modes: {},
}

console.log(`=== GenoID DB benchmark (bun:sqlite) — ${ROWS} rows × ${RUNS} runs ===`)
for (const mode of modes) {
  const perArm: Record<string, unknown> = {}
  console.log(`\n[${mode}]  insert throughput (rows/s, mean ± 95% CI):`)
  for (const arm of ARMS) {
    _seq = 0
    const runs: ArmRun[] = []
    for (let r = 0; r < RUNS; r++) { _seq = 0; runs.push(runArm(arm, mode, dir)) }
    const tp = meanCI(runs.map((r) => r.insertTotalRowsPerSec))
    const last = runs.at(-1)!
    perArm[arm.name] = {
      insertTotalRowsPerSec: { mean: Math.round(tp.mean), ci95: tp.ci95.map(Math.round) },
      pageBytes: last.pageBytes,
      pagesPerRow: last.pagesPerRow,
      freePages: last.freePages,
      insertSeries: last.insertSeries,
    }
    console.log(`  ${arm.name.padEnd(18)} ${Math.round(tp.mean).toString().padStart(9)}  CI[${Math.round(tp.ci95[0])}–${Math.round(tp.ci95[1])}]  ${last.pagesPerRow} pg/row`)
  }
  ;(result.modes as Record<string, unknown>)[mode] = perArm
}

console.log("\n[reads] point lookup + shard-prune differentiator:")
_seq = 0
const reads = readExperiments(dir)
result.reads = reads
console.log("  point lookup µs/op:", reads.pointLookupUs)
console.log(`  shard=3 → GenoID PK-range scan ${reads.shard.genoidRangeMs}ms, 0 index bytes (matched ${reads.shard.matched}/${reads.shard.total} ≈ 1/5)`)
console.log(`           uuid_v7 needs a tenant index (+${(reads.shard.baselineExtraIndexBytes / 1024).toFixed(0)}KB) to answer in ${reads.shard.baselineIndexedMs}ms — its insert tax below`)

console.log("\n[write-amplification] insert tax to make partition queries fast:")
const waRows = Math.min(ROWS, 300_000)
const v7Arm = ARMS.find((a) => a.name === "uuid_v7") as Arm
const gsArm = ARMS.find((a) => a.name === "genoid_shardfirst") as Arm
_seq = 0; const v7NoIdx = loadForWriteAmp(v7Arm, dir, false, waRows)
_seq = 0; const v7Idx = loadForWriteAmp(v7Arm, dir, true, waRows)
_seq = 0; const gsNoIdx = loadForWriteAmp(gsArm, dir, false, waRows)
const taxPct = Number((100 * (v7NoIdx.rowsPerSec - v7Idx.rowsPerSec) / v7NoIdx.rowsPerSec).toFixed(1))
result.writeAmplification = {
  rows: waRows,
  baselineNoIndexRowsPerSec: v7NoIdx.rowsPerSec,
  baselineWithIndexRowsPerSec: v7Idx.rowsPerSec,
  insertTaxPct: taxPct,
  indexBytes: v7Idx.pageBytes - v7NoIdx.pageBytes,
  genoidRowsPerSec: gsNoIdx.rowsPerSec,
  genoidIndexBytes: 0,
}
console.log(`  uuid_v7  no-index ${v7NoIdx.rowsPerSec} → +tenant-index ${v7Idx.rowsPerSec} rows/s  (insert tax ${taxPct}%, +${((v7Idx.pageBytes - v7NoIdx.pageBytes) / 1024).toFixed(0)}KB storage)`)
console.log(`  genoid_shardfirst ${gsNoIdx.rowsPerSec} rows/s  (0 index — partition lives in the PK, no tax)`)

try { fs.rmSync(dir, { recursive: true, force: true }) } catch {
    /* ignore */
  }
const outPath = path.resolve(root, OUT)
fs.mkdirSync(path.dirname(outPath), { recursive: true })
fs.writeFileSync(outPath, JSON.stringify(result, null, 2))
console.log(`\nWrote ${outPath}`)
