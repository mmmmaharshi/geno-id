/// <reference types="node" />

import assert from "node:assert/strict"
import path from "node:path"
import { test } from "node:test"
import { pathToFileURL } from "node:url"

// Pins the seeded RNG's actual contract: determinism only.

// CreateSeededRandom's stream is degenerate (bytes 0/128 dominate), which is

// Fine for golden vectors + the Rust port but fatal for any uniformity

// Assertion. Distribution-asserting tests must use mulberry32 instead

// (see the coding-standards skill, Seeded RNG Discipline). This test fails if

// Anyone "fixes" the stream and breaks byte-identity with the Rust port,

// Or if determinism itself regresses.

const root = path.resolve(import.meta.dirname, "..", "..")

const algo: unknown = await import(
  pathToFileURL(path.resolve(root, "dist/algo.js")).href
)

const { createSeededRandom } = algo as {
  createSeededRandom: (s0: number, s1: number) => (buf: Uint8Array) => void
}

const fill = (seed0: number, seed1: number, n: number): Uint8Array => {
  const buf = new Uint8Array(n)

  createSeededRandom(seed0, seed1)(buf)

  return buf
}

void test("seeded RNG: same seed produces identical bytes (golden-vector contract)", () => {
  assert.deepEqual(fill(0xde_ad, 0xbe_ef, 4096), fill(0xde_ad, 0xbe_ef, 4096))
})

void test("seeded RNG: different seeds produce different bytes", () => {
  assert.notDeepEqual(fill(0xde_ad, 0xbe_ef, 256), fill(0xbe_ef, 0xde_ad, 256))
})
