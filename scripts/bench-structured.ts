import path from "node:path"
import { performance } from "node:perf_hooks"
import {
  benchSync,
  collisionTest,
  birthdayBound50,
} from "../dist/bench-core.js"
import type { V8Field, V8Layout } from "../dist/algo.js"

const __dirname = import.meta.dirname
const root = path.resolve(__dirname, "..")

const algo = await import(path.resolve(root, "dist/algo.js"))
const {
  genStructuredParent,
  composeStructured,
  repairConstraints,
  genStructuredGenoID,
  genGenoID,
  forceVersionVariant,
  getFieldValue,
  completeLayout,
} = algo as {
  genStructuredParent: (l: V8Layout, mask: number[]) => Uint8Array
  composeStructured: (l: V8Layout, a: Uint8Array, b: Uint8Array, fs: number) => Uint8Array
  repairConstraints: (l: V8Layout, b: Uint8Array) => number
  genStructuredGenoID: (l: V8Layout) => string
  genGenoID: () => string
  validateLayout: (l: V8Layout) => void
  forceVersionVariant: (b: Uint8Array) => void
  getFieldValue: (b: Uint8Array, f: V8Field) => number
  completeLayout: (name: string, core: V8Field[]) => V8Layout
}

// ---------------- E1: Composition correctness (RQ1) ----------------
function e1(): void {
  console.log("\n=== E1: Composition correctness (RQ1) ===")
  const layout = completeLayout("dbkey", [
    { name: "timestamp", start: 0, length: 48, type: "timestamp-ms" },
    { name: "shard", start: 52, length: 8, type: "shard", constraint: { allowed: [1, 2, 3, 4, 5] } },
    { name: "counter", start: 66, length: 16, type: "counter", constraint: { monotonic: true } },
  ])
  const structIdx = layout.fields
    .map((f, i) => ({ f, i }))
    .filter(({ f }) => f.type !== "random")
    .map(({ i }) => i)
  const N = 500_000
  let fail = 0
  let constraintFail = 0
  for (let t = 0; t < N; t++) {
    // Both parents fully structured, each independently generated — this is
    // exactly how genStructuredGenoID populates its pooled parents, so
    // field-boundary crossover always inherits a valid structured value.
    const A = genStructuredParent(layout, structIdx)
    const B = genStructuredParent(layout, structIdx)
    const fs = (Math.random() * 65536) | 0
    const child = composeStructured(layout, A, B, fs)
    for (const [fi, f] of layout.fields.entries()) {
      if (f.type === "random") continue
      const src = ((fs >> fi) & 1) ? A : B
      if (getFieldValue(child, f) !== getFieldValue(src, f)) fail++
      const v = getFieldValue(child, f)
      if (f.constraint?.allowed && !f.constraint.allowed.includes(Number(v))) constraintFail++
    }
  }
  console.log(`  structured fields checked: ${N * structIdx.length}`)
  console.log(`  composition mismatches: ${fail}  (expected 0)`)
  console.log(`  constraint violations: ${constraintFail}  (expected 0)`)
  console.log(`  PASS=${fail === 0 && constraintFail === 0}`)
}

// ---------------- E2: Repair vs Rejection (RQ2) ----------------
function makeConstraintLayout(k: number): V8Layout {
  const core: V8Field[] = []
  for (let i = 0; i < k; i++) {
    core.push({
      name: `c${i}`,
      start: i * 8,
      length: 8,
      type: "random",
      constraint: { allowed: [0, 1, 2, 3] },
    })
  }
  return completeLayout(`k${k}`, core)
}

