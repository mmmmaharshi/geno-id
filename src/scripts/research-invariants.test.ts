/// <reference types="node" />

import assert from "node:assert/strict"
import { once } from "node:events"
import os from "node:os"
import path from "node:path"
import { test } from "node:test"
import { pathToFileURL } from "node:url"
import { Worker } from "node:worker_threads"

import { fromAny } from "@total-typescript/shoehorn"

import { andBits, shiftRightBits } from "../shared/bitwise.ts"

const nullValue: null = JSON.parse("null") as null

const undefinedValue: undefined = Reflect.get({}, "missing") as undefined

// ===========================================================================

// RESEARCH-INVARIANT SUITE — the load-bearing claims of the GenoID paper,

// Pinned as executable guards.

//

// Purpose: this file is the tripwire that protects the *research goal* from

// Future feature work. Every check below maps to a specific claim in

// GenoID_IEEE_paper.md. If an optimization, refactor, or new feature ever

// Silently cancels one of those claims, the corresponding INV-* test goes RED.

//

// The final block (INV-9) is the strongest guarantee: it re-runs the core

// Invariants while a *different* injected CSPRNG and *shrunken* pool sizes are

// Active — proving the embeddability features (configureRandom /

// ConfigurePools) cannot, by construction, weaken the original guarantees.

//

// Imports the SOURCE algo.ts (not dist) on purpose: this suite guards the

// Algorithm itself, and testing source removes any stale-build trap. bun and

// Node (with --experimental-strip-types) both import TypeScript natively.

//

// PARALLELISM: the generation-bound invariants (INV-1/2/5/6 and INV-9's scan)

// Are fanned across a worker_threads pool sized to os.availableParallelism(),

// So the suite uses every CPU core. INV-3 (counter ordering) is inherently

// Sequential and stays on the main thread. Disable with GENOID_NO_WORKERS=1.

//

// Scale knobs (env):

//   (default)             → tough scale (×10 iterations)

//   GENOID_FAST=1         → quick local run (×1)

//   GENOID_N=<int>        → base constraint/entropy iteration count (pre-scale)

//   GENOID_NO_WORKERS=1   → force single-threaded (debugging / fallback)

// ===========================================================================

const __dirname = import.meta.dirname

const root = path.resolve(__dirname, "..", "..")

const ALGO_URL = pathToFileURL(path.resolve(root, "src", "algo.ts")).href

const algo: unknown = await import(ALGO_URL)

const {
  genGenoID,

  genStructuredGenoID,

  genStructuredParent,

  readStructured,

  uuidToBytes,

  toUuidString,

  getFieldValue,

  forceVersionVariant,

  repairConstraints,

  configurePools,

  getPoolConfig,

  configureRandom,

  configureFootprint,

  DBKEY_LAYOUT,

  MULTITENANT_LAYOUT,

  EVENTSOURCING_LAYOUT,
} = algo as {
  genGenoID: () => string

  genStructuredGenoID: (l: unknown) => string

  genStructuredParent: (l: unknown, mask: readonly number[]) => Uint8Array

  readStructured: (uuid: string, l: unknown) => Record<string, number>

  uuidToBytes: (uuid: string) => Uint8Array

  toUuidString: (b: Readonly<Uint8Array>) => string

  getFieldValue: (b: Readonly<Uint8Array>, f: unknown) => bigint

  forceVersionVariant: (b: Uint8Array) => void

  repairConstraints: (l: unknown, b: Uint8Array) => number

  configurePools: (
    cfg: Readonly<{ simplePoolSize?: number; structuredPoolSize?: number }>
  ) => void

  getPoolConfig: () => { simplePoolSize: number; structuredPoolSize: number }

  configureRandom: (fn: ((buf: Uint8Array) => void) | null) => void

  configureFootprint: (mode: "fast" | "lean") => void

  DBKEY_LAYOUT: unknown

  MULTITENANT_LAYOUT: unknown

  EVENTSOURCING_LAYOUT: unknown
}

// ---------------------------------------------------------------------------

// Config + shared helpers

// ---------------------------------------------------------------------------

