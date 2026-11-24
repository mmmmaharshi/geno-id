/// <reference types="node" />
import assert from "node:assert/strict"

import { need } from "../shared/need.ts"

import path from "node:path"

import { pathToFileURL } from "node:url"

import { shiftRightBits } from "../shared/bitwise.ts"

import { test } from "node:test"

// RFC 9562 §6.2 monotonicity suite. Paper §3.6 promises: the

// Timestamp is clamped to max(clock, last tick), the counter

// Increments within a tick rather than being redrawn, and counter

// Exhaustion freezes generation until the clock advances. These

// Tests pin that behavior on every generator path that emits a

// (timestamp, counter) pair: the compiled production path and the

// Single-parent pool.

const undefinedValue: undefined = Reflect.get({}, "missing") as undefined

const __dirname = import.meta.dirname

const root = path.resolve(__dirname, "..", "..")

const algo: unknown = await import(
  pathToFileURL(path.resolve(root, "dist/algo.js")).href
)

const {
  genStructuredGenoIDSingleParent,

  genStructuredParent,

  genStructuredGenoID,

  compileLayout,

  completeLayout,

  uuidToBytes,

  getFieldValue,

  resetSeededState,

  DBKEY_LAYOUT,
} = algo as {
  genStructuredGenoIDSingleParent: (l: unknown) => string

  genStructuredParent: (l: unknown, mask: number[]) => Uint8Array

  genStructuredGenoID: (l: unknown) => string

  compileLayout: (
    l: unknown,
    poolSize?: number,
  ) => { source: string; fn: () => string }

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
      constraint?: { allowed?: number[]; monotonic?: boolean }
    }[]
  }

  uuidToBytes: (u: string) => Uint8Array

  getFieldValue: (b: Uint8Array, f: unknown) => bigint

  resetSeededState: () => void

  DBKEY_LAYOUT: {
    name: string
    fields: {
      name: string
      start: number
      length: number
      type: string
      constraint?: { monotonic?: boolean }
    }[]
  }
}

const tsField = need(DBKEY_LAYOUT.fields.find((f) => f.name === "timestamp"))

const ctrField = need(DBKEY_LAYOUT.fields.find((f) => f.name === "counter"))

interface Pair {
  ts: number

  ctr: number
}

const pairOf = (uuid: string): Pair => {
  const b = uuidToBytes(uuid)

  return {
    ctr: Number(getFieldValue(b, ctrField)),
    ts: Number(getFieldValue(b, tsField)),
  }
}

// Run `body` with Date.now replaced by `clock`, restoring the real

// Clock afterwards even when an assertion fails.

const withClock = (clock: () => number, body: () => void): void => {
  const orig = Date.now

  Date.now = clock

  try {
    body()
  } finally {
    Date.now = orig
  }
}

// ---------------------------------------------------------------------------

// Compiled production path (compileLayout → fresh closure per test)

// ---------------------------------------------------------------------------

void test("§6.2 compiled: backwards clock re-emits the previous tick with an incremented counter", () => {
  resetSeededState()

  const compiled = compileLayout(DBKEY_LAYOUT)

  const T = 1_700_000_000_000

  withClock(
    () => T,
    () => {
      const a = pairOf(compiled.fn())

      assert.equal(a.ts, T, "first UUID carries the wall-clock tick")

      withClock(
        () => T - 10_000,
        () => {
          const b = pairOf(compiled.fn())

          assert.equal(
            b.ts,
            T,
            "backwards clock must clamp the timestamp to the last tick, not regress it",
          )

          assert.ok(
            b.ctr > a.ctr,
            `counter must increment within a tick: ${a.ctr} → ${b.ctr}`,
          )
        },
      )
    },
  )
})

void test("§6.2 compiled: counter increments strictly within a single tick", () => {
  const compiled = compileLayout(DBKEY_LAYOUT)

  const T = 1_700_000_000_000

  withClock(
    () => T,
    () => {
      let prev = -1

      for (let i = 0; i < 200; i += 1) {
        const { ctr } = pairOf(compiled.fn())

        assert.ok(
          ctr > prev,
          `counter regressed at call ${i}: ${prev} → ${ctr}`,
        )

        prev = ctr
      }
    },
  )
})

