import { test } from "node:test"
import assert from "node:assert/strict"
import {
  collisionTestAsync,
  benchAsyncBatched,
} from "../dist/bench-core.js"

// WebKit resolves each awaited SubtleCrypto call in ~15 ms, so the original
// sequential loop needed ~304 s for 20,000 samples and missed the 300 s run
// timeout. The batched form must return an identical duplicate count.
const deterministic = (values: readonly string[]): (() => Promise<string>) => {
  let i = 0
  return async () => values[i++ % values.length]
}

const unique = (n: number): string[] =>
  Array.from({ length: n }, (_, i) => `id-${i}`)

const withDuplicates = (values: readonly string[], copies: number): string[] => {
  const out: string[] = []
  for (const v of values) {
    for (let c = 0; c < copies; c++) out.push(v)
  }
  return out
}

test("a batched async collision count matches a sequential reference", async () => {
  const values = unique(50)
  const batched = await collisionTestAsync(deterministic(values), 500, 64)
  let sequential = 0
  const seen = new Set<string>()
  for (let i = 0; i < 500; i++) {
    const v = values[i % values.length]
    if (seen.has(v)) sequential++
    else seen.add(v)
  }
  assert.equal(batched, sequential)
  assert.equal(batched, 450)
})

test("an all-unique batch reports no collisions at any batch size", async () => {
  const values = unique(77)
  for (const batchSize of [1, 7, 1000]) {
    const count = await collisionTestAsync(deterministic(values), 77, batchSize)
    assert.equal(count, 0, `batchSize ${batchSize}`)
  }
})

test("duplicates split across batch boundaries are still counted", async () => {
  // Each value repeated twice, spanning many batches.
  const values = withDuplicates(unique(20), 2)
  const count = await collisionTestAsync(deterministic(values), 40, 3)
  assert.equal(count, 20)
})

test("the batch size never exceeds the remaining sample count", async () => {
  const values = unique(10)
  let calls = 0
  const counting = async () => {
    calls++
    return values[calls % values.length]
  }
  await collisionTestAsync(counting, 10, 4)
  assert.equal(calls, 10)
})

test("benchAsyncBatched keeps its existing concurrent batching contract", async () => {
  let calls = 0
  const counting = async () => {
    calls++
    return `v-${calls}`
  }
  const result = await benchAsyncBatched(counting, 25, 10)
  assert.equal(calls, 25)
  assert.equal(result.n, 25)
})

test("the async collision count agrees with the sync count on identical input", async () => {
  const values = withDuplicates(unique(30), 3)
  const asyncCount = await collisionTestAsync(deterministic(values), 90, 5)
  const set = new Set<string>()
  let syncCount = 0
  for (let i = 0; i < 90; i++) {
    const v = values[i]
    if (set.has(v)) syncCount++
    else set.add(v)
  }
  assert.equal(asyncCount, syncCount)
})

test("the async path stays flat rather than superlinear in sample count", async () => {
  const values = unique(1000)
  const small = await (async () => {
    const t = performance.now()
    await collisionTestAsync(deterministic(values), 200, 200)
    return performance.now() - t
  })()
  const large = await (async () => {
    const t = performance.now()
    await collisionTestAsync(deterministic(values), 1000, 1000)
    return performance.now() - t
  })()
  // The sequential implementation was strictly linear with a ~15 ms per-call
  // WebKit constant, so 5x the samples took 5x the time. Concurrency caps the
  // per-batch cost, so the growth must be strictly sublinear here.
  assert.ok(large < small * 5, `expected sublinear growth, small=${small.toFixed(1)}ms large=${large.toFixed(1)}ms`)
})