function e2(): void {
  console.log("\n=== E2: GA repair vs CSPRNG rejection (RQ2) ===")
  console.log("  each constrained field: 8 bits, allowed set size 4 -> per-field reject ratio 64x")
  console.log("  analytic rejection trials/UUID = 64^k  (GA repairs/UUID ~= k, O(k*8) ops)")
  console.log("  k | GA repairs/UUID | rejection trials/UUID | GA ms/M | reject ms/M")
  const N_GA = 200_000
  for (let k = 1; k <= 6; k++) {
    const layout = makeConstraintLayout(k)
    const constrained = layout.fields.filter((f) => f.constraint?.allowed)
    // GA path: one CSPRNG fill + repair
    let totalRepairs = 0
    const gaStart = performance.now()
    for (let i = 0; i < N_GA; i++) {
      const bytes = new Uint8Array(16)
      crypto.getRandomValues(bytes)
      forceVersionVariant(bytes)
      totalRepairs += repairConstraints(layout, bytes)
    }
    const gaMs = performance.now() - gaStart
    // Rejection path: measured for k<=2 (feasible); analytic 64^k for k>=3
    let rjTrialsStr: string
    let rjMs = 0
    if (k <= 2) {
      const N_RJ = 5000
      let totalTrials = 0
      const rjStart = performance.now()
      for (let i = 0; i < N_RJ; i++) {
        let trials = 0
        let ok = false
        while (!ok) {
          trials++
          const bytes = new Uint8Array(16)
          crypto.getRandomValues(bytes)
          forceVersionVariant(bytes)
          ok = true
          for (const f of constrained) {
            if (!f.constraint!.allowed!.includes(Number(getFieldValue(bytes, f)))) {
              ok = false
              break
            }
          }
        }
        totalTrials += trials
      }
      rjMs = performance.now() - rjStart
      rjTrialsStr = (totalTrials / N_RJ).toFixed(1)
    } else {
      rjTrialsStr = `64^${k} = ${Math.pow(64, k).toExponential(2)} (analytic)`
    }
    console.log(
      `  ${k} | ${(totalRepairs / N_GA).toFixed(3).padStart(14)} | ${rjTrialsStr.padStart(19)} | ${(gaMs).toFixed(0).padStart(8)} | ${(rjMs).toFixed(0).padStart(9)}`,
    )
  }
}

// ---------------- E3/E4/E5: quality (RQ3) ----------------
function e3e4e5(): void {
  console.log("\n=== E3/E4/E5: collision + uniformity (RQ3) ===")
  const layout = completeLayout("dbkey", [
    { name: "timestamp", start: 0, length: 48, type: "timestamp-ms" },
    { name: "shard", start: 52, length: 8, type: "shard", constraint: { allowed: [1, 2, 3, 4, 5] } },
    { name: "counter", start: 66, length: 16, type: "counter", constraint: { monotonic: true } },
  ])
  const nColl = 2_000_000
  const c = collisionTest(() => genStructuredGenoID(layout), nColl)
  console.log(`  dbkey layout, n=${nColl}: ${c} collisions`)
  console.log(`  theoretical 50% collision n: ${birthdayBound50(122).toExponential(2)}`)

  // Uniformity on random-field bits
  const randomFields = layout.fields.filter((f) => f.type === "random")
  const totalBits = randomFields.reduce((s, f) => s + f.length, 0)
  const ones = new Array<number>(totalBits).fill(0)
  const M = 50_000
  for (let i = 0; i < M; i++) {
    const uuid = genStructuredGenoID(layout)
    const b = new Uint8Array(16)
    const h = uuid.replaceAll("-", "")
    for (let j = 0; j < 16; j++) b[j] = Number.parseInt(h.slice(j * 2, j * 2 + 2), 16)
    let idx = 0
    for (const f of randomFields) {
      for (let bit = 0; bit < f.length; bit++) {
        const pos = f.start + bit
        if ((b[pos >> 3] >> (7 - (pos & 7))) & 1) ones[idx]++
        idx++
      }
    }
  }
  const maxDev = Math.max(...ones.map((o) => Math.abs(o / M - 0.5)))
  console.log(`  uniformity: max |P(1)-0.5| over ${totalBits} random bits = ${maxDev.toFixed(4)} (PASS=${maxDev < 0.05})`)
}

// ---------------- E6: Throughput (RQ4) ----------------
function e6(): void {
  console.log("\n=== E6: Throughput (RQ4) ===")
  const layout = completeLayout("dbkey", [
    { name: "timestamp", start: 0, length: 48, type: "timestamp-ms" },
    { name: "shard", start: 52, length: 8, type: "shard", constraint: { allowed: [1, 2, 3, 4, 5] } },
    { name: "counter", start: 66, length: 16, type: "counter", constraint: { monotonic: true } },
  ])
  const nSync = 500_000
  const rGeno = benchSync(() => genStructuredGenoID(layout), nSync)
  const rBase = benchSync(() => genGenoID(), nSync)
  const rV4 = benchSync(() => crypto.randomUUID(), nSync)
  console.log(`  v4 native:            ${rV4.opsPerSec.toFixed(0)} ops/sec`)
  console.log(`  GenoID (base, v8):    ${rBase.opsPerSec.toFixed(0)} ops/sec  (${(rV4.opsPerSec / rBase.opsPerSec).toFixed(1)}x slower)`)
  console.log(`  GenoID-structured:    ${rGeno.opsPerSec.toFixed(0)} ops/sec  (${(rV4.opsPerSec / rGeno.opsPerSec).toFixed(1)}x slower vs v4, ${(rBase.opsPerSec / rGeno.opsPerSec).toFixed(1)}x vs base)`)
}

e1()
e2()
e3e4e5()
e6()
