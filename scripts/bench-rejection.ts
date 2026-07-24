// ===========================================================================
// bench-rejection — O(k) constraint repair vs O((1/d)^k) rejection sampling.
//
// The paper's central complexity claim (§III): embedding k constrained fields
// by rejection sampling costs O(64^k) — you redraw the whole ID until every
// field lands in its allowed set — whereas GenoID's constraint-guided repair is
// a single O(k) pass, independent of how sparse the allowed sets are.
//
// This measures both as the allowed-set DENSITY d (= |allowed| / field-space)
// shrinks. Rejection's expected trials per valid ID is (1/d)^k and detonates;
// GenoID's repair cost is flat. Where (1/d)^k is too large to run, the exact
// analytical expectation is reported instead (you cannot execute 10^10 trials —
// that impossibility is the point). GenoID is measured at every density.
//
// Uses the SHIPPED repairConstraints operator, so this validates the real
// mechanism, not a proxy.
//
//   bun run build && bun run bench-rejection
// Emits results/rejection-sweep.json and results/rejection-sweep.csv (for the
// paper figure: x = density (log), y = trials/repairs per ID (log)).
// ===========================================================================

import fs from "node:fs"
import path from "node:path"
import { webcrypto } from "node:crypto"
import { pathToFileURL } from "node:url"

if (!globalThis.crypto) (globalThis as { crypto?: unknown }).crypto = webcrypto

const root = path.resolve(import.meta.dirname, "..")
const algo = (await import(pathToFileURL(path.resolve(root, "dist/algo.js")).href)) as {
  completeLayout: (name: string, fields: unknown[]) => unknown
  repairConstraints: (layout: unknown, bytes: Uint8Array) => number
  getFieldValue: (bytes: Uint8Array, field: unknown) => bigint
}

// k constrained 8-bit fields packed into bytes 0..5 (avoids the v8 version
// nibble at bits 48-51 / variant at 64-65, so k ≤ 6).
function makeLayout(k: number, allowed: number[]): { layout: unknown; fields: unknown[] } {
  const fields = Array.from({ length: k }, (_, i) => ({
    name: `f${i}`,
    start: i * 8,
    length: 8,
    type: "random",
    constraint: { allowed },
  }))
  return { layout: algo.completeLayout(`rej_k${k}_m${allowed.length}`, fields), fields }
}

const FIELD_SPACE = 256
const K_VALUES = [1, 2, 3, 4, 6]
// density = size / 256
const ALLOWED_SIZES = [128, 64, 32, 16, 8, 4, 2, 1]
// GenoID samples per cell
const IDS = 10_000
// rejection samples per feasible cell
const REJECT_SAMPLES = 500
// only run rejection when (1/d)^k below this
const REJECT_FEASIBLE_MAX = 20_000

const buf = new Uint8Array(16)

// Batched CSPRNG byte source — a per-byte crypto syscall would dominate the
// rejection loop; refill a large pool instead.
const _pool = new Uint8Array(1 << 16)
let _pi = _pool.length
function rndByte(): number {
  if (_pi >= _pool.length) { crypto.getRandomValues(_pool); _pi = 0 }
  return _pool[_pi++]
}

// One valid ID the GenoID way: random bytes + a single repair pass.
function genoNsPerId(layout: unknown, samples: number): { nsPerId: number; repairsPerId: number } {
  let repairs = 0
  const t0 = process.hrtime.bigint()
  for (let i = 0; i < samples; i++) {
    crypto.getRandomValues(buf)
    repairs += algo.repairConstraints(layout, buf)
  }
  const ns = Number(process.hrtime.bigint() - t0) / samples
  return { nsPerId: ns, repairsPerId: repairs / samples }
}

