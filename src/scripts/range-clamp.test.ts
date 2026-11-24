/// <reference types="node" />
import assert from "node:assert/strict"

import { mulberry32 } from "./shared/cli-utils.ts"

import { need } from "../shared/need.ts"

import path from "node:path"

import { pathToFileURL } from "node:url"

import { test } from "node:test"

// Range-clamp endpoint-accumulation bound (§4.3): pins the closed form and its empirical match on the production path.

const nullValue: null = JSON.parse("null") as null

const __dirname = import.meta.dirname

const root = path.resolve(__dirname, "..", "..")

const algo: unknown = await import(
  pathToFileURL(path.resolve(root, "dist/algo.js")).href
)

const {
  genStructuredGenoID,

  completeLayout,

  uuidToBytes,

  getFieldValue,

  rangeClampMass,

  configureRandom,

  resetSeededState,
} = algo as {
  genStructuredGenoID: (l: unknown) => string

  completeLayout: (
    name: string,
    core: unknown[],
  ) => {
    name: string
    fields: {
      name: string
      start: number
      length: number
      type: string
      constraint?: { min?: number; max?: number }
    }[]
  }

  uuidToBytes: (u: string) => Uint8Array

  getFieldValue: (b: Uint8Array, f: unknown) => bigint

  rangeClampMass: (
    ell: number,
    min: number,
    max: number,
  ) => { pMin: number; pMax: number; pInterior: number; pinned: number }

  configureRandom: (fn: ((buf: Uint8Array) => void) | null) => void

  resetSeededState: () => void
}

// Deterministic uniform fill for the distribution assertion below.

// CreateSeededRandom is determinism-only (its stream is degenerate, which

// Is fine for golden vectors but not for a uniformity measurement);

// Mulberry32 is the repo's proven uniform seeded stream.

const seededUniformFill = (seed: number): (buf: Uint8Array) => void => {
  const rand = mulberry32(seed)

  return (buf: Uint8Array): void => {
    for (let i = 0; i < buf.length; i += 1) {
      buf[i] = Math.trunc(rand() * 256)
    }
  }
}

void test("range clamp: worked endpoint masses for ell=2, [1,2]", () => {
  // Raw values {0,1,2,3} clamp to {1,1,2,2}: each endpoint takes half.

  const m = rangeClampMass(2, 1, 2)

  assert.equal(m.pMin, 1 / 2)

  assert.equal(m.pMax, 1 / 2)

  assert.equal(m.pInterior, 1 / 4)

  assert.equal(m.pinned, 1 / 2)
})

void test("range clamp: masses partition the raw space", () => {
  for (const [ell, min, max] of [
    [4, 1, 14],
    [8, 10, 245],
    [12, 100, 3995],
  ] as const) {
    const m = rangeClampMass(ell, min, max)

    const total = m.pMin + m.pMax + (max - min - 1) * m.pInterior

    assert.ok(
      Math.abs(total - 1) < 1e-12,
      `ell=${ell} [${min},${max}] masses sum to ${total}`,
    )
  }
})

void test("range clamp: over-wide max never accumulates", () => {
  // Declared max=4999 lies outside the 12-bit domain, so only raw 4095 lands on the upper endpoint.

  const m = rangeClampMass(12, 100, 4999)

  assert.equal(m.pMin, 101 / 4096)

  assert.equal(m.pMax, 1 / 4096)

  assert.equal(m.pinned, 100 / 4096)
})

void test("range clamp: full-width range pins nothing", () => {
  const m = rangeClampMass(8, 0, 255)

  assert.equal(m.pinned, 0)

  assert.equal(m.pMin, 1 / 256)

  assert.equal(m.pMax, 1 / 256)
})

// Bun caps ordinary tests at 5s; the draw-count test below costs ~1s

// Alone but runs slower in the full suite. A per-test timeout is the

// Portable lever both bun and node honor.

const DRAWS_TIMEOUT = 30_000

void test(
  "range clamp: production path matches the stated endpoint bound",
  { timeout: DRAWS_TIMEOUT },
  () => {
    const layout = completeLayout("range-clamp-cell", [
      {
        constraint: { max: 245, min: 10 },
        length: 8,
        name: "shard",
        start: 0,
        type: "shard",
      },
    ])

    const field = need(layout.fields.find((f) => f.name === "shard"))

    const predicted = rangeClampMass(8, 10, 245)

    const N = 200_000

    let atMin = 0

    let atMax = 0

    configureRandom(seededUniformFill(0x9E_37_79_B9))

    try {
      for (let i = 0; i < N; i += 1) {
        const bytes = uuidToBytes(genStructuredGenoID(layout))

        const v = Number(getFieldValue(bytes, field))

        assert.ok(
          v >= 10 && v <= 245,
          `value ${v} outside the declared range [10, 245]`,
        )

        if (v === 10) {
          atMin += 1
        } else if (v === 245) {
          atMax += 1
        }
      }
    } finally {
      configureRandom(nullValue)

      resetSeededState()
    }

    // ±0.5pp: a 200k-draw cell has binomial SD ≈0.05pp on the endpoints,

    // So this is ~10σ and still tight enough that a changed clamp fails.

    assert.ok(
      Math.abs(atMin / N - predicted.pMin) < 0.005,

      `P(min) measured ${atMin / N} != stated ${predicted.pMin}`,
    )

    assert.ok(
      Math.abs(atMax / N - predicted.pMax) < 0.005,

      `P(max) measured ${atMax / N} != stated ${predicted.pMax}`,
    )
  },
)
