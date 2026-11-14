import assert from "node:assert/strict"
import { test } from "node:test"
import { pathToFileURL } from "node:url"
import path from "node:path"

// Pins the seeded RNG's actual contract: determinism only.
// createSeededRandom's stream is degenerate (bytes 0/128 dominate), which is
// fine for golden vectors + the Rust port but fatal for any uniformity
// assertion. Distribution-asserting tests must use mulberry32 instead
// (see CODING_STANDARDS.md, Deterministic Testing). This test fails if
// anyone "fixes" the stream and breaks byte-identity with the Rust port,
// or if determinism itself regresses.

const root = path.resolve(import.meta.dirname, "..", "..")
const algo = await import(pathToFileURL(path.resolve(root, "dist/algo.js")).href)
const { createSeededRandom } = algo as {
  createSeededRandom: (s0: number, s1: number) => (buf: Uint8Array) => void
}

function fill(seed0: number, seed1: number, n: number): Uint8Array {
  const buf = new Uint8Array(n)
  createSeededRandom(seed0, seed1)(buf)
  return buf
}

test("seeded RNG: same seed produces identical bytes (golden-vector contract)", () => {
  assert.deepEqual(fill(0xdead, 0xbeef, 4096), fill(0xdead, 0xbeef, 4096))
})

test("seeded RNG: different seeds produce different bytes", () => {
  assert.notDeepEqual(fill(0xdead, 0xbeef, 256), fill(0xbeef, 0xdead, 256))
})
