// Bounded-concurrency map: run `fn` over `items` with at most `max` in flight,
// returning results in input order (independent of completion order). This is
// the single concurrency primitive for fanning independent CPU-bound work
// (dieharder invocations, stats batteries, …) across all cores — see AGENTS.md.
export async function mapPool<T, R>(
  items: T[],
  fn: (item: T, index: number) => Promise<R>,
  max: number,
): Promise<R[]> {
  const out = new Array<R>(items.length)
  let cursor = 0
  const worker = async (): Promise<void> => {
    for (;;) {
      const i = cursor++
      if (i >= items.length) break
      out[i] = await fn(items[i], i)
    }
  }
  await Promise.all(Array.from({ length: Math.min(max, items.length) }, worker))
  return out
}