// Tough by default (×10). Drop to ×1 for a quick local run with GENOID_FAST=1.

const FAST = process.env.GENOID_FAST === "1"

let SCALE = 10

if (FAST) {
  SCALE = 1
}

const N = (Number(process.env.GENOID_N) || 100_000) * SCALE

// Collision-set memory is bounded so nightly scale can't OOM the merge.

const N_COLLISION = Math.min(200_000 * SCALE, 3_000_000)

// Counter ordering is a sequential (single-thread) check; scaling it buys nothing and

// Would risk a per-test timeout, so it runs at a fixed, already-tough count.

const ORDER_N = 200_000

const CORES = Math.max(1, os.availableParallelism())

const USE_WORKERS = CORES > 1 && process.env.GENOID_NO_WORKERS !== "1"

// Name -> exported layout key ("simple" is the no-layout genGenoID path)

const LAYOUT_KEYS: [string, string | null][] = [
  ["simple", nullValue],

  ["dbkey", "DBKEY_LAYOUT"],

  ["multitenant", "MULTITENANT_LAYOUT"],

  ["eventsourcing", "EVENTSOURCING_LAYOUT"],
]

const LAYOUT_BY_NAME: Record<string, unknown> = {
  dbkey: DBKEY_LAYOUT,

  eventsourcing: EVENTSOURCING_LAYOUT,

  multitenant: MULTITENANT_LAYOUT,
}

// RFC 9562 v8 canonical form with version nibble 8 and variant bits 10xx.

