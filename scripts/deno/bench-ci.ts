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

function bench(name: string, fn: () => string): BenchEntry {
  const r: ReturnType<typeof benchRepeated> = benchRepeated(fn, nSync, TRIALS)
  return {
    name,
    opsPerSec: Math.round(r.mean),
    usPerOp: Number(((1_000_000 / r.mean)).toFixed(4)),
    ci95: [Math.round(r.ci95[0]), Math.round(r.ci95[1])],
    std: Math.round(r.std),
    trials: r.trials,
  }
}

function coll(name: string, fn: () => string): CollisionEntry {
  return { name, n: nColl, collisions: collisionTest(fn, nColl) }
}

const env = await collectEnv()

const benchmarks: BenchEntry[] = [
  bench("v4-native", algo.genV4Native),
  bench("v7-custom", algo.genV7),
  bench("genoid-v8", algo.genGenoID),
  bench("mathrandom", algo.genMathRandom),
  bench("pg-uuid-v8", genPgUuidV8),
  bench("ulid", genUlid),
  bench("ulid-v8", genUlidV8),
  bench("ksuid", genKsuid),
  bench("snowflake", genSnowflake),
  bench("genoid-structured", genDbkey),
]

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
  coll("snowflake", genSnowflake),
]

const output: CIBenchmarkResult = { environment: env, benchmarks, collisions }

console.log("=== GenoID CI benchmark (deno) ===")
console.log("Environment:", JSON.stringify(env, null, 2))
console.log("\nBenchmarks (ops/sec, mean ± std, 95% CI):")
for (const b of benchmarks) {
  console.log(
    `  ${b.name.padEnd(14)} ${b.opsPerSec.toString().padStart(10)} ± ${b.std
      .toString()
      .padStart(8)}  CI[${b.ci95[0]}–${b.ci95[1]}]`,
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
