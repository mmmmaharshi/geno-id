import { once } from "node:events"
import type { Worker } from "node:worker_threads"

// Bounded-concurrency map: run `fn` over `items` with at most `max` in flight,

// Returning results in input order (independent of completion order). This is

// The single concurrency primitive for fanning independent CPU-bound work

// (dieharder invocations, stats batteries, …) across all cores — see AGENTS.md.

export const mapPool = async <T, R>(
  items: readonly T[],

  fn: (item: T, index: number) => Promise<R>,

  max: number
): Promise<R[]> => {
  const out = Array.from<R>({ length: items.length })

  let cursor = 0

  const worker = async (): Promise<void> => {
    const indices = (async function* pendingIndices(): AsyncGenerator<number> {
      await Promise.resolve()

      while (cursor < items.length) {
        const index = cursor

        cursor += 1

        yield index
      }
    })()

    for await (const index of indices) {
      out[index] = await fn(items[index], index)
    }
  }

  await Promise.all(Array.from({ length: Math.min(max, items.length) }, worker))

  return out
}

export const waitForWorkerMessage = async <T>(
  worker: Readonly<Worker>
): Promise<T> => {
  const controller = new AbortController()

  const message = (async (): Promise<{ event: "message"; value: unknown }> => {
    const [value] = (await once(worker, "message", {
      signal: controller.signal,
    })) as [unknown]

    return { event: "message" as const, value }
  })()

  const errorEvent = (async (): Promise<never> => {
    try {
      await once(worker, "error", { signal: controller.signal })

      throw new Error("worker error event did not include an error")
    } catch (error) {
      if (error instanceof Error) {
        throw error
      }

      throw new Error(String(error), { cause: error })
    }
  })()

  const exit = (async (): Promise<{ code: number; event: "exit" }> => {
    const [code] = (await once(worker, "exit", {
      signal: controller.signal,
    })) as [number]

    return { code, event: "exit" as const }
  })()

  try {
    const result = await Promise.race([message, errorEvent, exit])

    if (result.event === "message") {
      return result.value as T
    }

    if (result.code !== 0) {
      throw new Error(`worker exited with code ${result.code}`)
    }

    const [value] = (await once(worker, "message")) as [T]

    return value
  } finally {
    controller.abort()
  }
}
