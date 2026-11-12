// Node portability check: measures the structured-vs-base throughput ratio on
// the current runtime to test the paper's V8 prediction (boxed-BigInt penalty
// on V8 <= 13, fixed in v14+). Run under any runtime; the artifact records
// which one produced it.
//
// Usage: node src/scripts/bench-node-portability.ts
//   Env: PORT_N (iterations per trial, default 200000),
//   PORT_TRIALS (repeated trials, default 5),
//   PORT_OUT (default results/node-portability.json)
import { mkdirSync, writeFileSync } from "node:fs"
import os from "node:os"
import path from "node:path"
import { pathToFileURL } from "node:url"

const N = Number(process.env.PORT_N ?? 200_000)
const TRIALS = Math.max(1, Number(process.env.PORT_TRIALS ?? 5))
const OUT = process.env.PORT_OUT ?? "results/node-portability.json"
const root = path.resolve(import.meta.dirname, "..", "..")
const algo = await import(pathToFileURL(path.join(root, "dist", "algo.js")).href)

function bench(label: string, fn: () => unknown): number[] {
  const trials: number[] = []
  for (let t = 0; t < TRIALS; t++) {
    for (let i = 0; i < 1000; i++) fn()
    const start = performance.now()
    for (let i = 0; i < N; i++) fn()
    trials.push(N / ((performance.now() - start) / 1000))
  }
  return trials
}

// Mean +- 95% CI with the small-sample t critical value.
function meanCI(xs: number[]): { mean: number; ci95: [number, number] } {
  const T95: Record<number, number> = { 1: 12.706, 2: 4.303, 3: 3.182, 4: 2.776, 5: 2.571, 6: 2.447, 7: 2.365, 8: 2.306, 9: 2.262 }
  const m = xs.reduce((a, b) => a + b, 0) / xs.length
  if (xs.length < 2) return { mean: m, ci95: [m, m] };
  const sd = Math.sqrt(xs.reduce((a, x) => a + (x - m) ** 2, 0) / (xs.length - 1))
  const t = xs.length - 1 >= 30 ? 1.96 : (T95[xs.length - 1] ?? 1.96)
  const margin = (t * sd) / Math.sqrt(xs.length)
  return { mean: m, ci95: [m - margin, m + margin] }
}

const v4 = meanCI(bench("v4", () => algo.genV4Native()))
const base = meanCI(bench("base", () => algo.genGenoID()))
const structured = meanCI(bench("structured", () => algo.genStructuredGenoID(algo.DBKEY_LAYOUT)))

const report = {
  experiment: "node-portability",
  description: "structured-vs-base throughput ratio on the executing runtime (repeated trials, mean +- 95% CI); tests the V8 v13 boxed-BigInt prediction",
  n: N,
  trials: TRIALS,
  versions: {
    runtime: process.versions.bun ? `Bun ${process.versions.bun}` : `Node ${process.version}`,
    v8: (process.versions as Record<string, string>).v8 ?? "unknown",
  },
  opsPerSec: { v4, base, structured },
  structuredOverBase: structured.mean / base.mean,
  structuredOverBaseCI95: [structured.ci95[0] / base.ci95[1], structured.ci95[1] / base.ci95[0]],
  environment: { os: `${os.platform()} ${os.release()} ${os.arch()}`, generatedAt: new Date().toISOString() },
}
mkdirSync(path.dirname(path.resolve(root, OUT)), { recursive: true })
writeFileSync(path.resolve(root, OUT), `${JSON.stringify(report, null, 2)}\n`)
console.log(`wrote ${OUT} (structured/base ${report.structuredOverBase.toFixed(2)} CI [${report.structuredOverBaseCI95.map((x) => x.toFixed(2)).join(", ")}])`)
