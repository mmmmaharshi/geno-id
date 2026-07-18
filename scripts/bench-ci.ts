import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import {
  benchSync,
  collisionTest,
} from "../dist/bench-core.js"
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

const algo = await import(path.resolve(root, "dist/algo.js"))
const { genV4Native, genV7, genMathRandom, genGenoID } =
  algo as {
    genV4Native: () => string
    genV7: () => string
    genMathRandom: () => string
    genGenoID: () => string
  }

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

function bench(name: string, fn: () => string): BenchEntry {
  const r = benchSync(fn, nSync)
  return {
    name,
    opsPerSec: Math.round(r.opsPerSec),
    usPerOp: Number(((r.elapsed / r.n) * 1000).toFixed(4)),
  }
}

function coll(name: string, fn: () => string): CollisionEntry {
  return { name, n: nColl, collisions: collisionTest(fn, nColl) }
}

const env = collectEnv()

const benchmarks: BenchEntry[] = [
  bench("v4-native", genV4Native),
  bench("v7-custom", genV7),
  bench("genoid-v8", genGenoID),
  bench("mathrandom", genMathRandom),
  bench("pg-uuid-v8", genPgUuidV8),
  bench("ulid", genUlid),
  bench("ulid-v8", genUlidV8),
  bench("ksuid", genKsuid),
  bench("snowflake", genSnowflake),
]

const collisions: CollisionEntry[] = [
  coll("v4-native", genV4Native),
  coll("v7-custom", genV7),
  coll("genoid-v8", genGenoID),
  coll("mathrandom", genMathRandom),
  coll("pg-uuid-v8", genPgUuidV8),
  coll("ulid-v8", genUlidV8),
]

const output: CIBenchmarkResult = { environment: env, benchmarks, collisions }

console.log("=== GenoID CI benchmark ===")
console.log("Environment:", JSON.stringify(env, null, 2))
console.log("\nBenchmarks (ops/sec):")
for (const b of benchmarks) {
  console.log(`  ${b.name.padEnd(14)} ${b.opsPerSec.toString().padStart(10)}  ${b.usPerOp} us/op`)
}
console.log("\nCollisions:")
for (const c of collisions) {
  console.log(`  ${c.name.padEnd(14)} n=${c.n}  collisions=${c.collisions}  PASS=${c.collisions === 0}`)
}

const outPath = path.resolve(root, "dist/bench-ci-results.json")
fs.writeFileSync(outPath, JSON.stringify(output, null, 2))
console.log(`\nWrote ${outPath}`)

const anyCollision = collisions.some((c) => c.collisions > 0)
if (anyCollision) {
  console.error("FAIL: collision detected in CI benchmark")
  process.exit(1)
}
