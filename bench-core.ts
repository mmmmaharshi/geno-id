export interface BenchResult {
  n: number
  elapsed: number
  opsPerSec: number
}

export function benchSync(fn: () => string, n: number): BenchResult {
  const start = performance.now()
  for (let i = 0; i < n; i++) {
    fn()
  }
  const elapsed = performance.now() - start
  return { n, elapsed, opsPerSec: n / (elapsed / 1000) }
}

export async function benchAsyncBatched(
  fn: () => Promise<string>,
  n: number,
  batchSize = 1000,
): Promise<BenchResult> {
  const start = performance.now()
  let done = 0
  while (done < n) {
    const b = Math.min(batchSize, n - done)
    await Promise.all(Array.from({ length: b }, () => fn()))
    done += b
  }
  const elapsed = performance.now() - start
  return { n, elapsed, opsPerSec: n / (elapsed / 1000) }
}

export function birthdayBound50(entropyBits: number): number {
  const N = Math.pow(2, entropyBits)
  return 1.1774 * Math.sqrt(N)
}

export function collisionTest(fn: () => string, n: number): number {
  const set = new Set<string>()
  let collisions = 0
  for (let i = 0; i < n; i++) {
    const v = fn()
    if (set.has(v)) collisions++
    else set.add(v)
  }
  return collisions
}

export async function collisionTestAsync(
  fn: () => Promise<string>,
  n: number,
): Promise<number> {
  const set = new Set<string>()
  let collisions = 0
  for (let i = 0; i < n; i++) {
    const v = await fn()
    if (set.has(v)) collisions++
    else set.add(v)
  }
  return collisions
}

// ---------------------------------------------------------------------------
// Repeated-trial statistics + significance testing.
//
// Every throughput benchmark runs a single trial in the old code, so the
// printed ops/sec is a point estimate with no error bounds. The functions
// below turn a benchmark into N repeated trials and expose the summary
// statistics (mean / std / CV / 95% CI) plus a Welch t-test so we can say
// whether two generators are statistically distinguishable.
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

export function benchRepeated(fn: () => string, n: number, trials = 10): BenchStats {
  const samples = Array.from({ length: trials }, () => benchSync(fn, n).opsPerSec)
  return summarize(samples, n, trials)
}

export async function benchRepeatedAsync(
  fn: () => Promise<string>,
  n: number,
  trials = 10,
  batchSize = 1000,
): Promise<BenchStats> {
  const samples = []
  for (let i = 0; i < trials; i++) {
    samples.push((await benchAsyncBatched(fn, n, batchSize)).opsPerSec)
  }
  return summarize(samples, n, trials)
}

function summarize(samples: number[], n: number, trials: number): BenchStats {
  const m = samples.reduce((a, b) => a + b, 0) / trials
  const v =
    trials > 1 ? samples.reduce((a, x) => a + (x - m) ** 2, 0) / (trials - 1) : 0
  const std = Math.sqrt(v)
  const cv = m > 0 ? std / m : 0
  const min = Math.min(...samples)
  const max = Math.max(...samples)
  const se = trials > 1 ? std / Math.sqrt(trials) : 0
  const margin = studentTCritical95(trials - 1) * se
  return {
    n,
    trials,
    mean: m,
    std,
    cv,
    min,
    max,
    ci95: [m - margin, m + margin],
    samples,
  }
}

// Upper 0.025 quantile (two-tailed 95% CI critical value) for Student's t.
// Exact for small integer degrees of freedom; normal approximation (1.96) beyond.
const T_CRIT_95: Record<number, number> = {
  1: 12.706, 2: 4.303, 3: 3.182, 4: 2.776, 5: 2.571, 6: 2.447,
  7: 2.365, 8: 2.306, 9: 2.262, 10: 2.228, 11: 2.201, 12: 2.179,
  13: 2.16, 14: 2.145, 15: 2.131, 19: 2.093, 29: 2.045,
}

function studentTCritical95(df: number): number {
  if (df <= 0) return 0
  if (df >= 30) return 1.96
  return T_CRIT_95[df] ?? 1.96
}
