import os from "node:os"
import path from "node:path"
import { pathToFileURL } from "node:url"
import {
  Worker,
  isMainThread,
  parentPort,
  workerData,
} from "node:worker_threads"

import type { V8Layout } from "../../dist/algo.js"
import { need } from "../shared/need.ts"
import { waitForWorkerMessage } from "./shared/pool.ts"
import { nullValue } from "./shared/runtime-values.ts"

// Task B: concurrent / multi-process generation simulation.

//

// GenoID is a pure, stateless function over the process-global CSPRNG pool.

// To show it is safe to fan out across N worker_threads — e.g. a cluster of

// App servers each minting IDs, or a bulk ETL job — this script spawns N

// Worker_threads, each generating `perWorker` UUIDs, then verifies globally:

//   - 0 cross-worker collisions

//   - 0 constraint violations in structured fields

//   - every UUID carries the RFC 9562 v8 marker (version 0x8, variant 10xx)

//

// Run:  bun run bench-concurrent            (or: bun x tsx src/scripts/bench-concurrent.ts)

// Test: bun test src/scripts/bench-concurrent.test.ts

//

// Env overrides: CONCURRENT_MODE (genoid|genoid-structured),

// CONCURRENT_WORKERS, CONCURRENT_PER_WORKER.

const scriptPath = path.join(import.meta.dirname, "bench-concurrent.ts")

const root = path.resolve(import.meta.dirname, "..", "..")

const algo = (await import(
  pathToFileURL(path.resolve(root, "dist/algo.js")).href
)) as {
  completeLayout: (name: string, fields: readonly unknown[]) => V8Layout

  genGenoID: () => string

  genStructuredGenoID: (layout: V8Layout) => string

  readStructured: (
    uuid: string,
    layout: Readonly<V8Layout>
  ) => Record<string, number>
}

const { completeLayout, genGenoID, genStructuredGenoID, readStructured } = algo

// A small "dbkey" layout: a cluster shard plus a tenant enum carried in a

// Constrained random field, the rest CSPRNG. Used to prove the

// Constraint-repair path stays correct when generation is fanned out.

export const CONCURRENT_LAYOUT: V8Layout = completeLayout("concurrent-dbkey", [
  { length: 8, name: "shard", start: 0, type: "shard" },

  {
    constraint: { allowed: [0, 1, 2, 3, 4, 5, 6, 7] },

    length: 3,

    name: "tenant",

    start: 8,

    type: "random",
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

const isV8 = (uuid: string): boolean =>
  uuid[14] === "8" && V8_VARIANT.has(uuid[19])

const structuredViolations = (uuid: string): number => {
  if (!isV8(uuid)) {
    return 1
  }

  const fields = readStructured(uuid, CONCURRENT_LAYOUT)

  for (const f of CONCURRENT_LAYOUT.fields) {
    const { constraint } = f

    if (f.type === "random" && constraint) {
      const { allowed } = constraint

      if (allowed && !allowed.includes(fields[f.name])) {
        return 1
      }
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

const workerRun = (): void => {
  const { mode, perWorker } = workerData as WorkerData

  const ids: string[] = Array.from<string>({ length: perWorker })

  let violations = 0

  if (mode === "genoid-structured") {
    for (let i = 0; i < perWorker; i += 1) {
      const u = genStructuredGenoID(CONCURRENT_LAYOUT)

      ids[i] = u

      violations += structuredViolations(u)
    }
  } else {
    for (let i = 0; i < perWorker; i += 1) {
      const u = genGenoID()

      ids[i] = u

      let violation = 1

      if (isV8(u)) {
        violation = 0
      }

      violations += violation
    }
  }

  need(parentPort).postMessage({ ids, violations } satisfies WorkerMsg, [])
}

export const runConcurrent = async (
  opts: Readonly<{
    mode?: "genoid" | "genoid-structured"

    workers?: number

    perWorker?: number
  }> = {}
): Promise<ConcurrentResult> => {
  const mode = opts.mode ?? "genoid"

  const workers = opts.workers ?? Math.max(2, os.cpus().length)

  const perWorker = opts.perWorker ?? 200_000

  const start = performance.now()

  const results = await Promise.all(
    Array.from({ length: workers }, async (): Promise<WorkerMsg> => {
      const w = new Worker(scriptPath, {
        workerData: { mode, perWorker } satisfies WorkerData,
      })

      const message = await waitForWorkerMessage<WorkerMsg>(w)

      return message
    })
  )

  const total = workers * perWorker

  const seen = new Set<string>()

  let violations = 0

  for (const r of results) {
    violations += r.violations

    for (const id of r.ids) {
      seen.add(id)
    }
  }

  const unique = seen.size

  const ms = performance.now() - start

  return {
    collisions: total - unique,
    mode,
    ms,
    perWorker,
    total,
    unique,
    violations,
    workers,
  }
}

if (!isMainThread) {
  workerRun()
} else if (import.meta.main) {
  const mode =
    (process.env.CONCURRENT_MODE as WorkerData["mode"] | undefined) ?? "genoid"

  const workers = Number(
    process.env.CONCURRENT_WORKERS ?? Math.max(2, os.cpus().length)
  )

  const perWorker = Number(process.env.CONCURRENT_PER_WORKER ?? 200_000)

  const res = await runConcurrent({ mode, perWorker, workers })

  console.log(JSON.stringify(res, nullValue, 2))
}
