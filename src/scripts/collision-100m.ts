import {
  Worker,
  isMainThread,
  parentPort,
  workerData,
} from "node:worker_threads"
import type { V8Layout } from "../../dist/algo.js"

import { birthdayBound50 } from "../../dist/bench-core.js"

import { genUlidV8 } from "./baselines.ts"

import { need } from "../shared/need.ts"

import os from "node:os"

import path from "node:path"

import { pathToFileURL } from "node:url"

import { waitForWorkerMessage } from "./shared/pool.ts"

// Task D: 100M-scale batched collision test.

//

// The shared `collisionTest` (bench-core.ts) keeps every ID in a Set<string>,

// Which cannot hold 100M entries in memory. This module provides an exact

// Dedup built on a compact open-addressing hash set that stores each 128-bit

// UUID as two 64-bit slots in a BigUint64Array — roughly 2.3 GB for 100M IDs

// At 0.7 load, instead of the ~10 GB a Set<string> would need.

//

// To keep wall time down, the default run fans the work out across every CPU

// Core with worker_threads: each worker dedups its own partition in isolation,

// And main aggregates the (expected 0) collision counts. Cross-worker uniqueness

// Follows from each worker's independent CSPRNG pool — proven by Task B.

//

// Run:  bun run collision-100m            (env: COLLISION_N=100000000)

//       COLLISION_SYNC=1 bun run collision-100m   (single-threaded path)

// Test: bun test src/scripts/collision-100m.test.ts

const scriptPath = path.join(import.meta.dirname, "collision-100m.ts")

const root = path.resolve(import.meta.dirname, "..", "..")

const algo = (await import(
  pathToFileURL(path.resolve(root, "dist/algo.js")).href
)) as {
  genV4Native: () => string

  genV7: () => string

  genGenoID: () => string

  genStructuredGenoID: (l: Readonly<V8Layout>) => string

  DBKEY_LAYOUT: V8Layout
}

// Canonical dbkey layout, shared from the core module (single source of truth).

export const { DBKEY_LAYOUT } = algo

// Parse a UUID string into its 128-bit value as two 64-bit halves.

export const uuidToKey = (uuid: string): { hi: bigint; lo: bigint } => {
  let hex = uuid

  if (uuid.length === 36) {
    hex = uuid.replaceAll("-", "")
  }

  return {
    hi: BigInt(`0x${hex.slice(0, 16)}`),
    lo: BigInt(`0x${hex.slice(16)}`),
  }
}

// Compact open-addressing hash set for 128-bit keys (exact dedup).

// Capacity is a power of two so `& (cap-1)` works and linear probing (step 1)

// Always reaches a free slot while any slot is empty.

class Uuid128Set {
  private readonly cap: number

  private keysHi: BigUint64Array

  private keysLo: BigUint64Array

  private occ: Uint8Array

  public constructor(n: number, load = 0.7) {
    let cap = Math.max(16, Math.ceil(n / load))

    cap = 2 ** Math.ceil(Math.log2(cap))

    this.cap = cap

    this.keysHi = new BigUint64Array(cap)

    this.keysLo = new BigUint64Array(cap)

    this.occ = new Uint8Array(cap)
  }

  public get capacity(): number {
    return this.cap
  }

  // Returns true if the key was already present (a collision).

  public add(hi: bigint, lo: bigint): boolean {
    const modulus = BigInt(this.cap)

    let idx = Number((hi * 1_000_003n + lo) % modulus)

    while (this.occ[idx] === 1) {
      if (this.keysHi[idx] === hi && this.keysLo[idx] === lo) {
        return true
      }

      idx += 1

      if (idx >= this.cap) {
        idx = 0
      }
    }

    this.occ[idx] = 1

    this.keysHi[idx] = hi

    this.keysLo[idx] = lo

    return false
  }
}

export interface ScaledCollisionResult {
  name: string

  n: number

  collisions: number

  ms: number

  opsPerSec: number

  tableMB: number

  method: string
}

// Single-threaded exact dedup (used by the TDD test at moderate N).

export const collisionTestScaled = (
  gen: () => string,

  n: number,

  label = "ids",
): ScaledCollisionResult => {
  const set = new Uuid128Set(n)

  let collisions = 0

  const start = performance.now()

  for (let i = 0; i < n; i += 1) {
    const { hi, lo } = uuidToKey(gen())

    if (set.add(hi, lo)) {
      collisions += 1
    }
  }

  const elapsed = performance.now() - start

  const tableMB = (set.capacity * 8 * 2 + set.capacity) / (1024 * 1024)

  return {
    collisions,

    method: "open-addressing 128-bit hash set",

    ms: elapsed,

    n,

    name: label,

    opsPerSec: n / (elapsed / 1000),

    tableMB,
  }
}

