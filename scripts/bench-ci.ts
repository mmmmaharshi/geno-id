import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { pathToFileURL } from "node:url"
import {
  benchRepeated,
  collisionTest,
} from "../dist/bench-core.js"
import type { BenchStats } from "../dist/bench-core.js"
import { compareBench } from "./significance.ts"
import {
  genPgUuidV8,
  genUlid,
  genUlidV8,
  genKsuid,
  genSnowflake,
} from "./baselines.ts"
import type { CIBenchmarkResult, EnvInfo, BenchEntry, CollisionEntry } from "./ci-result.ts"

const __dirname = import.meta.dirname
const root = path.resolve(__dirname, "..")

const algo = await import(pathToFileURL(path.resolve(root, "dist/algo.js")).href)
const { genV4Native, genV7, genMathRandom, genGenoID, genStructuredGenoID, DBKEY_LAYOUT } =
  algo as {
    genV4Native: () => string
    genV7: () => string
    genMathRandom: () => string
    genGenoID: () => string
    genStructuredGenoID: (layout: unknown) => string
    DBKEY_LAYOUT: unknown
  }

const genDbkey = (): string => genStructuredGenoID(DBKEY_LAYOUT)

function collectEnv(): EnvInfo {
  const isBun = (globalThis as { Bun?: unknown }).Bun !== undefined
  return {
    runtime: isBun ? "bun" : "node",
    bun: process.versions.bun ?? null,
    node: process.versions.node,
    platform: process.platform,
    arch: process.arch,
    cpuModel: os.cpus()[0]?.model ?? "unknown",
    cpuCount: os.cpus().length,
    totalMemoryMB: Math.round(os.totalmem() / (1024 * 1024)),
  }
}

const nSync = 200_000
const nColl = 1_000_000
const TRIALS = 10

// Native v4 is the reference every generator's significance is measured against
// (the paper's "native baseline"). Welch t-test + Cohen's d vs this generator.
const BASELINE = "v4-native"

const specs: [string, () => string][] = [
  ["v4-native", genV4Native],
  ["v7-custom", genV7],
  ["genoid-v8", genGenoID],
  ["mathrandom", genMathRandom],
  ["pg-uuid-v8", genPgUuidV8],
  ["ulid", genUlid],
  ["ulid-v8", genUlidV8],
  ["ksuid", genKsuid],
  ["snowflake", genSnowflake],
  ["genoid-structured", genDbkey],
]

function coll(name: string, fn: () => string): CollisionEntry {
  return { name, n: nColl, collisions: collisionTest(fn, nColl) }
}

const env = collectEnv()

// Pass 1: collect repeated-trial stats (with a warmup pass) for every generator.
const statsByName = new Map<string, BenchStats>()
for (const [name, fn] of specs) statsByName.set(name, benchRepeated(fn, nSync, TRIALS))

// Pass 2: build entries, each carrying a Welch t-test p-value + Cohen's d
// against the baseline, so the artifact states statistical distinguishability
// rather than leaving it to eyeballed point estimates.
const baseStats = statsByName.get(BASELINE)
if (!baseStats) throw new Error(`baseline ${BASELINE} was not benchmarked`)
const benchmarks: BenchEntry[] = specs.map(([name]) => {
  const r = statsByName.get(name) as BenchStats
  const cmp = compareBench(r, baseStats)
  return {
    name,
    opsPerSec: Math.round(r.mean),
    usPerOp: Number((1_000_000 / r.mean).toFixed(4)),
    ci95: [Math.round(r.ci95[0]), Math.round(r.ci95[1])],
    std: Math.round(r.std),
    trials: r.trials,
    welchP: Number(cmp.p.toPrecision(3)),
    cohensD: Number(cmp.d.toFixed(3)),
  }
})

// NOTE: snowflake is intentionally excluded from the collision gate. It is a
// 64-bit time+sequence ID (12-bit sequence that wraps within a millisecond),
// not an entropy-based UUID — under tight-loop 1M generation it collides once
// the sequence wraps, which is expected and not a defect. It stays in the speed
// benchmark above. Only entropy-based / UUID-shaped generators are collision-tested.
const collisions: CollisionEntry[] = [
  coll("v4-native", genV4Native),
  coll("v7-custom", genV7),
  coll("genoid-v8", genGenoID),
  coll("genoid-structured", genDbkey),
  coll("mathrandom", genMathRandom),
  coll("pg-uuid-v8", genPgUuidV8),
  coll("ulid-v8", genUlidV8),
  coll("ulid", genUlid),
  coll("ksuid", genKsuid),
]

const output: CIBenchmarkResult = { environment: env, baselineName: BASELINE, benchmarks, collisions }

console.log("=== GenoID CI benchmark ===")
console.log("Environment:", JSON.stringify(env, null, 2))
console.log(`\nBenchmarks (ops/sec, mean ± std, 95% CI; Welch p & Cohen's d vs ${BASELINE}):`)
for (const b of benchmarks) {
  console.log(
    `  ${b.name.padEnd(16)} ${b.opsPerSec.toString().padStart(10)} ± ${b.std
      .toString()
      .padStart(8)}  CI[${b.ci95[0]}–${b.ci95[1]}]  p=${b.welchP}  d=${b.cohensD}`,
  )
}
console.log("\nCollisions:")
for (const c of collisions) {
  console.log(`  ${c.name.padEnd(14)} n=${c.n}  collisions=${c.collisions}  PASS=${c.collisions === 0}`)
}

const outPath = path.resolve(root, "dist/bench-ci-results.json")
try {
  fs.writeFileSync(outPath, JSON.stringify(output, null, 2))
  console.log(`\nWrote ${outPath}`)
} catch (error) {
  console.error(`Failed to write ${outPath}: ${(error as Error).message}`)
}

const anyCollision = collisions.some((c) => c.collisions > 0)
if (anyCollision) {
  console.error("FAIL: collision detected in CI benchmark")
  process.exit(1)
}
