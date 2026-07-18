// Task B: concurrent / multi-process generation simulation.
//
// GenoID is a pure, stateless function over the process-global CSPRNG pool.
// To show it is safe to fan out across N worker_threads — e.g. a cluster of
// app servers each minting IDs, or a bulk ETL job — this script spawns N
// worker_threads, each generating `perWorker` UUIDs, then verifies globally:
//   - 0 cross-worker collisions
//   - 0 constraint violations in structured fields
//   - every UUID carries the RFC 9562 v8 marker (version 0x8, variant 10xx)
//
// Run:  bun run bench-concurrent            (or: bun x tsx scripts/bench-concurrent.ts)
// Test: bun test scripts/bench-concurrent.test.ts
//
// Env overrides: CONCURRENT_MODE (genoid|genoid-structured),
// CONCURRENT_WORKERS, CONCURRENT_PER_WORKER.

import os from "node:os"
import path from "node:path"
import { isMainThread, parentPort, workerData, Worker } from "node:worker_threads"
import type { V8Layout } from "../dist/algo.js"

const scriptPath = path.join(import.meta.dirname, "bench-concurrent.ts")
const root = path.resolve(import.meta.dirname, "..")
const algo = await import(path.resolve(root, "dist/algo.js"))

const { completeLayout, genGenoID, genStructuredGenoID, readStructured } = algo

// A small "dbkey" layout: a cluster shard plus a tenant enum carried in a
// constrained random field, the rest CSPRNG. Used to prove the
// constraint-repair path stays correct when generation is fanned out.
export const CONCURRENT_LAYOUT: V8Layout = completeLayout("concurrent-dbkey", [
  { name: "shard", start: 0, length: 8, type: "shard" },
  {
    name: "tenant",
    start: 8,
    length: 3,
    type: "random",
    constraint: { allowed: [0, 1, 2, 3, 4, 5, 6, 7] },
  },
])

export interface ConcurrentResult {
  mode: "genoid" | "genoid-structured"
  workers: number
  perWorker: number
  total: number
  unique: number
  collisions: number
  violations: number
  ms: number
}

const V8_VARIANT = new Set(["8", "9", "a", "b"])

function isV8(uuid: string): boolean {
  return uuid[14] === "8" && V8_VARIANT.has(uuid[19])
}

function structuredViolations(uuid: string): number {
  if (!isV8(uuid)) return 1
  const fields = readStructured(uuid, CONCURRENT_LAYOUT)
  for (const f of CONCURRENT_LAYOUT.fields) {
    if (
      f.type === "random" &&
      f.constraint?.allowed &&
      !f.constraint.allowed.includes(fields[f.name])
    ) {
      return 1
    }
  }
  return 0
}

interface WorkerData {
  mode: "genoid" | "genoid-structured"
  perWorker: number
}

interface WorkerMsg {
  ids: string[]
  violations: number
}

async function workerRun(): Promise<void> {
  const { mode, perWorker } = workerData as WorkerData
  const ids: string[] = new Array(perWorker)
  let violations = 0
  if (mode === "genoid-structured") {
    for (let i = 0; i < perWorker; i++) {
      const u = genStructuredGenoID(CONCURRENT_LAYOUT)
      ids[i] = u
      violations += structuredViolations(u)
    }
  } else {
    for (let i = 0; i < perWorker; i++) {
      const u = genGenoID()
      ids[i] = u
      violations += isV8(u) ? 0 : 1
    }
  }
  // oxlint-disable-next-line unicorn/require-post-message-target-origin
  parentPort!.postMessage({ ids, violations } satisfies WorkerMsg)
}

export async function runConcurrent(opts: {
  mode?: "genoid" | "genoid-structured"
  workers?: number
  perWorker?: number
} = {}): Promise<ConcurrentResult> {
  const mode = opts.mode ?? "genoid"
  const workers = opts.workers ?? Math.max(2, os.cpus().length)
  const perWorker = opts.perWorker ?? 200_000
  const start = performance.now()
  const results = await Promise.all(
    Array.from({ length: workers }, () => {
      const w = new Worker(scriptPath, {
        workerData: { mode, perWorker } satisfies WorkerData,
      })
      return new Promise<WorkerMsg>((resolve, reject) => {
        w.on("message", resolve)
        w.on("error", reject)
        w.on("exit", (code) => {
          if (code !== 0) reject(new Error(`worker exited with code ${code}`))
        })
      })
    }),
  )
  const total = workers * perWorker
  const seen = new Set<string>()
  let violations = 0
  for (const r of results) {
    violations += r.violations
    for (const id of r.ids) seen.add(id)
  }
  const unique = seen.size
  const ms = performance.now() - start
  return { mode, workers, perWorker, total, unique, collisions: total - unique, violations, ms }
}

if (!isMainThread) {
  await workerRun()
} else if (import.meta.main) {
  const mode = (process.env.CONCURRENT_MODE as "genoid" | "genoid-structured") ?? "genoid"
  const workers = Number(process.env.CONCURRENT_WORKERS ?? Math.max(2, os.cpus().length))
  const perWorker = Number(process.env.CONCURRENT_PER_WORKER ?? 200_000)
  const res = await runConcurrent({ mode, workers, perWorker })
  console.log(JSON.stringify(res, null, 2))
}
