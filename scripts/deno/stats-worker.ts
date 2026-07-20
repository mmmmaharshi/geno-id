// Worker (Deno Web Worker): runs one randomness battery on a single CPU core.
// Driven by `stats.ts`, which fans the 5 generator batteries out across all cores.
import { runBattery, type RunDef } from "./stats-core.ts"

const algo = (await import("../../dist/algo.js")) as {
  genGenoID: () => string
  genV4Native: () => string
  genV7: () => string
  genMathRandom: () => string
  genHashUUID: () => Promise<string>
}

const FUNCS = {
  genoid: algo.genGenoID,
  v4: algo.genV4Native,
  v7: algo.genV7,
  mr: algo.genMathRandom,
  hash: algo.genHashUUID,
} as const

// Deno Web Workers receive data via postMessage (no workerData/parentPort).
const ctx = self as unknown as Worker
ctx.addEventListener("message", (e: MessageEvent<RunDef>) => {
  const { id, label, mask, n } = e.data
  if (!Object.hasOwn(FUNCS, id)) {
    return
  }
  const fn = FUNCS[id]
  if (typeof fn !== "function") {
    return
  }
  runBattery(label, fn, id === "hash", n, mask).then((res) => {
    // oxlint-disable-next-line unicorn/require-post-message-target-origin
    ctx.postMessage(res)
  })
})
