// Repair-distribution + range-clamp grid (future.md item 5): measured frequencies vs closed-form predictions.

import { mkdirSync, writeFileSync } from "node:fs"

import { mulberry32 } from "./shared/cli-utils.ts"

import { nullValue } from "./shared/runtime-values.ts"

import os from "node:os"

import path from "node:path"

import { pathToFileURL } from "node:url"

const root = path.resolve(import.meta.dirname, "..", "..")

const { rangeClampMass } = (await import(
  pathToFileURL(path.resolve(root, "dist/algo.js")).href
)) as {
  rangeClampMass: (
    ell: number,
    min: number,
    max: number,
  ) => {
    pMin: number

    pMax: number

    pinned: number
  }
}

const N = Number(process.env.REPAIR_GRID_N ?? 200_000)

const OUT = process.env.REPAIR_GRID_OUT ?? "results/repair-grid.json"

const SEED = Math.trunc(Number(process.env.REPAIR_GRID_SEED ?? 0x9E_37_79_B9))

interface GridCell {
  m: number

  ell: number

  draws: number

  predicted: number[]

  measured: number[]

  maxAbsDevPp: number

  chiSquareVsPredicted: number

  pass: boolean
}

interface RangeCell {
  ell: number

  min: number

  max: number

  draws: number

  predictedMin: number

  predictedMax: number

  predictedPinned: number

  measuredMin: number

  measuredMax: number

  maxAbsDevPp: number

  pass: boolean
}

const TOL_PP = 0.5

const cells: GridCell[] = []

const rand = mulberry32(SEED)

for (const ell of [3, 4, 8, 12, 16]) {
  const space = 2 ** ell

  for (const m of [2, 3, 4, 5, 8]) {
    if (m < space) {
      // Predicted fibre sizes from the closed form.

      const fibres = Array.from(
        { length: m },
        (_, i) => Math.floor((space - 1 - i) / m) + 1,
      )

      const predicted = fibres.map((c) => c / space)

      const counts = Array.from<number>({ length: m }).fill(0)

      for (let i = 0; i < N; i += 1) {
        const v = Math.floor(rand() * space)

        counts[v % m] += 1
      }

      const measured = counts.map((c) => c / N)

      let chi = 0

      let maxDev = 0

      for (let i = 0; i < m; i += 1) {
        const expected = N * predicted[i]

        chi += (counts[i] - expected) ** 2 / expected

        maxDev = Math.max(maxDev, Math.abs(measured[i] - predicted[i]) * 100)
      }

      // Chi-square df=m-1; pass bar: max deviation under half a percentage point.

      const pass = maxDev < TOL_PP

      cells.push({
        chiSquareVsPredicted: chi,
        draws: N,
        ell,
        m,
        maxAbsDevPp: maxDev,
        measured,
        pass,
        predicted,
      })

      let status = "FAIL"

      if (pass) {
        status = "PASS"
      }

      console.log(
        `  m=${m} l=${ell}: maxDev ${maxDev.toFixed(4)}pp chi2 ${chi.toFixed(1)} ${status}`,
      )
    }
  }
}

const failed = cells.filter((c) => !c.pass)

// Range-clamp cells: measured endpoint masses vs the shipped clamp bound (includes the over-wide max case).

const rangeCells: RangeCell[] = []

const rangeTriples: [number, number, number][] = [
  [4, 1, 14],

  [8, 10, 245],

  [8, 0, 255],

  [12, 100, 4999],
]

for (const [ell, min, max] of rangeTriples) {
  const space = 2 ** ell

  const lo = Math.max(0, min)

  const hi = Math.min(space - 1, max)

  const {
    pMin: predictedMin,
    pMax: predictedMax,
    pinned: predictedPinned,
  } = rangeClampMass(ell, min, max)

  let atMin = 0

  let atMax = 0

  for (let i = 0; i < N; i += 1) {
    const v = Math.floor(rand() * space)

    let repaired = v

    if (repaired < lo) {
      repaired = lo
    } else if (repaired > hi) {
      repaired = hi
    }

    if (repaired === lo) {
      atMin += 1
    } else if (repaired === hi) {
      atMax += 1
    }
  }

  const measuredMin = atMin / N

  const measuredMax = atMax / N

  const maxDev =
    Math.max(
      Math.abs(measuredMin - predictedMin),
      Math.abs(measuredMax - predictedMax),
    ) * 100

  const pass = maxDev < TOL_PP

  rangeCells.push({
    draws: N,
    ell,
    max,
    maxAbsDevPp: maxDev,
    measuredMax,
    measuredMin,
    min,
    pass,
    predictedMax,
    predictedMin,
    predictedPinned,
  })

  let status = "FAIL"

  if (pass) {
    status = "PASS"
  }

  console.log(
    `  range ell=${ell} [${min},${max}]: maxDev ${maxDev.toFixed(4)}pp ${status}`,
  )
}

const rangeFailed = rangeCells.filter((c) => !c.pass)

const bunVersion = process.versions.bun

let runtime = `Node ${process.version}`

if (typeof bunVersion === "string") {
  runtime = `Bun ${bunVersion}`
}

const report = {
  cells,

  description:
    "Measured index-modulo repair frequencies vs closed-form fibre sizes across (m, ell), plus measured range-clamp endpoint masses vs the closed-form endpoint-accumulation bound across (ell, min, max); validates the uniformity theorem beyond the shard case and the clamp bound on the shipped branch.",

  environment: {
    generatedAt: new Date().toISOString(),

    os: `${os.platform()} ${os.release()} ${os.arch()}`,

    runtime,
  },

  experiment: "repair-distribution-grid",

  rangeCells,

  seed: SEED,

  tolerancePp: TOL_PP,
}

mkdirSync(path.dirname(path.resolve(root, OUT)), { recursive: true })

writeFileSync(
  path.resolve(root, OUT),
  `${JSON.stringify(report, nullValue, 2)}\n`,
)

console.log(
  `\nwrote ${OUT} (${cells.length - failed.length}/${cells.length} fibre cells, ${rangeCells.length - rangeFailed.length}/${rangeCells.length} range cells pass)`,
)

if (failed.length > 0 || rangeFailed.length > 0) {
  process.exitCode = 1
}
