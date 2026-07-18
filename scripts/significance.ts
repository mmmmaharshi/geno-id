// Significance testing for benchmark comparisons.
//
// Pure statistics module (no top-level side effects, so it can be imported by
// other scripts without running anything). It turns two sets of repeated-trial
// samples into a Welch t-test result plus Cohen's d effect size, so we can
// state whether two UUID generators are statistically distinguishable rather
// than eyeballing single-run point estimates.
//
// The p-value needs the Student-t CDF, computed via the regularized incomplete
// beta identity P(|T| > |t|) = I_{ df/(df+t^2) }(df/2, 1/2), with a Lanczos
// log-gamma and the Numerical Recipes continued fraction for I_x.

import type { BenchStats } from "../dist/bench-core.js"

export interface WelchResult {
  t: number
  df: number
  /** Two-tailed p-value. */
  p: number
}

export interface CompareResult {
  t: number
  df: number
  p: number
  /** Cohen's d (pooled effect size). */
  d: number
}

export function welchTTest(a: number[], b: number[]): WelchResult {
  const na = a.length
  const nb = b.length
  const ma = meanOf(a)
  const mb = meanOf(b)
  const va = varianceOf(a)
  const vb = varianceOf(b)
  if (va + vb === 0) return { t: 0, df: Math.max(1, na + nb - 2), p: 1 }
  const se = Math.sqrt(va / na + vb / nb)
  const t = (ma - mb) / se
  const df = (va / na + vb / nb) ** 2 /
    ((va / na) ** 2 / (na - 1) + (vb / nb) ** 2 / (nb - 1))
  return { t, df, p: studentTwoTailedP(t, df) }
}

export function cohensD(a: number[], b: number[]): number {
  const na = a.length
  const nb = b.length
  const pooled = Math.sqrt(((na - 1) * varianceOf(a) + (nb - 1) * varianceOf(b)) / (na + nb - 2))
  if (pooled === 0) return 0
  return (meanOf(a) - meanOf(b)) / pooled
}

export function compareBench(a: BenchStats, b: BenchStats): CompareResult {
  const w = welchTTest(a.samples, b.samples)
  return { ...w, d: cohensD(a.samples, b.samples) }
}

// --- numeric helpers -------------------------------------------------------

function meanOf(xs: number[]): number {
  return xs.reduce((a, b) => a + b, 0) / xs.length
}

function varianceOf(xs: number[]): number {
  const n = xs.length
  if (n < 2) return 0
  const m = meanOf(xs)
  return xs.reduce((a, x) => a + (x - m) ** 2, 0) / (n - 1)
}

function studentTwoTailedP(t: number, df: number): number {
  const x = df / (df + t * t)
  return betai(x, df / 2, 0.5)
}

// Regularized incomplete beta I_x(a, b) via the continued fraction (Numerical
// Recipes betacf) with a Lanczos log-gamma for the prefactor.
function betai(x: number, a: number, b: number): number {
  if (x <= 0) return 0
  if (x >= 1) return 1
  const prefactor =
    Math.exp(Math.log(x) * a + Math.log(1 - x) * b - lgamma(a) - lgamma(b) + lgamma(a + b)) / a
  return prefactor * betacf(x, a, b)
}

function betacf(x: number, a: number, b: number): number {
  const MAXIT = 200
  const EPS = 3e-12
  const FPMIN = 1e-300
  const qab = a + b
  const qap = a + 1
  const qam = a - 1
  let c = 1
  let d = 1 - (qab * x) / qap
  if (Math.abs(d) < FPMIN) d = FPMIN
  d = 1 / d
  let h = d
  for (let m = 1; m <= MAXIT; m++) {
    const m2 = 2 * m
    let aa = (m * (b - m) * x) / ((qam + m2) * (a + m2))
    d = 1 + aa * d
    if (Math.abs(d) < FPMIN) d = FPMIN
    c = 1 + aa / c
    if (Math.abs(c) < FPMIN) c = FPMIN
    d = 1 / d
    h *= d * c
    aa = (-(a + m) * (qab + m) * x) / ((a + m2) * (qap + m2))
    d = 1 + aa * d
    if (Math.abs(d) < FPMIN) d = FPMIN
    c = 1 + aa / c
    if (Math.abs(c) < FPMIN) c = FPMIN
    d = 1 / d
    const del = d * c
    h *= del
    if (Math.abs(del - 1) < EPS) break
  }
  return h
}

const LANCZOS = [
  0.99999999999980993, 676.5203681218851, -1259.1392167224028,
  771.32342877765313, -176.61502916214059, 12.507343278686905,
  -0.13857109526572012, 9.9843695780195716e-6, 1.5056327351493116e-7,
]

function lgamma(x: number): number {
  if (x < 0.5) {
    return Math.log(Math.PI / Math.sin(Math.PI * x)) - lgamma(1 - x)
  }
  const y = x - 1
  let a = LANCZOS[0]
  const t = y + 7 + 0.5
  for (let i = 1; i < 9; i++) a += LANCZOS[i] / (y + i)
  return 0.5 * Math.log(2 * Math.PI) + (y + 0.5) * Math.log(t) - t + Math.log(a)
}
