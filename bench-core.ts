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
