import { test } from "node:test"
import assert from "node:assert/strict"
import { pathToFileURL } from "node:url"
import path from "node:path"

// RFC 9562 §6.2 monotonicity suite. Paper §3.6 promises: the
// timestamp is clamped to max(clock, last tick), the counter
// increments within a tick rather than being redrawn, and counter
// exhaustion freezes generation until the clock advances. These
// tests pin that behavior on every generator path that emits a
// (timestamp, counter) pair: the compiled production path, the
// single-parent pool, and both hand-coded dbkey generators.

const __dirname = import.meta.dirname
const root = path.resolve(__dirname, "..")
const algo = await import(pathToFileURL(path.resolve(root, "dist/algo.js")).href)

const {
  genHandCodedDbkey,
  genHandCodedDbkeyP,
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
  genHandCodedDbkey: () => string
  genHandCodedDbkeyP: () => string
  genStructuredGenoIDSingleParent: (l: unknown) => string
  genStructuredParent: (l: unknown, mask: number[]) => Uint8Array
  genStructuredGenoID: (l: unknown) => string
  compileLayout: (l: unknown, poolSize?: number) => { source: string; fn: () => string }
  completeLayout: (name: string, core: unknown[]) => { name: string; fields: { name: string; start: number; length: number; type: string; constraint?: { allowed?: number[]; monotonic?: boolean } }[] }
  uuidToBytes: (u: string) => Uint8Array
  getFieldValue: (b: Uint8Array, f: unknown) => bigint
  resetSeededState: () => void
  DBKEY_LAYOUT: { name: string; fields: { name: string; start: number; length: number; type: string; constraint?: { monotonic?: boolean } }[] }
}

const tsField = DBKEY_LAYOUT.fields.find((f) => f.name === "timestamp")!
const ctrField = DBKEY_LAYOUT.fields.find((f) => f.name === "counter")!

interface Pair {
  ts: number
  ctr: number
}

function pairOf(uuid: string): Pair {
  const b = uuidToBytes(uuid)
  return { ts: Number(getFieldValue(b, tsField)), ctr: Number(getFieldValue(b, ctrField)) }
}

