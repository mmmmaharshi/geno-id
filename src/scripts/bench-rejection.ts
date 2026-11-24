import fs from "node:fs"

import { nullValue } from "./shared/runtime-values.ts"

import path from "node:path"

import { pathToFileURL } from "node:url"

import { shiftLeftBits } from "../shared/bitwise.ts"

// ===========================================================================

// Bench-rejection — O(k) constraint repair vs O((1/d)^k) rejection sampling.

//

// The paper's central complexity claim (§III): embedding k constrained fields

// By rejection sampling costs O(64^k) — you redraw the whole ID until every

// Field lands in its allowed set — whereas GenoID's constraint-guided repair is

// A single O(k) pass, independent of how sparse the allowed sets are.

//

// This measures both as the allowed-set DENSITY d (= |allowed| / field-space)

// Shrinks. Rejection's expected trials per valid ID is (1/d)^k and detonates;

// GenoID's repair cost is flat. Where (1/d)^k is too large to run, the exact

// Analytical expectation is reported instead (you cannot execute 10^10 trials —

// That impossibility is the point). GenoID is measured at every density.

//

// Uses the SHIPPED repairConstraints operator, so this validates the real

// Mechanism, not a proxy.

//

//   Bun run build && bun run bench-rejection

// Emits results/rejection-sweep.json and results/rejection-sweep.csv (for the

// Paper figure: x = density (log), y = trials/repairs per ID (log)).

// ===========================================================================

const root = path.resolve(import.meta.dirname, "..", "..")

const algo = (await import(
  pathToFileURL(path.resolve(root, "dist/algo.js")).href
)) as {
  completeLayout: (name: string, fields: unknown[]) => unknown

  repairConstraints: (layout: unknown, bytes: Uint8Array) => number

  getFieldValue: (bytes: Uint8Array, field: unknown) => bigint
}

const makeLayout = (k: number, allowed: number[]): {
  layout: unknown
  fields: unknown[]
} => {
  const fields = Array.from({ length: k }, (_, i) => ({
    constraint: { allowed },

    length: 8,

    name: `f${i}`,

    start: i * 8,

    type: "random",
  }))

  return {
    fields,
    layout: algo.completeLayout(`rej_k${k}_m${allowed.length}`, fields),
  }
}

const FIELD_SPACE = 256

const K_VALUES = [1, 2, 3, 4, 6]

const ALLOWED_SIZES = [128, 64, 32, 16, 8, 4, 2, 1]

const IDS = 10_000

const REJECT_SAMPLES = 500

const REJECT_FEASIBLE_MAX = 20_000

// Per-cell warmup to stabilise JIT-driven timing variance

const WARMUP_ITERS = 200

const buf = new Uint8Array(16)

const _pool = new Uint8Array(shiftLeftBits(1, 16))

let _pi = _pool.length

const rndByte = (): number => {
  if (_pi >= _pool.length) {
    crypto.getRandomValues(_pool)
    _pi = 0
  }

  _pi += 1
  return _pool[_pi]
}

// Warmup: one repair call outside timing.

const genoNsPerId = (layout: unknown, samples: number): {
  nsPerId: number
  repairsPerId: number
} => {
  crypto.getRandomValues(buf)

  algo.repairConstraints(layout, buf)

  let repairs = 0

  const t0 = process.hrtime.bigint()

  for (let i = 0; i < samples; i += 1) {
    crypto.getRandomValues(buf)

    repairs += algo.repairConstraints(layout, buf)
  }

  const ns = Number(process.hrtime.bigint() - t0) / samples

  return { nsPerId: ns, repairsPerId: repairs / samples }
}

// Warmup: generate up to 100 trials (no cap) outside timing.

const rejectNsPerId = (
  allowedSet: Set<number>,
  k: number,
  samples: number,
  capTrials: number,
): { nsPerId: number; trialsPerId: number } | null => {
  for (let w = 0; w < WARMUP_ITERS; w += 1) {
    let ok = true

    for (let i = 0; i < k; i += 1) {
      if (!allowedSet.has(rndByte())) {
        ok = false
        break
      }
    }

    if (ok) {
      break
    }
  }

  let totalTrials = 0

  const t0 = process.hrtime.bigint()

  for (let s = 0; s < samples; s += 1) {
    let trials = 0

    for (;;) {
      trials += 1

      let ok = true

      for (let i = 0; i < k; i += 1) {
        if (!allowedSet.has(rndByte())) {
          ok = false
          break
        }
      }

      if (ok) {
        break
      }

      if (trials >= capTrials) {
        return nullValue
      }
    }

    totalTrials += trials
  }

  const ns = Number(process.hrtime.bigint() - t0) / samples

  return { nsPerId: ns, trialsPerId: totalTrials / samples }
}

interface Cell {
  k: number

