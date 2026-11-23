// Worker: runs one randomness battery on a single CPU core. Driven by
// `stats.ts`, which fans the 5 generator batteries out across all cores.
import { parentPort, workerData } from "node:worker_threads"
import { pathToFileURL } from "node:url"
import path from "node:path"
import { runBattery } from './stats-core.ts';
import type { RunDef } from './stats-core.ts';

const root = path.resolve(import.meta.dirname, "..", "..")
const algo = (await import(pathToFileURL(path.resolve(root, "dist/algo.js")).href)) as {
  genGenoID: () => string
  genV4Native: () => string
  genV7: () => string
  genMathRandom: () => string
  genHashUUID: () => Promise<string>
}

const FUNCS = {
  genoid: algo.genGenoID,
  hash: algo.genHashUUID,
  mr: algo.genMathRandom,
  v4: algo.genV4Native,
  v7: algo.genV7,
} as const

const { id, label, mask, n } = workerData as RunDef
const fn = FUNCS[id]
const res = await runBattery(label, fn, id === "hash", n, mask)
parentPort!.postMessage(res, [])
