import {
  benchRepeated,
  collisionTest,
} from "../../dist/bench-core.js"

import {
  genPgUuidV8,
  genUlid,
  genUlidV8,
  genKsuid,
  genSnowflake,
} from "../baselines.ts"
import { compareBench } from "../significance.ts"
import type { CIBenchmarkResult, EnvInfo, BenchEntry, CollisionEntry } from "../ci-result.ts"

const algo = (await import("../../dist/algo.js")) as {
  genV4Native: () => string
  genV7: () => string
  genMathRandom: () => string
  genGenoID: () => string
  genStructuredGenoID: (layout: unknown) => string
  DBKEY_LAYOUT: unknown
}

const genDbkey = (): string => algo.genStructuredGenoID(algo.DBKEY_LAYOUT)

function normalizeArch(arch: string): string {
  if (arch === "aarch64") return "arm64"
  if (arch === "x86_64") return "x64"
  return arch
}

function collectEnv(): EnvInfo {
  const cpuCount = navigator.hardwareConcurrency || 1
  return {
    runtime: "deno",
    bun: null,
    node: `deno-${Deno.version.deno}`,
    platform: Deno.build.os,
    arch: normalizeArch(Deno.build.arch),
    cpuModel: "unknown",
    cpuCount,
    totalMemoryMB: 0,
  }
}

const nSync = 200_000
const nColl = 1_000_000
const TRIALS = 10

const BASELINE = "v4-native"

const specs: [string, () => string][] = [
  ["v4-native", algo.genV4Native],
  ["v7-custom", algo.genV7],
  ["genoid-v8", algo.genGenoID],
  ["mathrandom", algo.genMathRandom],
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

const env = await collectEnv()

const statsByName = new Map<string, ReturnType<typeof benchRepeated>>()
for (const [name, fn] of specs) statsByName.set(name, benchRepeated(fn, nSync, TRIALS))

const baseStats = statsByName.get(BASELINE)
if (!baseStats) throw new Error(`baseline ${BASELINE} was not benchmarked`)
const benchmarks: BenchEntry[] = specs.map(([name]) => {
  const r = statsByName.get(name)!
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
  coll("v4-native", algo.genV4Native),
  coll("v7-custom", algo.genV7),
  coll("genoid-v8", algo.genGenoID),
  coll("genoid-structured", genDbkey),
  coll("mathrandom", algo.genMathRandom),
  coll("pg-uuid-v8", genPgUuidV8),
  coll("ulid-v8", genUlidV8),
  coll("ulid", genUlid),
  coll("ksuid", genKsuid),
]

const output: CIBenchmarkResult = { environment: env, baselineName: BASELINE, benchmarks, collisions }

console.log("=== GenoID CI benchmark (deno) ===")
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

const outPath = new URL("../../dist/bench-ci-results.json", import.meta.url)
try {
  await Deno.writeTextFile(outPath, JSON.stringify(output, null, 2))
  console.log(`\nWrote ${outPath}`)
} catch (error) {
  console.error(`Failed to write ${outPath}: ${(error as Error).message}`)
}

const anyCollision = collisions.some((c) => c.collisions > 0)
if (anyCollision) {
  console.error("FAIL: collision detected in CI benchmark")
  Deno.exit(1)
}
