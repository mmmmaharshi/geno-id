export interface BenchResult {
  n: number
  elapsed: number
  opsPerSec: number
}

export const benchSync = (fn: () => string, n: number): BenchResult => {
  if (n <= 0) {
    return { elapsed: 0, n, opsPerSec: 0 }
  }
  let sink = 0
  const start = performance.now()
  for (let i = 0; i < n; i += 1) {
    sink += fn().codePointAt(0) ?? 0
  }
  const elapsed = performance.now() - start
  if (sink === -1) {
    throw new Error("unreachable")
  }
  return { elapsed, n, opsPerSec: n / (elapsed / 1000) }
}

export const benchAsyncBatched = async (
  fn: () => Promise<string>,
  n: number,
  batchSize = 1000
): Promise<BenchResult> => {
  const start = performance.now()
  const runBatch = async (done: number): Promise<void> => {
    if (done >= n) {
      return
    }
    const b = Math.min(batchSize, n - done)
    const pending: Promise<string>[] = []
    Array.from({ length: b }, () => pending.push(fn()))
    await Promise.all(pending)
    return runBatch(done + b)
  }
  await runBatch(0)
  const elapsed = performance.now() - start
  return { elapsed, n, opsPerSec: n / (elapsed / 1000) }
}

export const birthdayBound50 = (entropyBits: number): number => {
  if (entropyBits <= 0) {
    return 0
  }
  const spaceSize = 2 ** entropyBits
  return 1.1774 * Math.sqrt(spaceSize)
}

export const collisionTest = (fn: () => string, n: number): number => {
  const set = new Set<string>()
  let collisions = 0
  for (let i = 0; i < n; i += 1) {
    const v = fn()
    if (set.has(v)) {
      collisions += 1
    } else {
      set.add(v)
    }
  }
  return collisions
}

export const collisionTestAsync = async (
  fn: () => Promise<string>,
  n: number,
  batchSize = 1000
): Promise<number> => {
  // WebCrypto is awaited one call at a time in the sequential form, and
  // Playwright's WebKit build resolves each SubtleCrypto call in ~15 ms.
  // 20,000 sequential calls therefore take ~304 s and blow the 300 s run
  // Timeout, so the batch is issued concurrently and the duplicate count is
  // Taken over the completed set. The count is order-independent, so the
  // Result is unchanged.
  const set = new Set<string>()
  let collisions = 0
  const runBatch = async (done: number): Promise<number> => {
    if (done >= n) {
      return collisions
    }
    const b = Math.min(batchSize, n - done)
    const pending: Promise<string>[] = []
    Array.from({ length: b }, () => pending.push(fn()))
    const batch = await Promise.all(pending)
    for (const v of batch) {
      if (set.has(v)) {
        collisions += 1
      } else {
        set.add(v)
      }
    }
    return runBatch(done + b)
  }
  const count = await runBatch(0)
  return count
}

// ---------------------------------------------------------------------------
// Repeated-trial statistics + significance testing.
//
// Every throughput benchmark runs a single trial in the old code, so the
// Printed ops/sec is a point estimate with no error bounds. The functions
// Below turn a benchmark into N repeated trials and expose the summary
// Statistics (mean / std / CV / 95% CI) plus a Welch t-test so we can say
// Whether two generators are statistically distinguishable.
// ---------------------------------------------------------------------------

export interface BenchStats {
  /** Inner sample size per trial (e.g. 500_000 IDs generated). */
  n: number
  /** Number of repeated trials. */
  trials: number
  mean: number
  /** Sample standard deviation (n − 1). */
  std: number
  /** Coefficient of variation (std / mean). */
  cv: number
  min: number
  max: number
  /** 95% confidence interval of the mean, [lower, upper]. */
  ci95: [number, number]
  /** Raw per-trial ops/sec values. */
  samples: number[]
}

// Upper 0.025 quantile (two-tailed 95% CI critical value) for Student's t.
// Exact for small integer degrees of freedom; normal approximation (1.96) beyond.
const T_CRIT_95: Record<number, number> = {
  1: 12.706,
  10: 2.228,
  11: 2.201,
  12: 2.179,
  13: 2.16,
  14: 2.145,
  15: 2.131,
  16: 2.12,
  17: 2.11,
  18: 2.101,
  19: 2.093,
  2: 4.303,
  20: 2.086,
  21: 2.08,
  22: 2.074,
  23: 2.069,
  24: 2.064,
  25: 2.06,
  26: 2.056,
  27: 2.052,
  28: 2.048,
  29: 2.045,
  3: 3.182,
  4: 2.776,
  5: 2.571,
  6: 2.447,
  7: 2.365,
  8: 2.306,
  9: 2.262,
}

const studentTCritical95 = (df: number): number => {
  if (df <= 0) {
    return 0
  }
  if (df >= 30) {
    return 1.96
  }
  return T_CRIT_95[df] ?? 1.96
}

const summarize = (
  samples: number[],
  n: number,
  trials: number
): BenchStats => {
  const mean = samples.reduce((a, b) => a + b, 0) / trials
  let variance = 0
  if (trials > 1) {
    variance =
      samples.reduce((total, sample) => total + (sample - mean) ** 2, 0) /
      (trials - 1)
  }
  const std = Math.sqrt(variance)
  let cv = 0
  if (mean > 0) {
    cv = std / mean
  }
  const min = Math.min(...samples)
  const max = Math.max(...samples)
  let standardError = 0
  if (trials > 1) {
    standardError = std / Math.sqrt(trials)
  }
  const margin = studentTCritical95(trials - 1) * standardError
  return {
    ci95: [mean - margin, mean + margin],
    cv,
    max,
    mean,
    min,
    n,
    samples,
    std,
    trials,
  }
}

export const benchRepeated = (
  fn: () => string,
  n: number,
  trials = 10,
  warmupTrials = 3
): BenchStats => {
  // Discard warmup pass(es): the first run pays JIT compilation (and any
  // Lazy one-time allocation) which would inflate variance and bias the mean
  // Low. Only the steady-state trials are summarized.
  for (let i = 0; i < warmupTrials; i += 1) {
    benchSync(fn, n)
  }
  const samples = Array.from(
    { length: trials },
    () => benchSync(fn, n).opsPerSec
  )
  return summarize(samples, n, trials)
}

export const benchRepeatedAsync = async (
  fn: () => Promise<string>,
  n: number,
  trials = 10,
  batchSize = 1000
): Promise<BenchStats> => {
  const samples: number[] = []
  const runTrial = async (trial: number): Promise<void> => {
    if (trial >= trials) {
      return
    }
    const result = await benchAsyncBatched(fn, n, batchSize)
    samples.push(result.opsPerSec)
    return runTrial(trial + 1)
  }
  await runTrial(0)
  return summarize(samples, n, trials)
}