// Run `body` with Date.now replaced by `clock`, restoring the real
// clock afterwards even when an assertion fails.
function withClock(clock: () => number, body: () => void): void {
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

test("§6.2 compiled: backwards clock re-emits the previous tick with an incremented counter", () => {
  resetSeededState()
  const compiled = compileLayout(DBKEY_LAYOUT)
  const T = 1_700_000_000_000
  withClock(() => T, () => {
    const a = pairOf(compiled.fn())
    assert.equal(a.ts, T, "first UUID carries the wall-clock tick")
    withClock(() => T - 10_000, () => {
      const b = pairOf(compiled.fn())
      assert.equal(b.ts, T, "backwards clock must clamp the timestamp to the last tick, not regress it")
      assert.ok(b.ctr > a.ctr, `counter must increment within a tick: ${a.ctr} → ${b.ctr}`)
    })
  })
})

test("§6.2 compiled: counter increments strictly within a single tick", () => {
  const compiled = compileLayout(DBKEY_LAYOUT)
  const T = 1_700_000_000_000
  withClock(() => T, () => {
    let prev = -1
    for (let i = 0; i < 200; i++) {
      const ctr = pairOf(compiled.fn()).ctr
      assert.ok(ctr > prev, `counter regressed at call ${i}: ${prev} → ${ctr}`)
      prev = ctr
    }
  })
})

test("§6.2 compiled: counter exhaustion freezes generation until the clock advances", () => {
  // 4-bit monotonic counter: exhausts after ≤16 UUIDs per tick, so a
  // stalling clock forces the freeze-and-wait loop on every boundary.
  const layout = completeLayout("mono4", [
    { name: "ts", start: 0, length: 48, type: "timestamp-ms" },
    { name: "ctr", start: 66, length: 4, type: "counter", constraint: { monotonic: true } },
  ])
  const compiled = compileLayout(layout)
  const fTs = layout.fields.find((f) => f.name === "ts")!
  const fCtr = layout.fields.find((f) => f.name === "ctr")!
  const T = 1_700_000_000_000
  let reads = 0
  // Clock holds each tick for 64 reads, then advances one ms — the
  // freeze loop must spin until that happens, then generation
  // continues with a strictly larger timestamp.
  withClock(() => T + ((reads++) >> 6), () => {
    let prev: Pair | null = null
    let boundaries = 0
    for (let i = 0; i < 2000; i++) {
      const b = uuidToBytes(compiled.fn())
      const pair = { ts: Number(getFieldValue(b, fTs)), ctr: Number(getFieldValue(b, fCtr)) }
      if (prev) {
        if (pair.ts === prev.ts) {
          assert.ok(pair.ctr > prev.ctr, `counter regressed within tick ${prev.ts}: ${prev.ctr} → ${pair.ctr}`)
        } else {
          boundaries++
          assert.ok(pair.ts > prev.ts, `timestamp regressed at boundary: ${prev.ts} → ${pair.ts}`)
          // A tick-boundary reseed draws from the 2^(len-1) reseed
          // range, so a 4-bit counter restarts below 8.
          assert.ok(pair.ctr < 8, `reseeded counter ${pair.ctr} not in [0,2^3) at tick boundary`)
        }
        assert.ok(
          pair.ts > prev.ts || (pair.ts === prev.ts && pair.ctr > prev.ctr),
          `(timestamp, counter) pair regressed: ${JSON.stringify(prev)} → ${JSON.stringify(pair)}`,
        )
      }
      prev = pair
    }
    assert.ok(boundaries > 10, `expected the freeze path to run across many ticks, saw ${boundaries}`)
  })
})

test("§6.2 production genStructuredGenoID: backwards clock cannot regress the sort key", () => {
  resetSeededState()
  // A fresh layout name gets a fresh compiled closure, so this test
  // never inherits an exhausted counter from another suite.
  const layout = completeLayout("prod-clamp-probe", [
    { name: "timestamp", start: 0, length: 48, type: "timestamp-ms" },
    { name: "shard", start: 52, length: 8, type: "shard", constraint: { allowed: [1, 2, 3, 4, 5] } },
    { name: "counter", start: 66, length: 16, type: "counter", constraint: { monotonic: true } },
  ])
  const T = 1_700_000_000_000
  withClock(() => T, () => {
    const a = pairOf(genStructuredGenoID(layout))
    assert.equal(a.ts, T)
    withClock(() => T - 60_000, () => {
      const b = pairOf(genStructuredGenoID(layout))
      assert.ok(b.ts >= a.ts, `timestamp regressed under a backwards clock: ${a.ts} → ${b.ts}`)
      assert.ok(b.ctr > a.ctr, `counter must increment within a tick: ${a.ctr} → ${b.ctr}`)
    })
  })
})

// ---------------------------------------------------------------------------
// Single-parent pooled path (genStructuredGenoIDSingleParent)
// ---------------------------------------------------------------------------

test("§6.2 single-parent: backwards clock clamps the timestamp and the counter increments", () => {
  resetSeededState()
  const T = 1_700_000_000_000
  withClock(() => T, () => {
    const a = pairOf(genStructuredGenoIDSingleParent(DBKEY_LAYOUT))
    assert.equal(a.ts, T)
    withClock(() => T - 5_000, () => {
      const b = pairOf(genStructuredGenoIDSingleParent(DBKEY_LAYOUT))
      assert.equal(b.ts, T, "backwards clock must not regress the timestamp")
      assert.ok(b.ctr > a.ctr, `counter must increment within a tick: ${a.ctr} → ${b.ctr}`)
    })
  })
})

test("§6.2 single-parent: counter increments across pool refill boundaries within a tick", () => {
  resetSeededState()
  const T = 1_700_000_000_000
  withClock(() => T, () => {
    let prev = -1
    for (let i = 0; i < 2100; i++) {
      const ctr = pairOf(genStructuredGenoIDSingleParent(DBKEY_LAYOUT)).ctr
      assert.ok(ctr > prev, `counter regressed at call ${i} (pool size 1024, refill boundary at ${Math.floor(i / 1024)}): ${prev} → ${ctr}`)
      prev = ctr
    }
  })
})

// ---------------------------------------------------------------------------
// genStructuredParent (crossover seam) — timestamp clamp only
// ---------------------------------------------------------------------------

test("§6.2 genStructuredParent: timestamp field clamps to the last tick on a backwards clock", () => {
  resetSeededState()
  const T = 1_700_000_000_000
  withClock(() => T, () => {
    const a = Number(getFieldValue(genStructuredParent(DBKEY_LAYOUT, [0]), tsField))
    assert.equal(a, T)
    withClock(() => T - 100_000, () => {
      const b = Number(getFieldValue(genStructuredParent(DBKEY_LAYOUT, [0]), tsField))
      assert.equal(b, T, "backwards clock must not regress the structured timestamp field")
    })
  })
})

// ---------------------------------------------------------------------------
// Hand-coded dbkey generators (per-call and pooled share one clock)
// ---------------------------------------------------------------------------

const HANDCODED_N = 70_000

test("§6.2 hand-coded per-call: backwards clock re-emits the previous tick", () => {
  resetSeededState()
  const T = 1_700_000_000_000
  withClock(() => T, () => {
    const a = pairOf(genHandCodedDbkey())
    assert.equal(a.ts, T)
    withClock(() => T - 8_000, () => {
      const b = pairOf(genHandCodedDbkey())
      assert.equal(b.ts, T, "backwards clock must clamp the timestamp to the last tick")
      assert.ok(b.ctr > a.ctr, `counter must increment within a tick: ${a.ctr} → ${b.ctr}`)
    })
  })
})

test("§6.2 hand-coded per-call: counter exhaustion freezes generation until the clock advances", () => {
  resetSeededState()
  const T = 1_700_000_000_000
  let reads = 0
  withClock(() => T + ((reads++) >> 6), () => {
    let prevTs = -1
    let prevCtr = -1
    let freezes = 0
    for (let i = 0; i < HANDCODED_N; i++) {
      const pair = pairOf(genHandCodedDbkey())
      if (pair.ts === prevTs) {
        assert.ok(pair.ctr > prevCtr, `counter regressed within tick ${prevTs}: ${prevCtr} → ${pair.ctr}`)
      } else {
        assert.ok(pair.ts > prevTs, `timestamp regressed: ${prevTs} → ${pair.ts}`)
        if (prevTs !== -1) freezes++
      }
      prevTs = pair.ts
      prevCtr = pair.ctr
    }
    // A 16-bit counter exhausts after ≤65536 UUIDs; 70k UUIDs must
    // cross at least one exhaustion-driven tick boundary.
    assert.ok(freezes > 0, "expected at least one exhaustion freeze in 70k UUIDs")
  })
})

test("§6.2 hand-coded pooled: counter exhaustion freezes generation until the clock advances", () => {
  resetSeededState()
  const T = 1_700_000_000_000
  let reads = 0
  withClock(() => T + ((reads++) >> 6), () => {
    let prevTs = -1
    let prevCtr = -1
    let freezes = 0
    for (let i = 0; i < HANDCODED_N; i++) {
      const pair = pairOf(genHandCodedDbkeyP())
      if (pair.ts === prevTs) {
        assert.ok(pair.ctr > prevCtr, `counter regressed within tick ${prevTs}: ${prevCtr} → ${pair.ctr}`)
      } else {
        assert.ok(pair.ts > prevTs, `timestamp regressed: ${prevTs} → ${pair.ts}`)
        if (prevTs !== -1) freezes++
      }
      prevTs = pair.ts
      prevCtr = pair.ctr
    }
    assert.ok(freezes > 0, "expected at least one exhaustion freeze in 70k UUIDs")
  })
})

test("§6.2 hand-coded: per-call and pooled generators share one monotonic tick", () => {
  resetSeededState()
  const T = 1_700_000_000_000
  withClock(() => T, () => {
    // Both access patterns of the same dbkey layout resolve
    // against one shared tick state. Ordering itself is
    // per-generator (the pooled generator pre-formats a
    // batch per refill, as the paper §3.6 documents), but
    // neither generator may ever emit a timestamp below the
    // shared last tick — including under a backwards clock.
    for (let round = 0; round < 2; round++) {
      for (let i = 0; i < 100; i++) {
        const uuid = (i & 1) === 0 ? genHandCodedDbkey() : genHandCodedDbkeyP()
        assert.equal(pairOf(uuid).ts, T, `round ${round}: timestamp must equal the shared tick`)
      }
      withClock(() => T - 123_456 * (round + 1), () => {
        for (let i = 0; i < 100; i++) {
          const uuid = (i & 1) === 0 ? genHandCodedDbkey() : genHandCodedDbkeyP()
          assert.equal(
            pairOf(uuid).ts,
            T,
            `round ${round}: backwards clock must not regress either generator's timestamp`,
          )
        }
      })
    }
  })
})
