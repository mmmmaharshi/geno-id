// Node portability check: measures the structured-vs-base throughput ratio on

// The current runtime to test the paper's V8 prediction (boxed-BigInt penalty

// On V8 <= 13, fixed in v14+). Run under any runtime; the artifact records

// Which one produced it.

//

// Usage: node src/scripts/bench-node-portability.ts

//   Env: PORT_N (iterations per trial, default 200000),

//   PORT_TRIALS (repeated trials, default 5),

//   PORT_OUT (default results/node-portability.json)

import { mkdirSync, writeFileSync } from "node:fs"

import { nullValue } from "./shared/runtime-values.ts"

import os from "node:os"

import path from "node:path"

import { pathToFileURL } from "node:url"

const N = Number(process.env.PORT_N ?? 200_000)

const TRIALS = Math.max(1, Number(process.env.PORT_TRIALS ?? 5))

const OUT = process.env.PORT_OUT ?? "results/node-portability.json"

const root = path.resolve(import.meta.dirname, "..", "..")

const algo = (await import(
  pathToFileURL(path.join(root, "dist", "algo.js")).href
)) as {
  genV4Native: () => string

  genGenoID: () => string

  genStructuredGenoID: (layout: unknown) => string

  DBKEY_LAYOUT: unknown
}

const bench = (label: string, fn: () => unknown): number[] => {
  const trials: number[] = []

  for (let t = 0; t < TRIALS; t += 1) {
    for (let i = 0; i < 1000; i += 1) {
      fn()
    }

    const start = performance.now()

    for (let i = 0; i < N; i += 1) {
      fn()
    }

    trials.push(N / ((performance.now() - start) / 1000))
  }

  return trials
}

// Mean +- 95% CI with the small-sample t critical value.

const meanCI = (xs: number[]): { mean: number; ci95: [number, number] } => {
  const T95: Record<number, number> = {
    1: 12.706,
    2: 4.303,
    3: 3.182,
    4: 2.776,
    5: 2.571,
    6: 2.447,
    7: 2.365,
    8: 2.306,
    9: 2.262,
  }

  const m = xs.reduce((a, b) => a + b, 0) / xs.length

  if (xs.length < 2) {
    return { ci95: [m, m], mean: m }
  }

  const sd = Math.sqrt(
    xs.reduce((a, x) => a + (x - m) ** 2, 0) / (xs.length - 1),
  )

  let t = 1.96

  if (xs.length - 1 < 30) {
    t = T95[xs.length - 1] ?? 1.96
  }

  const margin = (t * sd) / Math.sqrt(xs.length)

  return { ci95: [m - margin, m + margin], mean: m }
}

const v4 = meanCI(bench("v4", () => algo.genV4Native()))

const base = meanCI(bench("base", () => algo.genGenoID()))

const structured = meanCI(
  bench("structured", () => algo.genStructuredGenoID(algo.DBKEY_LAYOUT)),
)

const bunVersion = process.versions.bun

let runtime = `Node ${process.version}`

if (typeof bunVersion === "string") {
  runtime = `Bun ${bunVersion}`
}

const report = {
  description:
    "structured-vs-base throughput ratio on the executing runtime (repeated trials, mean +- 95% CI); tests the V8 v13 boxed-BigInt prediction",

  environment: {
    generatedAt: new Date().toISOString(),
    os: `${os.platform()} ${os.release()} ${os.arch()}`,
  },

  experiment: "node-portability",

  n: N,

  opsPerSec: { base, structured, v4 },

  structuredOverBase: structured.mean / base.mean,

  structuredOverBaseCI95: [
    structured.ci95[0] / base.ci95[1],
    structured.ci95[1] / base.ci95[0],
  ],

  trials: TRIALS,

  versions: {
    runtime,

    v8: process.versions.v8,
  },
}

mkdirSync(path.dirname(path.resolve(root, OUT)), { recursive: true })

writeFileSync(
  path.resolve(root, OUT),
  `${JSON.stringify(report, nullValue, 2)}\n`,
)

console.log(
  `wrote ${OUT} (structured/base ${report.structuredOverBase.toFixed(2)} CI [${report.structuredOverBaseCI95.map((x) => x.toFixed(2)).join(", ")}])`,
)