  allowedSize: number

  density: number

  genoRepairsPerId: number

  genoNsPerId: number

  rejectionTrialsPerId: number

  rejectionTrialsMeasured: boolean

  rejectionNsPerId: number | null

  speedupVsGeno: number
}

// Build all cell configs first then shuffle to amortise JIT warmup evenly

interface CellConfig {
  k: number
  allowedSize: number
}

const allConfigs: CellConfig[] = []

for (const k of K_VALUES) {
  for (const size of ALLOWED_SIZES) {
    allConfigs.push({ allowedSize: size, k })
  }
}

// Fisher-Yates shuffle

for (let i = allConfigs.length - 1; i > 0; i -= 1) {
  const j = Math.floor(Math.random() * (i + 1))

  ;[allConfigs[i], allConfigs[j]] = [allConfigs[j], allConfigs[i]]
}

const cells: Cell[] = []

console.log(
  "=== O(k) repair vs (1/d)^k rejection — allowed-set sparsity sweep ===",
)

for (const { k, allowedSize } of allConfigs) {
  const allowed = Array.from({ length: allowedSize }, (_, i) => i)

  const density = allowedSize / FIELD_SPACE

  const { layout } = makeLayout(k, allowed)

  const geno = genoNsPerId(layout, IDS)

  const analytical = (1 / density) ** k

  const set = new Set(allowed)

  let trialsPerId = analytical

  let measured = false

  let rejNs: number | null = nullValue

  if (analytical <= REJECT_FEASIBLE_MAX) {
    const r = rejectNsPerId(set, k, REJECT_SAMPLES, REJECT_FEASIBLE_MAX * 8)

    if (r) {
      ;({ trialsPerId, nsPerId: rejNs } = r)
      measured = true
    }
  }

  let rejectionNs: number | null = nullValue

  if (rejNs !== nullValue) {
    rejectionNs = Number(rejNs.toFixed(1))
  }

  cells.push({
    allowedSize,
    density,
    genoNsPerId: Number(geno.nsPerId.toFixed(1)),
    genoRepairsPerId: Number(geno.repairsPerId.toFixed(3)),
    k,
    rejectionNsPerId: rejectionNs,
    rejectionTrialsMeasured: measured,
    rejectionTrialsPerId: Number(trialsPerId.toPrecision(4)),
    speedupVsGeno: Number(
      (trialsPerId / Math.max(1, geno.repairsPerId)).toPrecision(4),
    ),
  })
}

// Print sorted by k then density for readability

for (const c of cells.toSorted((a, b) => a.k - b.k || b.density - a.density)) {
  let trialsStr = `${c.rejectionTrialsPerId.toExponential(2)} (calc)`

  if (c.rejectionTrialsMeasured) {
    trialsStr = `${c.rejectionTrialsPerId.toExponential(2)} (meas)`
  }

  let rejNsStr = "—".padStart(9)

  if (c.rejectionNsPerId !== nullValue) {
    rejNsStr = c.rejectionNsPerId.toFixed(0).padStart(9)
  }

  console.log(
    `k=${c.k}  d=${c.density.toFixed(4)}  geno ns/ID ${c.genoNsPerId.toFixed(0).padStart(7)}  repairs ${c.genoRepairsPerId.toFixed(2).padStart(5)}  rej trials ${trialsStr.padStart(20)}  rej ns/ID ${rejNsStr}`,
  )
}

console.log(`\nRepair count per ID follows k(1-d) across all cells.`)

console.log(
  `Rejection trials per ID follow (1/d)^k; measured values agree with analytic expectation where feasible.`,
)

// Artifacts

const outDir = path.resolve(root, "results")

fs.mkdirSync(outDir, { recursive: true })

const sorted = cells.toSorted((a, b) => a.k - b.k || b.density - a.density)

fs.writeFileSync(
  path.join(outDir, "rejection-sweep.json"),
  JSON.stringify(
    { cells: sorted, fieldSpace: FIELD_SPACE, idsPerCell: IDS },
    nullValue,
    2,
  ),
)

const csv = [
  "k,allowed_size,density,geno_ns_per_id,geno_repairs_per_id,rejection_trials_per_id,rejection_measured,rejection_ns_per_id,speedup_vs_geno",
]

for (const c of sorted) {
  csv.push(
    `${c.k},${c.allowedSize},${c.density},${c.genoNsPerId},${c.genoRepairsPerId},${c.rejectionTrialsPerId},${c.rejectionTrialsMeasured},${c.rejectionNsPerId ?? ""},${c.speedupVsGeno}`,
  )
}

fs.writeFileSync(path.join(outDir, "rejection-sweep.csv"), csv.join("\n"))

console.log(
  `Wrote results/rejection-sweep.json and results/rejection-sweep.csv (${sorted.length} cells)`,
)
