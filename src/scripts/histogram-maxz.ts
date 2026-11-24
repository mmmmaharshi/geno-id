import { readFileSync, writeFileSync } from "node:fs"
import { nullValue } from "./shared/runtime-values.ts"
import path from "node:path"

// Stays TypeScript (not a scipy one-liner) on purpose: analyzeHistogram is
// Imported by histogram-maxz.test.ts, which fails the gate if the archived
// Artifact drifts — a Python step could not serve as that seam.

export interface MaxzResult {
  cells: number
  maxAbsZ: number
  bonferroniCritical: number
  sidakCritical: number
  significantBonferroni: boolean
  significantSidak: boolean
  bonferroniP: number
}

const normalCdf = (x: number): number => {
  const t = 1 / (1 + 0.2316419 * Math.abs(x))
  const poly =
    t *
    (0.31938153 +
      t *
        (-0.356563782 +
          t * (1.781477937 + t * (-1.821255978 + t * 1.330274429))))
  const tail = (Math.exp(-0.5 * x * x) / Math.sqrt(2 * Math.PI)) * poly
  if (x >= 0) {
    return 1 - tail
  }
  return tail
}

const inverseNormalCdf = (p: number): number => {
  const a = [
    -39.69683028665376, 220.9460984245205, -275.9285104469687, 138.357751867269,
    -30.66479806614716, 2.506628277459239,
  ]
  const b = [
    -54.47609879822406, 161.585836580409, -155.6989798598866, 66.80131188771972,
    -13.28068155288572,
  ]
  const c = [
    -0.007784894002430293, -0.3223964580411365, -2.400758277161838,
    -2.549732539343734, 4.374664141464968, 2.938163982698783,
  ]
  const d = [
    0.007784695709041462, 0.3224671290700398, 2.445134137142996,
    3.754408661907416,
  ]
  if (p < 0.02425) {
    const q = Math.sqrt(-2 * Math.log(p))
    return (
      (((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) /
      ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1)
    )
  }
  if (p > 1 - 0.02425) {
    const q = Math.sqrt(-2 * Math.log(1 - p))
    return -(
      (((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) /
      ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1)
    )
  }
  const q = p - 0.5
  const r = q * q
  return (
    ((((((a[0] * r + a[1]) * r + a[2]) * r + a[3]) * r + a[4]) * r + a[5]) *
      q) /
    (((((b[0] * r + b[1]) * r + b[2]) * r + b[3]) * r + b[4]) * r + 1)
  )
}

export const maxzAnalysis = (zScores: number[], alpha = 0.05): MaxzResult => {
  const m = zScores.length
  const maxAbsZ = Math.max(...zScores.map((value) => Math.abs(value)))
  const bonferroniCritical = inverseNormalCdf(1 - alpha / (2 * m))
  const sidakCritical = inverseNormalCdf(1 - (1 - (1 - alpha) ** (1 / m)) / 2)
  const bonferroniP = Math.min(1, m * 2 * (1 - normalCdf(maxAbsZ)))
  return {
    bonferroniCritical,
    bonferroniP,
    cells: m,
    maxAbsZ,
    sidakCritical,
    significantBonferroni: maxAbsZ > bonferroniCritical,
    significantSidak: maxAbsZ > sidakCritical,
  }
}

export interface HistogramAnalysis extends MaxzResult {
  alphaFamilyWise: number
  description: string
  drawsPerLayout: number
  experiment: string
  perField: { cells: number; field: string; layout: string; maxAbsZ: number }[]
  sourceArtifact: string
  verdict: string
}

interface Cell {
  value: number
  count: number
  observed_pp: number
  predicted_pp: number
  abs_dev_pp: number
  sampling_sd_pp: number
  z: number
}

const root = path.resolve(import.meta.dirname, "..", "..")

export const analyzeHistogram = (
  histogramPath = path.join(root, "results", "shard-histogram-100m.json"),
): HistogramAnalysis => {
  const histogram = JSON.parse(readFileSync(histogramPath, "utf8")) as {
    draws_per_layout: number
    per_layout: Record<string, {
      fields: { field: string; counts: Cell[]; max_abs_z: number }[]
    }>
  }

  const perField: {
    layout: string
    field: string
    cells: number
    maxAbsZ: number
    zs: number[]
  }[] = []
  const allZ: number[] = []
  for (const [layout, entry] of Object.entries(histogram.per_layout)) {
    for (const f of entry.fields) {
      const zs = f.counts.map((c) => c.z)
      allZ.push(...zs)
      perField.push({
        cells: zs.length,
        field: f.field,
        layout,
        maxAbsZ: Math.max(...zs.map((value) => Math.abs(value))),
        zs,
      })
    }
  }

  const result = maxzAnalysis(allZ)
  let verdict = "consistent with sampling noise"
  if (result.significantBonferroni || result.significantSidak) {
    verdict = "deviation"
  }
  return Object.fromEntries([
    ["bonferroniCritical", result.bonferroniCritical],
    ["bonferroniP", result.bonferroniP],
    ["cells", result.cells],
    ["maxAbsZ", result.maxAbsZ],
    ["sidakCritical", result.sidakCritical],
    ["significantBonferroni", result.significantBonferroni],
    ["significantSidak", result.significantSidak],
    ["alphaFamilyWise", 0.05],
    [
      "description",
      "Family-wise max-|z| assessment of the archived 10^8 histogram cells (Bonferroni + Sidak); no new draws",
    ],
    ["drawsPerLayout", histogram.draws_per_layout],
    ["experiment", "shard-histogram-100m-maxz"],
    [
      "perField",
      perField.map(({ layout, field, cells, maxAbsZ }) => ({
        cells,
        field,
        layout,
        maxAbsZ,
      })),
    ],
    ["sourceArtifact", "results/shard-histogram-100m.json"],
    ["verdict", verdict],
  ]) as HistogramAnalysis
}

if (import.meta.main) {
  const report = analyzeHistogram()
  const out = path.join(root, "results", "shard-histogram-100m.maxz.json")
  writeFileSync(out, `${JSON.stringify(report, nullValue, 2)}\n`)

  console.log(
    `cells=${report.cells} max|z|=${report.maxAbsZ.toFixed(3)} Bonferroni crit=${report.bonferroniCritical.toFixed(3)} Sidak crit=${report.sidakCritical.toFixed(3)} Bonferroni p=${report.bonferroniP.toFixed(3)} verdict=${report.verdict}`,
  )
  for (const f of report.perField) {
    console.log(
      `  ${f.layout}.${f.field}: cells=${f.cells} max|z|=${f.maxAbsZ.toFixed(3)}`,
    )
  }
  console.log(`wrote results/shard-histogram-100m.maxz.json`)
}
