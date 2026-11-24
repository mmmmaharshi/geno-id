/// <reference types="node" />

import assert from "node:assert/strict"
import { test } from "node:test"

import { benchAsyncBatched, collisionTestAsync } from "../../dist/bench-core.js"

// WebKit resolves each awaited SubtleCrypto call in ~15 ms, so the original

// Sequential loop needed ~304 s for 20,000 samples and missed the 300 s run

// Timeout. The batched form must return an identical duplicate count.

const deterministic = (values: readonly string[]): (() => Promise<string>) => {
  let i = 0

  return async (): Promise<string> => {
    await Promise.resolve()

    i += 1

    return values[i % values.length]
  }
}

const unique = (n: number): string[] =>
  Array.from({ length: n }, (_, i) => `id-${i}`)

const withDuplicates = (
  values: readonly string[],
  copies: number
): string[] => {
  const out: string[] = []

  for (const v of values) {
    for (let c = 0; c < copies; c += 1) {
      out.push(v)
    }
  }

  return out
}

void test("a batched async collision count matches a sequential reference", async () => {
  const values = unique(50)

  const batched = await collisionTestAsync(deterministic(values), 500, 64)

  let sequential = 0

  const seen = new Set<string>()

  for (let i = 0; i < 500; i += 1) {
    const v = values[i % values.length]

    if (seen.has(v)) {
      sequential += 1
    } else {
      seen.add(v)
    }
  }

  assert.equal(batched, sequential)

  assert.equal(batched, 450)
})

void test("an all-unique batch reports no collisions at any batch size", async () => {
  const values = unique(77)

  const counts = await Promise.all(
    [1, 7, 1000].map(async (batchSize): Promise<number> => {
      const count = await collisionTestAsync(
        deterministic(values),
        77,
        batchSize
      )

      return count
    })
  )

  for (const [index, count] of counts.entries()) {
    assert.equal(count, 0, `batchSize ${[1, 7, 1000][index]}`)
  }
})

void test("duplicates split across batch boundaries are still counted", async () => {
  // Each value repeated twice, spanning many batches.

  const values = withDuplicates(unique(20), 2)

  const count = await collisionTestAsync(deterministic(values), 40, 3)

  assert.equal(count, 20)
})

void test("the batch size never exceeds the remaining sample count", async () => {
  const values = unique(10)

  let calls = 0

  const counting = async (): Promise<string> => {
    await Promise.resolve()

    calls += 1

    return values[calls % values.length]
  }

  await collisionTestAsync(counting, 10, 4)

  assert.equal(calls, 10)
})

void test("benchAsyncBatched keeps its existing concurrent batching contract", async () => {
  let calls = 0

  const counting = async (): Promise<string> => {
    await Promise.resolve()

    calls += 1

    return `v-${calls}`
  }

  const result = await benchAsyncBatched(counting, 25, 10)

  assert.equal(calls, 25)

  assert.equal(result.n, 25)
})

void test("the async path issues the whole batch concurrently, not one call at a time", async () => {
  // The sequential implementation awaited each call individually, so 20,000

  // WebKit SubtleCrypto calls at ~15 ms each blew the 300 s run timeout. The

  // Batched implementation issues a whole batch concurrently, so the batch

  // Width is the number of calls in flight at once. That is directly

  // Observable, whereas a wall-clock ratio between two sub-millisecond

  // Measurements is noise: the sequential path would show one call in

  // Flight, and any implementation that regressed to sequential awaiting

  // Shows the same.

  const values = unique(50)

  let next = 0

  let inFlight = 0

  let maxInFlight = 0

  const track = async (): Promise<string> => {
    inFlight += 1

    if (inFlight > maxInFlight) {
      maxInFlight = inFlight
    }

    await Promise.resolve()

    inFlight -= 1

    next += 1
    return values[next % values.length]
  }

  await collisionTestAsync(track, 50, 25)

  assert.equal(maxInFlight, 25, "a batch of 25 must run 25 calls concurrently")

  maxInFlight = 0

  await collisionTestAsync(track, 10, 1)

  assert.equal(maxInFlight, 1, "a batch of 1 must run one call at a time")
})