// One valid ID the rejection way: redraw all k fields until every one is in the
// allowed set. Returns trials + ns per valid ID (measured), or null if a single
// ID would exceed the cap (then we fall back to the analytical expectation).
function rejectNsPerId(allowedSet: Set<number>, k: number, samples: number, capTrials: number): { nsPerId: number; trialsPerId: number } | null {
  let totalTrials = 0
  const t0 = process.hrtime.bigint()
  for (let s = 0; s < samples; s++) {
    let trials = 0
    for (;;) {
      trials++
      let ok = true
      for (let i = 0; i < k; i++) {
        if (!allowedSet.has(rndByte())) { ok = false; break }
      }
      if (ok) break
      if (trials >= capTrials) return null
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
  // rejection trials / geno repairs-pass (both "operations per valid ID")
  speedupVsGeno: number
}

const cells: Cell[] = []
console.log("=== O(k) repair vs (1/d)^k rejection — allowed-set sparsity sweep ===")
for (const k of K_VALUES) {
  console.log(`\nk = ${k} constrained fields:`)
  console.log("  density   geno ns/ID  geno repairs  rejection trials/ID    rejection ns/ID")
  for (const size of ALLOWED_SIZES) {
    // {0..size-1}
    const allowed = Array.from({ length: size }, (_, i) => i)
    const density = size / FIELD_SPACE
    const { layout } = makeLayout(k, allowed)
    const geno = genoNsPerId(layout, IDS)

    const analytical = (1 / density) ** k
    const set = new Set(allowed)
    let trialsPerId = analytical
    let measured = false
    let rejNs: number | null = null
    if (analytical <= REJECT_FEASIBLE_MAX) {
      const r = rejectNsPerId(set, k, REJECT_SAMPLES, REJECT_FEASIBLE_MAX * 8)
      if (r) { trialsPerId = r.trialsPerId; rejNs = r.nsPerId; measured = true }
    }

    cells.push({
      k, allowedSize: size, density,
      genoRepairsPerId: Number(geno.repairsPerId.toFixed(3)),
      genoNsPerId: Number(geno.nsPerId.toFixed(1)),
      rejectionTrialsPerId: Number(trialsPerId.toPrecision(4)),
      rejectionTrialsMeasured: measured,
      rejectionNsPerId: rejNs === null ? null : Number(rejNs.toFixed(1)),
      speedupVsGeno: Number((trialsPerId / Math.max(1, geno.repairsPerId)).toPrecision(4)),
    })
    const trialsStr = `${trialsPerId.toExponential(2)}${measured ? " (meas)" : " (calc)"}`
    console.log(
      `  ${density.toFixed(4)}  ${geno.nsPerId.toFixed(0).padStart(9)}  ${geno.repairsPerId.toFixed(2).padStart(11)}  ${trialsStr.padStart(20)}  ${rejNs === null ? "—".padStart(14) : rejNs.toFixed(0).padStart(14)}`,
    )
  }
}

// artifacts
const outDir = path.resolve(root, "results")
fs.mkdirSync(outDir, { recursive: true })
fs.writeFileSync(path.join(outDir, "rejection-sweep.json"), JSON.stringify({ fieldSpace: FIELD_SPACE, idsPerCell: IDS, cells }, null, 2))
const csv = ["k,allowed_size,density,geno_ns_per_id,geno_repairs_per_id,rejection_trials_per_id,rejection_measured,rejection_ns_per_id,speedup_vs_geno"]
for (const c of cells) csv.push(`${c.k},${c.allowedSize},${c.density},${c.genoNsPerId},${c.genoRepairsPerId},${c.rejectionTrialsPerId},${c.rejectionTrialsMeasured},${c.rejectionNsPerId ?? ""},${c.speedupVsGeno}`)
fs.writeFileSync(path.join(outDir, "rejection-sweep.csv"), csv.join("\n"))
console.log(`\nGenoID cost is flat across density (single O(k) pass); rejection scales as (1/d)^k.`)
console.log(`Wrote results/rejection-sweep.json and results/rejection-sweep.csv`)
