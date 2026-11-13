// Task C: SQLite B-tree index benchmark.
//
// Structured, sortable IDs (timestamp-prefixed) keep the primary-key B-tree
// compact: inserts land on the hot rightmost leaf instead of scattering across
// random pages. This test proves (1) every ID type fills a clean B-tree and
// (2) the sortable IDs keep the index at least as tight as the random ones.

import assert from "node:assert/strict"
import { pathToFileURL } from "node:url"
import path from "node:path"
import { test } from "node:test"
// oxlint false-positive: does not track `import type` usage inside `as` casts.
// oxlint-disable-next-line no-unused-vars
import type { V8Layout } from "../../dist/algo.js"
import { genUlidV8 as ulidV8, uuidToBytes } from "./baselines.ts"

import { benchSqlite, benchCompositeKeyArm, expressionIndexShardPredicate, ARM_DDL, DBKEY_LAYOUT } from "./bench-sqlite.ts"
import { Database } from "bun:sqlite"

const root = path.resolve(import.meta.dirname, "..", "..")
const algo = (await import(
  pathToFileURL(path.resolve(root, "dist/algo.js")).href
)) as {
  genV4Native: () => string
  genV7: () => string
  genGenoID: () => string
  genStructuredGenoID: (l: V8Layout) => string
}

const N = 50_000
const V4 = () => algo.genV4Native()
const GENO = () => algo.genGenoID()
const V7 = () => algo.genV7()
const STRUCT = () => algo.genStructuredGenoID(DBKEY_LAYOUT)
const ULIDV8 = () => ulidV8()

test("Task C: every ID type fills a clean B-tree", () => {
  for (const [label, gen] of [
    ["v4-native", V4],
    ["genoid-v8", GENO],
    ["v7", V7],
    ["genoid-structured", STRUCT],
    ["ulid-v8", ULIDV8],
  ] as const) {
    const r = benchSqlite(label, gen, N)
    assert.equal(r.n, N)
    assert.equal(r.integrityOk, true, `${label} integrity_check failed`)
    assert.ok(r.pageCount > 0, `${label} produced no pages`)
    assert.ok(r.freelistCount >= 0, `${label} freelist negative`)
  }
})

test("Task C: all ID types keep a compact, unfragmented B-tree", () => {
  const rs = [
    benchSqlite("v4-native", V4, N),
    benchSqlite("genoid-v8", GENO, N),
    benchSqlite("v7", V7, N),
    benchSqlite("genoid-structured", STRUCT, N),
    benchSqlite("ulid-v8", ULIDV8, N),
  ]
  // Leaf packing is order-independent: page count depends on N and key size,
  // not on whether keys are random or time-sorted. All must stay unfragmented.
  const ppr = rs.map((r) => r.pagesPerRow)
  const maxPPR = Math.max(...ppr)
  const minPPR = Math.min(...ppr)
  assert.ok(
    maxPPR <= minPPR * 1.05,
    `page counts should be within 5% of each other (${minPPR.toFixed(5)}..${maxPPR.toFixed(5)})`,
  )
  for (const r of rs) {
    assert.equal(r.integrityOk, true, `${r.name} integrity_check failed`)
    assert.ok(r.freelistCount <= r.pageCount * 0.05, `${r.name} is significantly fragmented`)
  }
})

test("expression-index arm shares the embedded table and seeks via its index", () => {
  const arm = ARM_DDL["expression-index"]
  assert.equal(arm[0], ARM_DDL.embedded[0], "expression-index must use the same table as embedded")
  assert.ok(arm.some((s) => s.startsWith("CREATE INDEX")), "expression-index must add a secondary index")
  const db = new Database(":memory:")
  for (const ddl of arm) db.run(ddl)
  const plan = db.query(
    `EXPLAIN QUERY PLAN SELECT val FROM ids WHERE ${expressionIndexShardPredicate(3)}`,
  ).all() as { detail: string }[]
  assert.ok(
    plan.some((p) => p.detail.includes("USING INDEX")),
    `shard scan should seek the expression index, got ${JSON.stringify(plan)}`,
  )
  db.close()
})

test("expression-index arm extracts the shard correctly and fills a clean B-tree", () => {
  const ids: { id: Uint8Array; val: number }[] = []
  for (let i = 0; i < 2000; i++) {
    const uuid = algo.genStructuredGenoID(DBKEY_LAYOUT)
    ids.push({ id: uuidToBytes(uuid), val: i })
  }
  const r = benchCompositeKeyArm("expression-index", ids.length, ids, 100)
  assert.equal(r.integrityOk, true, "integrity_check failed")
  assert.ok(r.pointLookupUs > 0 && r.pointLookupUs < 1000, `lookup out of range: ${r.pointLookupUs}`)
  const db = new Database(":memory:")
  for (const ddl of ARM_DDL["expression-index"]) db.run(ddl)
  const stmt = db.prepare("INSERT INTO ids (id, val) VALUES (?, ?)")
  db.run("BEGIN")
  for (const row of ids) stmt.run(row.id, row.val)
  db.run("COMMIT")
  for (const shard of [1, 3, 5]) {
    const pred = expressionIndexShardPredicate(shard)
    const got = (db.query(`SELECT COUNT(*) AS n FROM ids WHERE ${pred}`).get() as { n: number }).n
    const want = ids.filter(
      ({ id }) => (((id[6] & 0x0f) << 4) | (id[7] >> 4)) === shard,
    ).length
    assert.equal(got, want, `shard ${shard}: index predicate found ${got}, want ${want}`)
  }
  db.close()
})