void test("§6.2 compiled: counter exhaustion freezes generation until the clock advances", () => {
  // 4-bit monotonic counter: exhausts after ≤16 UUIDs per tick, so a

  // Stalling clock forces the freeze-and-wait loop on every boundary.

  const layout = completeLayout("mono4", [
    { length: 48, name: "ts", start: 0, type: "timestamp-ms" },

    {
      constraint: { monotonic: true },
      length: 4,
      name: "ctr",
      start: 66,
      type: "counter",
    },
  ])

  const compiled = compileLayout(layout)

  const fTs = need(layout.fields.find((f) => f.name === "ts"))

  const fCtr = need(layout.fields.find((f) => f.name === "ctr"))

  const T = 1_700_000_000_000

  let reads = 0

  // Clock holds each tick for 64 reads, then advances one ms — the

  // Freeze loop must spin until that happens, then generation

  // Continues with a strictly larger timestamp.

  withClock(
    () => T + shiftRightBits((reads += 1), 6),
    () => {
      let prev: Pair | undefined = undefinedValue

      let boundaries = 0

      for (let i = 0; i < 2000; i += 1) {
        const b = uuidToBytes(compiled.fn())

        const pair = {
          ctr: Number(getFieldValue(b, fCtr)),
          ts: Number(getFieldValue(b, fTs)),
        }

        if (prev !== undefinedValue) {
          if (pair.ts === prev.ts) {
            assert.ok(
              pair.ctr > prev.ctr,
              `counter regressed within tick ${prev.ts}: ${prev.ctr} → ${pair.ctr}`,
            )
          } else {
            boundaries += 1

            assert.ok(
              pair.ts > prev.ts,
              `timestamp regressed at boundary: ${prev.ts} → ${pair.ts}`,
            )

            // A tick-boundary reseed draws from the 2^(len-1) reseed

            // Range, so a 4-bit counter restarts below 8.

            assert.ok(
              pair.ctr < 8,
              `reseeded counter ${pair.ctr} not in [0,2^3) at tick boundary`,
            )
          }

          assert.ok(
            pair.ts > prev.ts || (pair.ts === prev.ts && pair.ctr > prev.ctr),

            `(timestamp, counter) pair regressed: ${JSON.stringify(prev)} → ${JSON.stringify(pair)}`,
          )
        }

        prev = pair
      }

      assert.ok(
        boundaries > 10,
        `expected the freeze path to run across many ticks, saw ${boundaries}`,
      )
    },
  )
})

void test("§6.2 production genStructuredGenoID: backwards clock cannot regress the sort key", () => {
  resetSeededState()

  // A fresh layout name gets a fresh compiled closure, so this test

  // Never inherits an exhausted counter from another suite.

  const layout = completeLayout("prod-clamp-probe", [
    { length: 48, name: "timestamp", start: 0, type: "timestamp-ms" },

    {
      constraint: { allowed: [1, 2, 3, 4, 5] },
      length: 8,
      name: "shard",
      start: 52,
      type: "shard",
    },

    {
      constraint: { monotonic: true },
      length: 16,
      name: "counter",
      start: 66,
      type: "counter",
    },
  ])

  const T = 1_700_000_000_000

  withClock(
    () => T,
    () => {
      const a = pairOf(genStructuredGenoID(layout))

      assert.equal(a.ts, T)

      withClock(
        () => T - 60_000,
        () => {
          const b = pairOf(genStructuredGenoID(layout))

          assert.ok(
            b.ts >= a.ts,
            `timestamp regressed under a backwards clock: ${a.ts} → ${b.ts}`,
          )

          assert.ok(
            b.ctr > a.ctr,
            `counter must increment within a tick: ${a.ctr} → ${b.ctr}`,
          )
        },
      )
    },
  )
})

// ---------------------------------------------------------------------------

// Single-parent pooled path (genStructuredGenoIDSingleParent)

// ---------------------------------------------------------------------------

void test("§6.2 single-parent: backwards clock clamps the timestamp and the counter increments", () => {
  resetSeededState()

  const T = 1_700_000_000_000

  withClock(
    () => T,
    () => {
      const a = pairOf(genStructuredGenoIDSingleParent(DBKEY_LAYOUT))

      assert.equal(a.ts, T)

      withClock(
        () => T - 5000,
        () => {
          const b = pairOf(genStructuredGenoIDSingleParent(DBKEY_LAYOUT))

          assert.equal(
            b.ts,
            T,
            "backwards clock must not regress the timestamp",
          )

          assert.ok(
            b.ctr > a.ctr,
            `counter must increment within a tick: ${a.ctr} → ${b.ctr}`,
          )
        },
      )
    },
  )
})

void test("§6.2 single-parent: counter increments across pool refill boundaries within a tick", () => {
  resetSeededState()

  const T = 1_700_000_000_000

  withClock(
    () => T,
    () => {
      let prev = -1

      for (let i = 0; i < 2100; i += 1) {
        const { ctr } = pairOf(genStructuredGenoIDSingleParent(DBKEY_LAYOUT))

        assert.ok(
          ctr > prev,
          `counter regressed at call ${i} (pool size 1024, refill boundary at ${Math.floor(i / 1024)}): ${prev} → ${ctr}`,
        )

        prev = ctr
      }
    },
  )
})

// ---------------------------------------------------------------------------

// GenStructuredParent (crossover seam) — timestamp clamp only

// ---------------------------------------------------------------------------

void test("§6.2 genStructuredParent: timestamp field clamps to the last tick on a backwards clock", () => {
  resetSeededState()

  const T = 1_700_000_000_000

  withClock(
    () => T,
    () => {
      const a = Number(
        getFieldValue(genStructuredParent(DBKEY_LAYOUT, [0]), tsField),
      )

      assert.equal(a, T)

      withClock(
        () => T - 100_000,
        () => {
          const b = Number(
            getFieldValue(genStructuredParent(DBKEY_LAYOUT, [0]), tsField),
          )

          assert.equal(
            b,
            T,
            "backwards clock must not regress the structured timestamp field",
          )
        },
      )
    },
  )
})
