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
  mutateChildBytes: (
    child: Uint8Array,
    mutPos: number,
    mixByte: number,
    useScramble: boolean
  ) => void
  resetSeededState: () => void
  scoreLayoutFitness: (
    layout: unknown,
    trials?: number
  ) => { repairsPerUuid: number; maxAllowedDev: number; trials: number }
  scrambleByte: (b: number) => number
}

void test("entropy path reports pooled CSPRNG", () => {
  assert.equal(algo.getEntropySourceId(), "pooled-csprng-v1")
})

void test("seeded entropy reports injected and stays deterministic in single-slot pool", () => {
  algo.configurePools({ simplePoolSize: 1 })
  algo.configureRandom(algo.createSeededRandom(11, 22))
  assert.equal(algo.getEntropySourceId(), "injected")
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

void test("reseed replays the pool from the start", () => {
  algo.configurePools({ simplePoolSize: 256 })
  algo.configureRandom(algo.createSeededRandom(7, 8))
  algo.resetSeededState()
  const a = algo.genGenoID()
  algo.configureRandom(algo.createSeededRandom(7, 8))
  algo.resetSeededState()
  const b = algo.genGenoID()
  algo.configureRandom(null)
  algo.resetSeededState()
  assert.equal(a, b)
})

void test("scrambleByte single-xor vectors", () => {
  assert.equal(algo.scrambleByte(0), 0)
  assert.equal(algo.scrambleByte(1), 9)
  assert.equal(algo.scrambleByte(255), 0)
})

void test("mutateChildBytes shares one path with and without scrambler", () => {
  const a = new Uint8Array([10, 20])
  const b = new Uint8Array([10, 20])
  algo.mutateChildBytes(a, 0, 7, false)
  algo.mutateChildBytes(b, 0, 7, true)
  assert.equal(a[0], 13)
  assert.equal(b[0], 53)
  assert.equal(a[1], 20)
  assert.equal(b[1], 20)
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