const V8_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-8[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u

interface Field {
  readonly name: string

  readonly start: number

  readonly length: number

  readonly type: string

  readonly constraint?: Readonly<{
    allowed?: readonly number[]
    min?: number
    max?: number
    monotonic?: boolean
  }>
}

const fieldsOf = (layout: unknown): Field[] =>
  (layout as { fields: Field[] }).fields

// Bits fixed by forceVersionVariant (version nibble 48-51, variant 64-65),

// Excluded from every entropy measurement because they are constant by design.

const FORCED = new Set([48, 49, 50, 51, 64, 65])

const bitAt = (b: Readonly<Uint8Array>, p: number): number =>
  andBits(shiftRightBits(b[shiftRightBits(p, 3)], 7 - andBits(p, 7)), 1)

const constrainedFields = (layout: unknown): Field[] =>
  fieldsOf(layout).filter((f) => f.constraint !== undefinedValue)

const assertConstraint = (
  f: Readonly<Field>,
  value: number,
  ctx: string
): void => {
  const c = f.constraint

  if (c === undefinedValue) {
    return
  }

  if (c.allowed && c.allowed.length > 0) {
    assert.ok(
      c.allowed.includes(value),
      `${ctx}: ${f.name}=${value} not in allowed ${JSON.stringify(c.allowed)}`
    )
  }

  if (c.min !== undefinedValue) {
    assert.ok(value >= c.min, `${ctx}: ${f.name}=${value} < min ${c.min}`)
  }

  if (c.max !== undefinedValue) {
    assert.ok(value <= c.max, `${ctx}: ${f.name}=${value} > max ${c.max}`)
  }
}

// ---------------------------------------------------------------------------

// Worker pool. Each worker imports algo.ts and answers three jobs:

//   Stats   → generate `iters` IDs, return {nonV8, violations, ones, total}

//   Collide → generate `iters` IDs, return the raw 16-byte buffers (transferred)

//   Config  → set injected RNG + pool sizes for THIS worker (INV-9), or reset

// The generation logic is duplicated (in JS) inside the worker source; the

// Main-thread equivalents below are the sequential fallback and are the single

// Source of truth the worker mirrors.

// ---------------------------------------------------------------------------

interface Stats {
  nonV8: number

  violations: number

  ones: number

  total: number
}

const randomBitPositions = (layout: unknown): number[] => {
  const out: number[] = []

  for (const f of fieldsOf(layout)) {
    if (f.type === "random") {
      for (let i = 0; i < f.length; i += 1) {
        const p = f.start + i

        if (!FORCED.has(p)) {
          out.push(p)
        }
      }
    }
  }

  return out
}

const violates = (f: Readonly<Field>, v: number): boolean => {
  const c = f.constraint

  if (c === undefinedValue) {
    return false
  }

  if (c.allowed && c.allowed.length > 0 && !c.allowed.includes(v)) {
    return true
  }

  if (c.min !== undefinedValue && v < c.min) {
    return true
  }

  if (c.max !== undefinedValue && v > c.max) {
    return true
  }

  return false
}

const generateForLayout = (layout: unknown): string => {
  if (layout === nullValue) {
    return genGenoID()
  }

  return genStructuredGenoID(layout)
}

// Sequential reference implementation (fallback + oracle for the worker).

const scanStatsSeq = (name: string, iters: number): Stats => {
  let layout: unknown = nullValue

  if (name !== "simple") {
    layout = LAYOUT_BY_NAME[name]
  }

  let positions: number[] | undefined = undefinedValue

  let cfields: Field[] = []

  if (layout !== nullValue) {
    positions = randomBitPositions(layout)

    cfields = constrainedFields(layout)
  }

  let nonV8 = 0

  let violations = 0

  let ones = 0

  let total = 0

  for (let i = 0; i < iters; i += 1) {
    const uuid = generateForLayout(layout)

    if (!V8_RE.test(uuid)) {
      nonV8 += 1
    }

    const b = uuidToBytes(uuid)

    if (layout === nullValue) {
      for (let p = 0; p < 128; p += 1) {
        if (!FORCED.has(p)) {
          ones += bitAt(b, p)

          total += 1
        }
      }
    } else {
      const r = readStructured(uuid, layout)

      for (const cf of cfields) {
        if (violates(cf, r[cf.name])) {
          violations += 1
        }
      }

      if (positions !== undefinedValue) {
        for (const p of positions) {
          ones += bitAt(b, p)

          total += 1
        }
      }
    }
  }

  return { nonV8, ones, total, violations }
}

// Worker source (plain JS; dynamically imports the TS module at runtime).

const WORKER_SRC = `
const { parentPort, workerData } = require("node:worker_threads")
const FORCED = new Set([48,49,50,51,64,65])
const V8_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-8[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u
const bitAt = (b,p) => (b[p>>3] >> (7-(p&7))) & 1
const algoP = import(workerData.algoUrl)
function randPos(l){const o=[];for(const f of l.fields){if(f.type!=="random")continue;for(let i=0;i<f.length;i += 1){const p=f.start+i;if(!FORCED.has(p))o.push(p);}}return o;}
function violates(f,v){const c=f.constraint;if(!c)return false;if(c.allowed&&c.allowed.length&&!c.allowed.includes(v))return true;if(c.min!==undefined&&v<c.min)return true;if(c.max!==undefined&&v>c.max)return true;return false;}
parentPort.on("message", async (m) => {
  const algo = await algoP
  const layout = m.name === "simple" ? null : algo[m.layoutKey]
  if (m.job === "config") {
    if (m.reset) { algo.configureRandom(null); algo.configurePools({ simplePoolSize: m.simplePoolSize, structuredPoolSize: m.structuredPoolSize }); }
    else { algo.configureRandom((bb) => globalThis.crypto.getRandomValues(bb)); algo.configurePools({ simplePoolSize: m.simplePoolSize, structuredPoolSize: m.structuredPoolSize }); }
    parentPort.postMessage({ ok: true }, []); return
  }
  if (m.job === "stats") {
    const positions = layout ? randPos(layout) : null
    const cfields = layout ? layout.fields.filter((f) => f.constraint) : []
    let nonV8 = 0, violations = 0, ones = 0, total = 0
    for (let i = 0; i < m.iters; i += 1) {
      const uuid = layout ? algo.genStructuredGenoID(layout) : algo.genGenoID()
      if (!V8_RE.test(uuid)) nonV8 += 1
      const b = algo.uuidToBytes(uuid)
      if (layout) { const r = algo.readStructured(uuid, layout); for (const cf of cfields) if (violates(cf, r[cf.name])) violations += 1; for (const p of positions) { ones += bitAt(b,p); total += 1; } }
      else { for (let p = 0; p < 128; p += 1) if (!FORCED.has(p)) { ones += bitAt(b,p); total += 1; } }
    }
    parentPort.postMessage({ nonV8, violations, ones, total }, []); return
  }
  if (m.job === "collide") {
    const buf = new Uint8Array(m.iters * 16)
    for (let i = 0; i < m.iters; i += 1) { const uuid = layout ? algo.genStructuredGenoID(layout) : algo.genGenoID(); buf.set(algo.uuidToBytes(uuid), i*16); }
    parentPort.postMessage({ bytes: buf.buffer }, [buf.buffer]); return
  }
})
`

interface WorkerLike extends Readonly<NodeJS.EventEmitter> {
  readonly postMessage: (message: unknown) => void

  readonly terminate: () => Promise<number>
}

let POOL: WorkerLike[] = []

const spawnPool = async (): Promise<void> => {
  if (!USE_WORKERS) {
    return
  }

  // Inherit only the loader flags (strip-types) — never --test, which would

  // Turn the worker into a second test runner.

  const execArgv = process.execArgv.filter((a) => !a.includes("test"))

  try {
    POOL = Array.from({ length: CORES }, () => {
      const w = new Worker(WORKER_SRC, {
        eval: true,
        execArgv,
        workerData: { algoUrl: ALGO_URL },
      })

      w.unref()

      return w
    })
  } catch {
    // Runtime doesn't support eval workers — degrade to single-threaded. Every

    // Scan helper already falls back to sequential when POOL is empty.

    await Promise.all(
      POOL.map(async (w): Promise<void> => {
        await w.terminate()
      })
    )

    POOL = []
  }
}

const callWorker = async <T>(w: WorkerLike, msg: unknown): Promise<T> => {
  const controller = new AbortController()

  const message = once(w, "message", {
    signal: controller.signal,
  }) as Promise<[unknown]>

  const error = once(w, "error", {
    signal: controller.signal,
  }) as Promise<never>

  try {
    const postMessage = w.postMessage.bind(w)

    postMessage(msg)

    const [value] = await Promise.race([message, error])

    return value as T
  } finally {
    controller.abort()
  }
}

const splitIters = (total: number, parts: number): number[] => {
  const base = Math.floor(total / parts)

  const rem = total % parts

  return Array.from({ length: parts }, (_, i) => {
    let count = base

    if (i < rem) {
      count += 1
    }

    return count
  })
}

const layoutKeyOf = (name: string): string | null => {
  const match = LAYOUT_KEYS.find(([entry]) => entry === name)

  if (match === undefinedValue) {
    return nullValue
  }

  return match[1]
}

// Fan a stats scan across the pool (or run sequentially).

const scanStats = async (name: string, iters: number): Promise<Stats> => {
  if (!USE_WORKERS || POOL.length === 0) {
    return scanStatsSeq(name, iters)
  }

  const layoutKey = layoutKeyOf(name)

  const shards = splitIters(iters, POOL.length)

  const parts = await Promise.all(
    POOL.map(async (w, i): Promise<Stats> => {
      if (shards[i] > 0) {
        const result = await callWorker<Stats>(w, {
          iters: shards[i],
          job: "stats",
          layoutKey,
          name,
        })

        return result
      }

      return { nonV8: 0, ones: 0, total: 0, violations: 0 }
    })
  )

  const merged: Stats = { nonV8: 0, ones: 0, total: 0, violations: 0 }

  for (const p of parts) {
    merged.nonV8 += p.nonV8

    merged.violations += p.violations

    merged.ones += p.ones

    merged.total += p.total
  }

  return merged
}

// Fan a collision scan across the pool, merge into one Set for exact detection.

const countUnique = async (name: string, iters: number): Promise<number> => {
  const seen = new Set<string>()

  if (!USE_WORKERS || POOL.length === 0) {
    let layout: unknown = nullValue

    if (name !== "simple") {
      layout = LAYOUT_BY_NAME[name]
    }

    for (let i = 0; i < iters; i += 1) {
      seen.add(generateForLayout(layout))
    }

    return seen.size
  }

  const layoutKey = layoutKeyOf(name)

  const shards = splitIters(iters, POOL.length)

  const buffers = await Promise.all(
    POOL.map(async (w, i): Promise<{ bytes: ArrayBuffer }> => {
      if (shards[i] > 0) {
        const result = await callWorker<{ bytes: ArrayBuffer }>(w, {
          iters: shards[i],
          job: "collide",
          layoutKey,
          name,
        })

        return result
      }

      return { bytes: new ArrayBuffer(0) }
    })
  )

  for (const { bytes } of buffers) {
    const u = new Uint8Array(bytes)

    for (let o = 0; o < u.length; o += 16) {
      let s = ""

      for (let j = 0; j < 16; j += 1) {
        s += u[o + j].toString(16).padStart(2, "0")
      }

      seen.add(s)
    }
  }

  return seen.size
}

const configurePoolWorkers = async (
  cfg: Readonly<{
    reset: boolean
    simplePoolSize: number
    structuredPoolSize: number
  }>
): Promise<void> => {
  if (!USE_WORKERS || POOL.length === 0) {
    return
  }

  await Promise.all(
    POOL.map(async (w): Promise<void> => {
      await callWorker(
        w,
        Object.assign(
          Object.create(Object.prototype) as Record<string, unknown>,
          { job: "config" },
          cfg
        )
      )
    })
  )
}

// Default-regime scans (INV-1/2/6)

const STATS: Record<string, Stats> = {}

// Injected-RNG + tiny-pool scans (INV-9)

const STATS9: Record<string, Stats> = {}

// Collision counts (INV-5)

const UNIQUE: Record<string, number> = {}

// ---------------------------------------------------------------------------

// All heavy, parallelizable work runs inside this one setup test with a large

// Explicit timeout. bun caps ordinary tests, hooks, AND top-level await at 5s,

// Which tough scale exceeds; a per-test timeout is the portable lever both bun

// And node honor. It spawns the pool, fans generation across every core, then

// Terminates the pool. Tests in a file run sequentially in definition order, so

// This completes and populates the aggregates before the assertions below.

//

// Scans are awaited one at a time: each scan already fans one message to every

// Worker, so overlapping them would cross the one-shot per-worker listeners.

// ---------------------------------------------------------------------------

const scanLayouts = async (
  iters: number,
  target: Record<string, Stats>
): Promise<void> => {
  const scan = async (index: number): Promise<void> => {
    if (index >= LAYOUT_KEYS.length) {
      return
    }

    const [name] = LAYOUT_KEYS[index]

    target[name] = await scanStats(name, iters)

    return scan(index + 1)
  }

  await scan(0)
}

void test(
  "INV-0: parallel precompute across all CPU cores",
  { timeout: 600_000 },
  async () => {
    await spawnPool()

    try {
      await scanLayouts(N, STATS)

      UNIQUE.simple = await countUnique("simple", N_COLLISION)

      UNIQUE.dbkey = await countUnique("dbkey", N_COLLISION)

      // Goal-preservation regime: distinct injected CSPRNG + ESP8266-class pools,

      // Applied to the workers AND the main thread (sequential-fallback path).

      const original = getPoolConfig()

      const tiny = { simplePoolSize: 8, structuredPoolSize: 8 }

      await configurePoolWorkers(
        Object.assign(
          Object.create(Object.prototype) as {
            reset: boolean
            simplePoolSize: number
            structuredPoolSize: number
          },
          { reset: false },
          tiny
        )
      )

      configureRandom((buf) => {
        globalThis.crypto.getRandomValues(buf as Uint8Array<ArrayBuffer>)
      })

      configurePools(tiny)

      const M = 40_000 * SCALE

      await scanLayouts(M, STATS9)

      await configurePoolWorkers({
        reset: true,
        simplePoolSize: original.simplePoolSize,
        structuredPoolSize: original.structuredPoolSize,
      })

      configureRandom(nullValue)

      configurePools(original)
    } finally {
      await Promise.all(
        POOL.map(async (w): Promise<void> => {
          await w.terminate()
        })
      )

      POOL = []
    }
  }
)

// ---------------------------------------------------------------------------

// INV-1 — RFC 9562 v8 conformance (§II, §III).

// ---------------------------------------------------------------------------

void test("INV-1: every GenoID generator emits a syntactically valid v8 UUID", () => {
  for (const [name] of LAYOUT_KEYS) {
    assert.equal(
      STATS[name].nonV8,
      0,
      `${name}: ${STATS[name].nonV8} non-v8 UUIDs`
    )
  }

  // Parent-construction path (cheap, main thread).

  for (const name of ["dbkey", "multitenant", "eventsourcing"]) {
    for (let i = 0; i < 2000; i += 1) {
      const b = genStructuredParent(LAYOUT_BY_NAME[name], [])

      assert.equal(
        andBits(b[6], 0xf0),
        0x80,
        `genStructuredParent(${name}) version nibble != 8`
      )

      assert.equal(
        andBits(b[8], 0xc0),
        0x80,
        `genStructuredParent(${name}) variant bits != 10`
      )
    }
  }
})

// ---------------------------------------------------------------------------

// INV-2 — Zero constraint violations at scale (§III-A, §V-A).

// ---------------------------------------------------------------------------

void test("INV-2: zero constraint violations across all layouts at scale", () => {
  for (const [name] of LAYOUT_KEYS) {
    assert.equal(
      STATS[name].violations,
      0,
      `${name}: ${STATS[name].violations} constraint violations over ${N}`
    )
  }
})

// ---------------------------------------------------------------------------

// INV-3 — Ordered counters (§I, §VIII). Inherently sequential; main thread.

// A counter of width w is strictly increasing modulo 2^w; the only permitted

// Decreases are field-width wraps, whose count is bounded.

// ---------------------------------------------------------------------------

void test(
  "INV-3: counter fields are ordered modulo their field width (bounded wraps)",
  { timeout: 30_000 },
  () => {
    for (const name of ["dbkey", "eventsourcing"]) {
      const layout = LAYOUT_BY_NAME[name]

      const counters = fieldsOf(layout).filter((f) => f.type === "counter")

      for (const cf of counters) {
        const mod = 2 ** cf.length

        let prev = -1

        let decreases = 0

        for (let i = 0; i < ORDER_N; i += 1) {
          const v = readStructured(genStructuredGenoID(layout), layout)[cf.name]

          assert.ok(
            v >= 0 && v < mod,
            `${name}.${cf.name}=${v} outside [0,2^${cf.length})`
          )

          if (prev >= 0 && v < prev) {
            decreases += 1
          }

          prev = v
        }

        const wrapBound = 4 * Math.ceil(ORDER_N / mod) + 4

        assert.ok(
          decreases <= wrapBound,
          `${name}.${cf.name}: ${decreases} decreases > wrap bound ${wrapBound} — ordering broken`
        )
      }
    }
  }
)

// ---------------------------------------------------------------------------

// INV-4 — Repair is O(k), idempotent, correct (§III-A, §III-C).

// ---------------------------------------------------------------------------

void test("INV-4: constraint repair is bounded, idempotent, and correct", () => {
  for (const name of ["dbkey", "multitenant", "eventsourcing"]) {
    const layout = LAYOUT_BY_NAME[name]

    const cfields = constrainedFields(layout)

    if (cfields.length > 0) {
      const k = cfields.length

      for (let i = 0; i < 20_000; i += 1) {
        const b = uuidToBytes(genGenoID())

        forceVersionVariant(b)

        const first = repairConstraints(layout, b)

        assert.ok(
          first <= k,
          `${name}: repaired ${first} > ${k} constrained fields`
        )

        const second = repairConstraints(layout, b)

        assert.equal(
          second,
          0,
          `${name}: repair not idempotent — second pass changed ${second} fields`
        )

        for (const cf of cfields) {
          assertConstraint(
            cf,
            Number(getFieldValue(b, cf)),
            `${name} post-repair#${i}`
          )
        }
      }
    }
  }
})

// ---------------------------------------------------------------------------

// INV-5 — Collision-freedom sanity (§V-C). Parallel generation, exact merge.

// ---------------------------------------------------------------------------

void test("INV-5: no collisions across a large sample (simple + structured)", () => {
  assert.equal(
    UNIQUE.simple,
    N_COLLISION,
    `genGenoID produced ${N_COLLISION - UNIQUE.simple} collisions`
  )

  assert.equal(
    UNIQUE.dbkey,
    N_COLLISION,
    `genStructuredGenoID produced ${N_COLLISION - UNIQUE.dbkey} collisions`
  )
})

// ---------------------------------------------------------------------------

// INV-6 — Entropy preservation on the random payload (§IV-B + NIST proxy).

// Tolerance ~loose enough to never false-fail on a correct CSPRNG, tight

// Enough to catch systematic bias.

// ---------------------------------------------------------------------------

void test("INV-6: random payload is unbiased (monobit) — crossover preserves entropy", () => {
  const TOL = 0.01

  for (const [name] of LAYOUT_KEYS) {
    const { ones, total } = STATS[name]

    assert.ok(
      total > 1_000_000,
      `${name}: monobit sample too small (${total} bits)`
    )

    const ratio = ones / total

    assert.ok(
      Math.abs(ratio - 0.5) < TOL,
      `${name}: monobit ratio ${ratio} deviates > ${TOL} from 0.5`
    )
  }
})

// ---------------------------------------------------------------------------

// INV-7 — Structured round-trip exactness (§IV).

// ---------------------------------------------------------------------------

void test("INV-7: declared fields round-trip exactly", () => {
  for (const name of ["dbkey", "multitenant", "eventsourcing"]) {
    const layout = LAYOUT_BY_NAME[name]

    for (let i = 0; i < 20_000; i += 1) {
      const uuid = genStructuredGenoID(layout)

      const b = uuidToBytes(uuid)

      const read = readStructured(uuid, layout)

      for (const f of fieldsOf(layout)) {
        if (f.type !== "random") {
          const exact = getFieldValue(b, f)

          assert.equal(
            BigInt(read[f.name]),
            exact,
            `${name}.${f.name}: readStructured != getFieldValue`
          )

          assert.ok(
            exact >= 0n && exact < 2n ** BigInt(f.length),
            `${name}.${f.name}=${exact} outside field width`
          )
        }
      }
    }
  }
})

// ---------------------------------------------------------------------------

// INV-8 — API guards reject invalid configuration.

// ---------------------------------------------------------------------------

void test("INV-8: embeddability APIs reject invalid configuration", () => {
  assert.throws(
    () => {
      configureRandom(
        fromAny<Parameters<typeof configureRandom>[0], unknown>(123)
      )
    },

    /expected a function/u
  )

  for (const bad of [0, -1, 3.5, Number.NaN]) {
    assert.throws(
      () => {
        configurePools({ structuredPoolSize: bad })
      },
      /positive integer/u,
      `structuredPoolSize=${bad} not rejected`
    )

    assert.throws(
      () => {
        configurePools({ simplePoolSize: bad })
      },
      /positive integer/u,
      `simplePoolSize=${bad} not rejected`
    )
  }
})

// ----u-----------------------------------------------------------------------

// INV-9 — THE GOAL-PRESERVATION GUARD. Re-run the load-bearing invariants

// (v8 conformance, zero constraint violations, entropy) with the embeddability

// Features ACTIVE: distinct injected CSPRNG + ESP8266-class tiny pools. This is

// The executable form of "feature improvements must not cancel the goal."

// Runs across the pool; each worker (or the main thread) reconfigures itself.

// ---------------------------------------------------------------------------

void test("INV-9: original guarantees hold under injected RNG + tiny pools", () => {
  for (const [name] of LAYOUT_KEYS) {
    const s = STATS9[name]

    assert.equal(
      s.nonV8,
      0,
      `INV-9 ${name}: ${s.nonV8} non-v8 under injected RNG/tiny pool`
    )

    assert.equal(
      s.violations,
      0,
      `INV-9 ${name}: ${s.violations} constraint violations under injected RNG/tiny pool`
    )

    const ratio = s.ones / s.total

    assert.ok(
      Math.abs(ratio - 0.5) < 0.01,
      `INV-9 ${name}: monobit ${ratio} biased under injected RNG/tiny pool`
    )
  }
})

// ---------------------------------------------------------------------------

// INV-10 — Footprint modes are output-equivalent. The "lean" (256-entry) and

// "fast" (65536-entry) hex tables must be byte-identical — configureFootprint

// Trades memory for speed only, never output. Guards the dual-table feature:

// A future formatting optimization cannot silently make lean != fast, and lean

// Mode (the ESP8266 path) cannot silently emit an invalid or off-constraint ID.

// ---------------------------------------------------------------------------

void test("INV-10: lean and fast footprints are byte-identical", () => {
  try {
    // Toggle the mode only twice (not per iteration — switching frees/rebuilds

    // The 65536 table). Format everything fast, then everything lean, compare.

    const bufs: Uint8Array[] = []

    const fast: string[] = []

    configureFootprint("fast")

    for (let i = 0; i < 50_000; i += 1) {
      const b = new Uint8Array(16)

      globalThis.crypto.getRandomValues(b)

      bufs.push(b)

      fast.push(toUuidString(b))
    }

    configureFootprint("lean")

    for (let i = 0; i < bufs.length; i += 1) {
      assert.equal(
        toUuidString(bufs[i]),
        fast[i],
        `lean/fast toUuidString diverged for ${fast[i]}`
      )
    }

    // Generated IDs stay valid v8 + constraint-clean in lean mode.

    for (const name of ["dbkey", "multitenant", "eventsourcing"]) {
      const layout = LAYOUT_BY_NAME[name]

      const cfields = constrainedFields(layout)

      for (let i = 0; i < 20_000; i += 1) {
        const u = genStructuredGenoID(layout)

        assert.match(u, V8_RE, `lean ${name}: non-v8 UUID`)

        const r = readStructured(u, layout)

        for (const cf of cfields) {
          assertConstraint(cf, r[cf.name], `lean ${name}#${i}`)
        }
      }
    }
  } finally {
    configureFootprint("fast")
  }
})

// ---------------------------------------------------------------------------

// INV-11 — allowed-set fields are ~uniformly distributed. Membership (INV-2)

// Is not enough: a biased picker can keep every value in-range while collapsing

// ~all draws onto one value, silently breaking the shard/tenant load-balancing

// Use case (§8). This asserts each allowed value lands within ±50% of its

// Expected share — loose enough never to false-fail on a fair picker, tight

// Enough to catch a collapse (the old pickFrom put ~98% on allowed[0]).

// ---------------------------------------------------------------------------

void test("INV-11: allowed-set fields are ~uniformly distributed (no value collapse)", () => {
  const M = 60_000

  for (const name of ["dbkey", "multitenant"]) {
    const layout = LAYOUT_BY_NAME[name]

    const fields = fieldsOf(layout).filter((f) => {
      const { constraint } = f

      return (
        typeof constraint === "object" &&
        Array.isArray(constraint.allowed) &&
        constraint.allowed.length > 1
      )
    })

    const counts: Record<string, Record<number, number>> = {}

    for (const f of fields) {
      counts[f.name] = {}
    }

    for (let i = 0; i < M; i += 1) {
      const r = readStructured(genStructuredGenoID(layout), layout)

      for (const f of fields) {
        counts[f.name][r[f.name]] = (counts[f.name][r[f.name]] ?? 0) + 1
      }
    }

    for (const f of fields) {
      const { constraint } = f

      if (
        constraint !== undefinedValue &&
        constraint.allowed !== undefinedValue
      ) {
        const { allowed } = constraint

        const exp = M / allowed.length

        for (const v of allowed) {
          const obs = counts[f.name][v] ?? 0

          assert.ok(
            obs > exp * 0.5 && obs < exp * 1.5,

            `${name}.${f.name}: value ${v} got ${obs}, expected ~${Math.round(exp)} — allowed-set distribution collapsed`
          )
        }
      }
    }
  }
})
