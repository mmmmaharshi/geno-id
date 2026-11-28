import assert from "node:assert/strict"
import path from "node:path"
import { test } from "node:test"
import { pathToFileURL } from "node:url"

const __dirname = import.meta.dirname

const root = path.resolve(__dirname, "..", "..")

const algo = (await import(
  pathToFileURL(path.resolve(root, "dist/algo.js")).href
)) as {
  completeLayout: (name: string, fields: readonly unknown[]) => unknown
  configurePools: (cfg: unknown) => void
  configureRandom: (fn: unknown) => void
  createSeededRandom: (s0: number, s1: number) => unknown
  genGenoID: () => string
  getEntropySourceId: () => string
  resetSeededState: () => void
  scoreLayoutFitness: (
    layout: unknown,
    trials?: number
  ) => {
    repairsPerUuid: number
    maxAllowedDev: number
    score: number
    trials: number
  }
  scrambleByte: (b: number) => number
}

void test("entropy path reports pooled CSPRNG", () => {
  assert.equal(algo.getEntropySourceId(), "pooled-csprng-v1")
})

void test("seeded entropy makes output deterministic", () => {
  algo.configurePools({ simplePoolSize: 1 })
  algo.configureRandom(algo.createSeededRandom(11, 22))
  algo.resetSeededState()
  const a = algo.genGenoID()
  algo.configureRandom(algo.createSeededRandom(11, 22))
  algo.resetSeededState()
  const b = algo.genGenoID()
  algo.configureRandom(null)
  algo.configurePools({ simplePoolSize: 256 })
  algo.resetSeededState()
  assert.equal(a, b)
  assert.equal(algo.getEntropySourceId(), "pooled-csprng-v1")
})

void test("scrambleByte single-xor vectors", () => {
  assert.equal(algo.scrambleByte(0), 0)
  assert.equal(algo.scrambleByte(1), 9)
  assert.equal(algo.scrambleByte(255), 0)
})

void test("layout fitness measures repair cost", () => {
  const core = Array.from({ length: 6 }, (_, i) => ({
    constraint: { allowed: [0, 1, 2, 3] },
    length: 8,
    name: `c${i}`,
    start: i * 8,
    type: "random",
  }))
  const layout = algo.completeLayout("k6", core)
  const r = algo.scoreLayoutFitness(layout, 2000)
  assert.ok(r.repairsPerUuid > 5 && r.repairsPerUuid <= 6)
  assert.equal(r.maxAllowedDev, 0)
  assert.equal(r.trials, 2000)
})