const MODES: Record<string, () => string> = {
  "genoid-structured": () => algo.genStructuredGenoID(DBKEY_LAYOUT),

  "genoid-v8": algo.genGenoID,

  "ulid-v8": genUlidV8,

  "v4-native": algo.genV4Native,

  v7: algo.genV7,
}

interface WorkerData {
  mode: string

  n: number
}

interface WorkerMsg {
  collisions: number

  n: number

  tableMB: number
}

// Worker entry: dedup a partition of N in isolation.

if (!isMainThread) {
  const { mode, n } = workerData as WorkerData

  const gen = MODES[mode]

  const set = new Uuid128Set(n)

  let collisions = 0

  for (let i = 0; i < n; i += 1) {
    const { hi, lo } = uuidToKey(gen())

    if (set.add(hi, lo)) {
      collisions += 1
    }
  }

  const tableMB = (set.capacity * 8 * 2 + set.capacity) / (1024 * 1024)

  need(parentPort).postMessage(
    { collisions, n, tableMB } satisfies WorkerMsg,
    [],
  )
}

// Multi-core exact dedup: fan N out across every CPU, each worker dedups its

// Own partition; main aggregates collision counts (cross-worker uniqueness is

// Guaranteed by independent per-worker CSPRNG pools — proven in Task B).

export const collisionTestScaledParallel = async (
  mode: string,

  n: number,

  opts: Readonly<{ workers?: number; label?: string }> = {},
): Promise<ScaledCollisionResult> => {
  const workers = opts.workers ?? Math.max(2, os.cpus().length)

  const perWorker = Math.ceil(n / workers)

  const start = performance.now()

  const results = await Promise.all(
    Array.from({ length: workers }, async (): Promise<WorkerMsg> => {
      const w = new Worker(scriptPath, {
        workerData: { mode, n: perWorker } satisfies WorkerData,
      })

      const message = await waitForWorkerMessage<WorkerMsg>(w)

      return message
    }),
  )

  const elapsed = performance.now() - start

  const collisions = results.reduce((a, r) => a + r.collisions, 0)

  const tableMB = Math.max(...results.map((r) => r.tableMB))

  return {
    collisions,

    method: `open-addressing 128-bit hash set (${workers} workers)`,

    ms: elapsed,

    n,

    name: opts.label ?? mode,

    opsPerSec: n / (elapsed / 1000),

    tableMB,
  }
}

const runScaled = async (
  mode: string,
  n: number,
  label: string,
  syncMode: boolean,
): Promise<ScaledCollisionResult> => {
  if (syncMode) {
    return collisionTestScaled(MODES[mode], n, label)
  }

  const result = await collisionTestScaledParallel(mode, n, { label })

  return result
}

if (import.meta.main) {
  const n = Number(process.env.COLLISION_N ?? 100_000_000)

  const syncMode = process.env.COLLISION_SYNC === "1"

  const gens: [string, string][] = [
    ["v4-native", "v4-native"],

    ["genoid-v8", "genoid-v8"],

    ["v7", "v7"],

    ["genoid-structured", "genoid-structured"],

    ["ulid-v8", "ulid-v8"],
  ]

  console.log(`=== Task D: ${n.toLocaleString()}-scale collision test ===`)

  console.log(
    `Birthday bound (50% collision prob) for 122-bit entropy: ${birthdayBound50(122).toExponential(2)} IDs\n`,
  )

  console.log(
    ["Generator", "N", "collisions", "ms", "IDs/s", "table MB", "verdict"].join(
      "\t",
    ),
  )

  const runs: ScaledCollisionResult[] = []

  const runGenerator = async (index: number): Promise<void> => {
    if (index >= gens.length) {
      return
    }

    const [label, mode] = gens[index]

    const r = await runScaled(mode, n, label, syncMode)

    let verdict = "FAIL"

    if (r.collisions === 0) {
      verdict = "PASS"
    }

    runs.push(r)

    console.log(
      [
        r.name,

        r.n.toLocaleString(),

        String(r.collisions),

        r.ms.toFixed(0),

        r.opsPerSec.toFixed(0),

        r.tableMB.toFixed(0),

        verdict,
      ].join("\t"),
    )

    await runGenerator(index + 1)
  }

  await runGenerator(0)

  const allZero = runs.every((run) => run.collisions === 0)

  let summary = "FAIL"

  if (allZero) {
    summary = "PASS"
  }

  console.log(
    `\n${summary}: all generators reported 0 collisions at N=${n.toLocaleString()}.`,
  )

  if (!allZero) {
    process.exitCode = 1
  }
}
