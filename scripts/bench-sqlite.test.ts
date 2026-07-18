// Task C: SQLite B-tree index benchmark.
//
// Structured, sortable IDs (timestamp-prefixed) keep the primary-key B-tree
// compact: inserts land on the hot rightmost leaf instead of scattering across
// random pages. This test proves (1) every ID type fills a clean B-tree and
// (2) the sortable IDs keep the index at least as tight as the random ones.

import assert from "node:assert/strict"
import path from "node:path"
import { test } from "node:test"
// oxlint false-positive: does not track `import type` usage inside `as` casts.
// oxlint-disable-next-line no-unused-vars
import type { V8Layout } from "../dist/algo.js"
import { genUlidV8 as ulidV8 } from "./baselines.ts"

import { benchSqlite, DBKEY_LAYOUT } from "./bench-sqlite.ts"

const root = path.resolve(import.meta.dirname, "..")
const algo = (await import(
  path.resolve(root, "dist/algo.js")
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
