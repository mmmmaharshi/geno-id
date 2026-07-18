// Worker: runs one randomness battery on a single CPU core. Driven by
// `stats.ts`, which fans the 5 generator batteries out across all cores.
import { parentPort, workerData } from "node:worker_threads"
import path from "node:path"
import { runBattery } from "./stats-core.ts"

interface Job {
  id: "genoid" | "v4" | "v7" | "mr" | "hash"
  label: string
  mask: number[]
  n: number
}

const root = path.resolve(import.meta.dirname, "..")
const algo = (await import(path.resolve(root, "dist/algo.js"))) as {
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

const { id, label, mask, n } = workerData as Job
const fn = FUNCS[id]
const res = await runBattery(label, fn, id === "hash", n, mask)
parentPort!.postMessage(res, [])
