// Task B: concurrent / multi-process generation simulation.

//

// GenoID is a pure, stateless function over the process-global CSPRNG pool.

// This test proves it is safe to fan out across N worker_threads (e.g. a

// Cluster of app servers each minting IDs, or a bulk ETL pipeline): every

// UUID must remain globally unique and, for structured layouts, must keep its

// Field constraints intact across threads.

/// <reference types="node" />

import assert from "node:assert/strict"
import { test } from "node:test"

import { runConcurrent } from "./bench-concurrent.ts"

void test("Task B: zero cross-worker collisions (plain genoid)", async () => {
  const res = await runConcurrent({
    mode: "genoid",
    perWorker: 50_000,
    workers: 3,
  })

  assert.equal(res.total, res.workers * res.perWorker)

  assert.equal(res.collisions, 0)

  assert.equal(res.unique, res.total)
})

void test("Task B: zero collisions and zero constraint violations (structured)", async () => {
  const res = await runConcurrent({
    mode: "genoid-structured",

    perWorker: 50_000,

    workers: 4,
  })

  assert.equal(res.collisions, 0)

  assert.equal(res.unique, res.total)

  assert.equal(res.violations, 0)
})
