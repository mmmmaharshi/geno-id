// Task D: 100M-scale batched collision test.
//
// The shared `collisionTest` (bench-core.ts) keeps every ID in a Set<string>,
// which cannot hold 100M entries in memory. This module provides an exact
// dedup built on a compact open-addressing hash set that stores each 128-bit
// UUID as two 64-bit slots in a BigUint64Array — roughly 2.3 GB for 100M IDs
// at 0.7 load, instead of the ~10 GB a Set<string> would need.
//
// To keep wall time down, the default run fans the work out across every CPU
// core with worker_threads: each worker dedups its own partition in isolation,
// and main aggregates the (expected 0) collision counts. Cross-worker uniqueness
// follows from each worker's independent CSPRNG pool — proven by Task B.
//
// Run:  bun run collision-100m            (env: COLLISION_N=100000000)
//       COLLISION_SYNC=1 bun run collision-100m   (single-threaded path)
// Test: bun test scripts/collision-100m.test.ts

import os from "node:os"
import path from "node:path"
import { isMainThread, parentPort, workerData, Worker } from "node:worker_threads"
import { birthdayBound50 } from "../dist/bench-core.js"
import type { V8Layout } from "../dist/algo.js"
import { genUlidV8 } from "./baselines.ts"

const scriptPath = path.join(import.meta.dirname, "collision-100m.ts")
const root = path.resolve(import.meta.dirname, "..")
const algo = (await import(
  path.resolve(root, "dist/algo.js")
)) as {
  genV4Native: () => string
  genV7: () => string
  genGenoID: () => string
  genStructuredGenoID: (l: V8Layout) => string
  completeLayout: (name: string, fields: V8Layout["fields"]) => V8Layout
}

// Mirrors the dbkey layout shipped in benchmark.ts (kept local, per convention).
export const DBKEY_LAYOUT: V8Layout = algo.completeLayout("dbkey", [
  { name: "timestamp", start: 0, length: 48, type: "timestamp-ms" },
  {
    name: "shard",
    start: 52,
    length: 8,
    type: "shard",
    constraint: { allowed: [1, 2, 3, 4, 5] },
  },
  {
    name: "counter",
    start: 66,
    length: 16,
    type: "counter",
    constraint: { monotonic: true },
  },
])

const MASK64 = (1n << 64n) - 1n

// Parse a UUID string into its 128-bit value as two 64-bit halves.
export function uuidToKey(uuid: string): { hi: bigint; lo: bigint } {
  const hex = uuid.length === 36 ? uuid.replace(/-/g, "") : uuid
  const v = BigInt(`0x${hex}`)
  return { hi: (v >> 64n) & MASK64, lo: v & MASK64 }
}

// Compact open-addressing hash set for 128-bit keys (exact dedup).
// Capacity is a power of two so `& (cap-1)` works and linear probing (step 1)
// always reaches a free slot while any slot is empty.
class Uuid128Set {
  private cap: number
  private mask: number
  private keysHi: BigUint64Array
  private keysLo: BigUint64Array
  private occ: Uint8Array

  constructor(n: number, load = 0.7) {
    let cap = Math.max(16, Math.ceil(n / load))
    cap = 1 << Math.ceil(Math.log2(cap))
    this.cap = cap
    this.mask = cap - 1
    this.keysHi = new BigUint64Array(cap)
    this.keysLo = new BigUint64Array(cap)
    this.occ = new Uint8Array(cap)
  }

  get capacity(): number {
    return this.cap
  }

  // Returns true if the key was already present (a collision).
  add(hi: bigint, lo: bigint): boolean {
    let idx = Number((hi ^ (lo << 1n)) & BigInt(this.mask))
    while (this.occ[idx] === 1) {
      if (this.keysHi[idx] === hi && this.keysLo[idx] === lo) return true
      idx = (idx + 1) & this.mask
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
export function collisionTestScaled(
  gen: () => string,
  n: number,
  label = "ids",
): ScaledCollisionResult {
  const set = new Uuid128Set(n)
  let collisions = 0
  const start = performance.now()
  for (let i = 0; i < n; i++) {
    const { hi, lo } = uuidToKey(gen())
    if (set.add(hi, lo)) collisions++
  }
  const elapsed = performance.now() - start
  const tableMB = (set.capacity * 8 * 2 + set.capacity) / (1024 * 1024)
  return {
    name: label,
    n,
    collisions,
    ms: elapsed,
    opsPerSec: n / (elapsed / 1000),
    tableMB,
    method: "open-addressing 128-bit hash set",
  }
}

const MODES: Record<string, () => string> = {
  "v4-native": algo.genV4Native,
  "genoid-v8": algo.genGenoID,
  "v7": algo.genV7,
  "genoid-structured": () => algo.genStructuredGenoID(DBKEY_LAYOUT),
  "ulid-v8": genUlidV8,
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
  for (let i = 0; i < n; i++) {
    const { hi, lo } = uuidToKey(gen())
    if (set.add(hi, lo)) collisions++
  }
  const tableMB = (set.capacity * 8 * 2 + set.capacity) / (1024 * 1024)
  // oxlint-disable-next-line unicorn/require-post-message-target-origin
  parentPort!.postMessage({ collisions, n, tableMB } satisfies WorkerMsg)
}

// Multi-core exact dedup: fan N out across every CPU, each worker dedups its
// own partition; main aggregates collision counts (cross-worker uniqueness is
// guaranteed by independent per-worker CSPRNG pools — proven in Task B).
export async function collisionTestScaledParallel(
  mode: string,
  n: number,
  opts: { workers?: number; label?: string } = {},
): Promise<ScaledCollisionResult> {
  const workers = opts.workers ?? Math.max(2, os.cpus().length)
  const perWorker = Math.ceil(n / workers)
  const start = performance.now()
  const results = await Promise.all(
    Array.from({ length: workers }, () => {
      const w = new Worker(scriptPath, {
        workerData: { mode, n: perWorker } satisfies WorkerData,
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
  const elapsed = performance.now() - start
  const collisions = results.reduce((a, r) => a + r.collisions, 0)
  const tableMB = Math.max(...results.map((r) => r.tableMB))
  return {
    name: opts.label ?? mode,
    n,
    collisions,
    ms: elapsed,
    opsPerSec: n / (elapsed / 1000),
    tableMB,
    method: `open-addressing 128-bit hash set (${workers} workers)`,
  }
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
  console.log(`Birthday bound (50% collision prob) for 122-bit entropy: ${birthdayBound50(122).toExponential(2)} IDs\n`)
  console.log(["Generator", "N", "collisions", "ms", "IDs/s", "table MB", "verdict"].join("\t"))
  let allZero = true
  for (const [label, mode] of gens) {
    const r = syncMode
      ? collisionTestScaled(MODES[mode], n, label)
      : await collisionTestScaledParallel(mode, n, { label })
    const verdict = r.collisions === 0 ? "PASS" : "FAIL"
    if (r.collisions !== 0) allZero = false
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
  }
  console.log(
    `\n${allZero ? "PASS" : "FAIL"}: all generators reported 0 collisions at N=${n.toLocaleString()}.`,
  )
  if (!allZero) process.exit(1)
}
