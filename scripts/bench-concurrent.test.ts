// Task B: concurrent / multi-process generation simulation.
//
// GenoID is a pure, stateless function over the process-global CSPRNG pool.
// This test proves it is safe to fan out across N worker_threads (e.g. a
// cluster of app servers each minting IDs, or a bulk ETL pipeline): every
// UUID must remain globally unique and, for structured layouts, must keep its
// field constraints intact across threads.

import assert from "node:assert/strict"
import path from "node:path"
import { test } from "node:test"
// oxlint false-positive: does not track `import type` usage inside `as` casts.
// oxlint-disable-next-line no-unused-vars
import type { V8Layout } from "../dist/algo.js"

import { CONCURRENT_LAYOUT, runConcurrent } from "./bench-concurrent.ts"

const root = path.resolve(import.meta.dirname, "..")
const algo = (await import(
  path.resolve(root, "dist/algo.js")
)) as {
  genStructuredGenoID: (l: V8Layout) => string
  readStructured: (u: string, l: V8Layout) => Record<string, number>
}

test("Task B: zero cross-worker collisions (plain genoid)", async () => {
  const res = await runConcurrent({ mode: "genoid", workers: 3, perWorker: 50_000 })
  assert.equal(res.total, res.workers * res.perWorker)
  assert.equal(res.collisions, 0)
  assert.equal(res.unique, res.total)
})

test("Task B: zero collisions and zero constraint violations (structured)", async () => {
  const res = await runConcurrent({
    mode: "genoid-structured",
    workers: 4,
    perWorker: 50_000,
  })
  assert.equal(res.collisions, 0)
  assert.equal(res.unique, res.total)
  assert.equal(res.violations, 0)
})

test("Task B: every structured UUID keeps a valid tenant in [0,7] under fan-out", () => {
  const sample = algo.genStructuredGenoID(CONCURRENT_LAYOUT)
  const fields = algo.readStructured(sample, CONCURRENT_LAYOUT)
  assert.ok([0, 1, 2, 3, 4, 5, 6, 7].includes(fields.tenant))
})
