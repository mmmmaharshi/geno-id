import { readFileSync, writeFileSync } from "node:fs"
import path from "node:path"

// Stays TypeScript (not a scipy one-liner) on purpose: analyzeHistogram is
// imported by histogram-maxz.test.ts, which fails the gate if the archived
// artifact drifts — a Python step could not serve as that seam.

export interface MaxzResult {
  cells: number
  maxAbsZ: number
  bonferroniCritical: number
  sidakCritical: number
  significantBonferroni: boolean
  significantSidak: boolean
  bonferroniP: number
}

function normalCdf(x: number): number {
  const t = 1 / (1 + 0.2316419 * Math.abs(x))
  const poly = t * (0.31938153 + t * (-0.356563782 + t * (1.781477937 + t * (-1.821255978 + t * 1.330274429))))
  const tail = (Math.exp(-0.5 * x * x) / Math.sqrt(2 * Math.PI)) * poly
  return x >= 0 ? 1 - tail : tail
}

function inverseNormalCdf(p: number): number {
  const a = [-39.69683028665376, 220.9460984245205, -275.9285104469687, 138.357751867269, -30.66479806614716, 2.506628277459239]
  const b = [-54.47609879822406, 161.585836580409, -155.6989798598866, 66.80131188771972, -13.28068155288572]
  const c = [-0.007784894002430293, -0.3223964580411365, -2.400758277161838, -2.549732539343734, 4.374664141464968, 2.938163982698783]
  const d = [0.007784695709041462, 0.3224671290700398, 2.445134137142996, 3.754408661907416]
  if (p < 0.02425) {
    const q = Math.sqrt(-2 * Math.log(p))
    return (((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) / ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1)
  }
  if (p > 1 - 0.02425) {
    const q = Math.sqrt(-2 * Math.log(1 - p))
    return -((((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) / ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1))
  }
  const q = p - 0.5
  const r = q * q
  return ((((((a[0] * r + a[1]) * r + a[2]) * r + a[3]) * r + a[4]) * r + a[5]) * q) / (((((b[0] * r + b[1]) * r + b[2]) * r + b[3]) * r + b[4]) * r + 1)
}

export function maxzAnalysis(zScores: number[], alpha = 0.05): MaxzResult {
  const m = zScores.length
  const maxAbsZ = Math.max(...zScores.map(Math.abs))
  const bonferroniCritical = inverseNormalCdf(1 - alpha / (2 * m))
  const sidakCritical = inverseNormalCdf(1 - (1 - (1 - alpha) ** (1 / m)) / 2)
  const bonferroniP = Math.min(1, m * 2 * (1 - normalCdf(maxAbsZ)))
  return {
    cells: m,
    maxAbsZ,
    bonferroniCritical,
    sidakCritical,
    significantBonferroni: maxAbsZ > bonferroniCritical,
    significantSidak: maxAbsZ > sidakCritical,
    bonferroniP,
  }
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

export function analyzeHistogram(histogramPath = path.join(root, "results", "shard-histogram-100m.json")) {
  const histogram = JSON.parse(readFileSync(histogramPath, "utf-8")) as {
    draws_per_layout: number
    per_layout: Record<string, { fields: { field: string; counts: Cell[]; max_abs_z: number }[] }>
  }

  const perField: { layout: string; field: string; cells: number; maxAbsZ: number; zs: number[] }[] = []
  const allZ: number[] = []
  for (const [layout, entry] of Object.entries(histogram.per_layout)) {
    for (const f of entry.fields) {
      const zs = f.counts.map((c) => c.z)
      allZ.push(...zs)
      perField.push({ layout, field: f.field, cells: zs.length, maxAbsZ: Math.max(...zs.map(Math.abs)), zs })
    }
  }

  const result = maxzAnalysis(allZ)
  return {
    experiment: "shard-histogram-100m-maxz",
    description:
      "Family-wise max-|z| assessment of the archived 10^8 histogram cells (Bonferroni + Sidak); no new draws",
    sourceArtifact: "results/shard-histogram-100m.json",
    drawsPerLayout: histogram.draws_per_layout,
    alphaFamilyWise: 0.05,
    ...result,
    verdict: result.significantBonferroni || result.significantSidak ? "deviation" : "consistent with sampling noise",
    perField: perField.map(({ layout, field, cells, maxAbsZ }) => ({ layout, field, cells, maxAbsZ })),
  }
}

if (import.meta.main) {
const report = analyzeHistogram()
const out = path.join(root, "results", "shard-histogram-100m.maxz.json")
writeFileSync(out, `${JSON.stringify(report, null, 2)}\n`)

console.log(`cells=${report.cells} max|z|=${report.maxAbsZ.toFixed(3)} Bonferroni crit=${report.bonferroniCritical.toFixed(3)} Sidak crit=${report.sidakCritical.toFixed(3)} Bonferroni p=${report.bonferroniP.toFixed(3)} verdict=${report.verdict}`)
for (const f of report.perField) {
  console.log(`  ${f.layout}.${f.field}: cells=${f.cells} max|z|=${f.maxAbsZ.toFixed(3)}`)
}
console.log(`wrote results/shard-histogram-100m.maxz.json`)
}
