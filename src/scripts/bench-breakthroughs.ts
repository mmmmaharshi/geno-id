import { mkdirSync, writeFileSync } from "node:fs"
import os from "node:os"
import path from "node:path"
import { performance } from "node:perf_hooks"
import { pathToFileURL } from "node:url"

import { benchSync, collisionTest } from "../bench-core.ts"

const root = path.resolve(import.meta.dirname, "..", "..")

const algo = (await import(
  pathToFileURL(path.join(root, "dist/algo.js")).href
)) as {
  completeLayout: (name: string, fields: unknown[]) => unknown
  deriveWorkerId: (ipv4: string) => number
  experimentalIntegrityTag: (data: Uint8Array, key: Uint8Array) => number
  genGenoID: () => string
  genStructuredGenoID: (layout: unknown) => string
  splitMsFrac: (floatMs: number) => { frac: number; ms: number }
  stegoOpen: (sealed: Uint8Array, seed: string) => number
  stegoSeal: (ms: number, seed: string) => Uint8Array
}

const OUT = process.env.BREAKTHROUGH_OUT ?? "results/breakthroughs.json"
const N_SYNC = Number(process.env.BREAKTHROUGH_N ?? 50_000)
const N_COLL = Number(process.env.BREAKTHROUGH_COLL ?? 20_000)

const dbkey = algo.completeLayout("dbkey", [
  { length: 48, name: "timestamp", start: 0, type: "timestamp-ms" },
  {
    constraint: { allowed: [1, 2, 3, 4, 5] },
    length: 8,
    name: "shard",
    start: 52,
    type: "shard",
  },
  {
    constraint: { monotonic: true },
    length: 16,
    name: "counter",
    start: 66,
    type: "counter",
  },
])

const baseline = benchSync(() => algo.genGenoID(), N_SYNC)
const structured = benchSync(() => algo.genStructuredGenoID(dbkey), N_SYNC)

const POOL = 512
let poolStr = ""
let poolIdx = POOL
const refillPool = (): void => {
  const parts: string[] = []
  for (let i = 0; i < POOL; i += 1) {
    parts.push(algo.genStructuredGenoID(dbkey))
  }
  poolStr = parts.join("")
  poolIdx = 0
}
refillPool()
const preformatted = benchSync(() => {
  if (poolIdx >= POOL) {
    refillPool()
  }
  const s = poolStr.slice(poolIdx * 36, poolIdx * 36 + 36)
  poolIdx += 1
  return s
}, N_SYNC)

const workerStart = performance.now()
for (let i = 0; i < N_SYNC; i += 1) {
  algo.deriveWorkerId(`10.0.${Math.trunc(i / 256) % 256}.${i % 256}`)
}
const workerOps = N_SYNC / ((performance.now() - workerStart) / 1000)

let fracOrdered = true
let lastKey = -1
for (let i = 0; i < 10_000; i += 1) {
  const { frac, ms } = algo.splitMsFrac(1_700_000_000_000 + i / 4096)
  const key = ms * 4096 + frac
  if (key <= lastKey) {
    fracOrdered = false
    break
  }
  lastKey = key
}

const SEED = "breakthrough-bakeoff"
const stegoStart = performance.now()
for (let i = 0; i < 10_000; i += 1) {
  algo.stegoOpen(algo.stegoSeal(1_700_000_000_000 + (i % 1000), SEED), SEED)
}
const stegoOps = 10_000 / ((performance.now() - stegoStart) / 1000)
const stegoRoundtrip =
  algo.stegoOpen(algo.stegoSeal(1_700_000_000_000, SEED), SEED) ===
  1_700_000_000_000 % 2 ** 48

const keyBytes = new Uint8Array([7, 7, 7, 7])
const dataBytes = new Uint8Array(16)
const tagStart = performance.now()
for (let i = 0; i < N_SYNC; i += 1) {
  dataBytes[0] = i % 256
  dataBytes[1] = Math.trunc(i / 256) % 256
  algo.experimentalIntegrityTag(dataBytes, keyBytes)
}
const tagOps = N_SYNC / ((performance.now() - tagStart) / 1000)

const collisions = {
  baseline: collisionTest(() => algo.genGenoID(), N_COLL),
  preformatted: 0,
  structured: collisionTest(() => algo.genStructuredGenoID(dbkey), N_COLL),
}
{
  const seen = new Set<string>()
  let dup = 0
  let idx = POOL
  let str = ""
  const next = (): string => {
    if (idx >= POOL) {
      const parts: string[] = []
      for (let k = 0; k < POOL; k += 1) {
        parts.push(algo.genStructuredGenoID(dbkey))
      }
      str = parts.join("")
      idx = 0
    }
    const s = str.slice(idx * 36, idx * 36 + 36)
    idx += 1
    return s
  }
  for (let i = 0; i < N_COLL; i += 1) {
    const v = next()
    if (seen.has(v)) {
      dup += 1
    } else {
      seen.add(v)
    }
  }
  collisions.preformatted = dup
}

const bunVersion = process.versions.bun
const report = {
  arms: {
    baselineOpsPerSec: Math.round(baseline.opsPerSec),
    fracOrdered,
    preformattedOpsPerSec: Math.round(preformatted.opsPerSec),
    stegoOpsPerSec: Math.round(stegoOps),
    stegoRoundtrip,
    structuredOpsPerSec: Math.round(structured.opsPerSec),
    tagOpsPerSec: Math.round(tagOps),
    workerDeriveOpsPerSec: Math.round(workerOps),
    workerSample: algo.deriveWorkerId("10.0.3.4"),
  },
  collisions,
  description:
    "Breakthrough bake-off: pooled preformat (nope-id), IP-derived worker (stateless snowflake), ms+frac ordering (ramsey 4.10), XOR stego timestamp (pg_uuid_v8), keyed integrity tag (SKEID) vs baselines.",
  environment: {
    generatedAt: new Date().toISOString(),
    os: `${os.platform()} ${os.release()} ${os.arch()}`,
    runtime:
      typeof bunVersion === "string"
        ? `Bun ${bunVersion}`
        : `Node ${process.version}`,
  },
  experiment: "breakthrough-bakeoff",
  n: { collisions: N_COLL, throughput: N_SYNC },
}

mkdirSync(path.dirname(path.resolve(root, OUT)), { recursive: true })
writeFileSync(path.resolve(root, OUT), `${JSON.stringify(report, null, 2)}\n`)
console.log(`wrote ${OUT}`)
console.log(JSON.stringify(report.arms, null, 2))
console.log(JSON.stringify(collisions, null, 2))
