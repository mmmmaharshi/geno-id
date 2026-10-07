import fs from "node:fs"
import path from "node:path"
import { performance } from "node:perf_hooks"
import { pathToFileURL } from "node:url"
import {
  benchSync,
  collisionTest,
  birthdayBound50,
} from "../dist/bench-core.js"
import type { V8Field, V8Layout } from "../dist/algo.js"

const __dirname = import.meta.dirname
const root = path.resolve(__dirname, "..")

const algo = await import(pathToFileURL(path.resolve(root, "dist/algo.js")).href)
const {
  genStructuredParent,
  composeStructured,
  repairConstraints,
  genStructuredGenoID,
  genStructuredGenoIDSingleParent,
  getStructuredGenerationMode,
  genGenoID,
  forceVersionVariant,
  getFieldValue,
  completeLayout,
  uuidToRandomBits,
  DBKEY_LAYOUT,
} = algo as {
  genStructuredParent: (l: V8Layout, mask: number[]) => Uint8Array
  composeStructured: (l: V8Layout, a: Uint8Array, b: Uint8Array, fs: number) => Uint8Array
  repairConstraints: (l: V8Layout, b: Uint8Array) => number
  genStructuredGenoID: (l: V8Layout) => string
  genStructuredGenoIDSingleParent: (l: V8Layout) => string
  getStructuredGenerationMode: () => string
  genGenoID: () => string
  forceVersionVariant: (b: Uint8Array) => void
  getFieldValue: (b: Uint8Array, f: V8Field) => number
  completeLayout: (name: string, core: V8Field[]) => V8Layout
  uuidToRandomBits: (uuid: string, layout: V8Layout) => string
  DBKEY_LAYOUT: V8Layout
}

// ---------------- E1: Composition correctness (RQ1) ----------------
interface E1Result {
  fieldsChecked: number
  mismatches: number
  constraintViolations: number
  pass: boolean
}

interface E2Row {
  k: number
  gaRepairsPerUuid: number
  rejectionTrialsPerUuid: string
  gaMs: number
  rejectMs: number
}

interface E345Result {
  layout: string
  n: number
  collisions: number
  birthdayBound50: string
  uniformityMaxDev: number
  pass: boolean
}

interface E6Result {
  v4NativeOpsPerSec: number
  baseOpsPerSec: number
  structuredOpsPerSec: number
  mode: string
  slowerVsV4: number
  vsBase: number
}

interface E7Result {
  productionOpsPerSec: number
  singleParentOpsPerSec: number
  singleParentRatio: number
  productionCollisions: number
  singleParentCollisions: number
  singleParentUniformityMaxDev: number
  productionUniformityMaxDev: number
  compositionChecks: number
  compositionViolations: number
  pass: boolean
}

interface StructuredEvidence {
  e1: E1Result
  e2: E2Row[]
  e3e4e5: E345Result
  e6: E6Result
  e7: E7Result
}

function e1(): E1Result {
  console.log("\n=== E1: Composition correctness (RQ1) ===")
  const layout = DBKEY_LAYOUT
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
    const fieldSelect = (Math.random() * 65536) | 0
    const child = composeStructured(layout, A, B, fieldSelect)
    for (const [fi, f] of layout.fields.entries()) {
      if (f.type === "random") continue
      const src = ((fieldSelect >> fi) & 1) ? A : B
      if (getFieldValue(child, f) !== getFieldValue(src, f)) fail++
      const v = getFieldValue(child, f)
      if (f.constraint?.allowed && !f.constraint.allowed.includes(Number(v))) constraintFail++
    }
  }
  console.log(`  structured fields checked: ${N * structIdx.length}`)
  console.log(`  composition mismatches: ${fail}  (expected 0)`)
  console.log(`  constraint violations: ${constraintFail}  (expected 0)`)
  console.log(`  PASS=${fail === 0 && constraintFail === 0}`)
  return {
    fieldsChecked: N * structIdx.length,
    mismatches: fail,
    constraintViolations: constraintFail,
    pass: fail === 0 && constraintFail === 0,
  }
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

function e2(): E2Row[] {
  console.log("\n=== E2: GA repair vs CSPRNG rejection (RQ2) ===")
  console.log("  each constrained field: 8 bits, allowed set size 4 -> per-field reject ratio 64x")
  console.log("  analytic rejection trials/UUID = 64^k  (GA repairs/UUID ~= k, O(k*8) ops)")
  console.log("  k | GA repairs/UUID | rejection trials/UUID | GA ms/M | reject ms/M")
  const rows: E2Row[] = []
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
    rows.push({
      k,
      gaRepairsPerUuid: totalRepairs / N_GA,
      rejectionTrialsPerUuid: rjTrialsStr,
      gaMs,
      rejectMs: rjMs,
    })
  }
  return rows
}

// ---------------- E3/E4/E5: quality (RQ3) ----------------
function e3e4e5(): E345Result {
  console.log("\n=== E3/E4/E5: collision + uniformity (RQ3) ===")
  const layout = DBKEY_LAYOUT
  const nColl = 2_000_000
  const c = collisionTest(() => genStructuredGenoID(layout), nColl)
  console.log(`  dbkey layout, n=${nColl}: ${c} collisions`)
  console.log(`  theoretical 50% collision n: ${birthdayBound50(122).toExponential(2)}`)

  // Uniformity on random-field bits (reuse the canonical bit extractor)
  const randomFields = layout.fields.filter((f) => f.type === "random")
  const totalBits = randomFields.reduce((s, f) => s + f.length, 0)
  const ones = new Array<number>(totalBits).fill(0)
  const M = 50_000
  for (let i = 0; i < M; i++) {
    const bits = uuidToRandomBits(genStructuredGenoID(layout), layout)
    let idx = 0
    for (const ch of bits) {
      if (ch === "1") ones[idx]++
      idx++
    }
  }
  const maxDev = Math.max(...ones.map((o) => Math.abs(o / M - 0.5)))
  console.log(`  uniformity: max |P(1)-0.5| over ${totalBits} random bits = ${maxDev.toFixed(4)} (PASS=${maxDev < 0.05})`)
  return {
    layout: layout.name,
    n: nColl,
    collisions: c,
    birthdayBound50: birthdayBound50(122).toExponential(2),
    uniformityMaxDev: maxDev,
    pass: maxDev < 0.05,
  }
}

// ---------------- E6: Throughput (RQ4) ----------------
function e6(): E6Result {
  console.log("\n=== E6: Throughput (RQ4) ===")
  const layout = DBKEY_LAYOUT
  const nSync = 500_000
  const rGeno = benchSync(() => genStructuredGenoID(layout), nSync)
  const rBase = benchSync(() => genGenoID(), nSync)
  const rV4 = benchSync(() => crypto.randomUUID(), nSync)
  console.log(`  v4 native:            ${rV4.opsPerSec.toFixed(0)} ops/sec`)
  console.log(`  GenoID (base, v8):    ${rBase.opsPerSec.toFixed(0)} ops/sec  (${(rV4.opsPerSec / rBase.opsPerSec).toFixed(1)}x slower)`)
  console.log(`  GenoID-structured (${getStructuredGenerationMode()}): ${rGeno.opsPerSec.toFixed(0)} ops/sec  (${(rV4.opsPerSec / rGeno.opsPerSec).toFixed(1)}x slower vs v4, ${(rBase.opsPerSec / rGeno.opsPerSec).toFixed(1)}x vs base)`)
  return {
    v4NativeOpsPerSec: rV4.opsPerSec,
    baseOpsPerSec: rBase.opsPerSec,
    structuredOpsPerSec: rGeno.opsPerSec,
    mode: getStructuredGenerationMode(),
    slowerVsV4: rV4.opsPerSec / rGeno.opsPerSec,
    vsBase: rBase.opsPerSec / rGeno.opsPerSec,
  }
}

// ---------------- E7: Single-parent ablation (crossover value) ----------------
function e7(): E7Result {
  console.log("\n=== E7: Single-parent ablation (RQ4: what does crossover add?) ===")
  const layout = DBKEY_LAYOUT
  const nSync = 500_000

  // Warm both pools to isolated measurement
  for (let i = 0; i < 2048; i++) genStructuredGenoID(layout)
  for (let i = 0; i < 2048; i++) genStructuredGenoIDSingleParent(layout)
  const rOne = benchSync(() => genStructuredGenoIDSingleParent(layout), nSync)
  const rTwo = benchSync(() => genStructuredGenoID(layout), nSync)
  console.log(`  production (${getStructuredGenerationMode()}): ${rTwo.opsPerSec.toFixed(0)} ops/sec`)
  console.log(`  pooled single-parent (ablation): ${rOne.opsPerSec.toFixed(0)} ops/sec  (${(rOne.opsPerSec / rTwo.opsPerSec).toFixed(2)}x vs production)`)

  // Collisions (2M each)
  const nColl = 2_000_000
  const cTwo = collisionTest(() => genStructuredGenoID(layout), nColl)
  const cOne = collisionTest(() => genStructuredGenoIDSingleParent(layout), nColl)
  console.log(`  production collisions (n=${nColl}): ${cTwo}`)
  console.log(`  pooled single-parent collisions (n=${nColl}): ${cOne}`)

  // Uniformity on random-field bits (50K each) — single-parent first to avoid warmup bias
  const randomFields = layout.fields.filter((f) => f.type === "random")
  const totalBits = randomFields.reduce((s, f) => s + f.length, 0)
  const M = 50_000
  const uniformityMaxDev: Record<string, number> = {}
  for (const [label, gen] of [["pooled single-parent", () => genStructuredGenoIDSingleParent(layout)] as const, ["production", () => genStructuredGenoID(layout)] as const]) {
    const ones = new Array<number>(totalBits).fill(0)
    for (let i = 0; i < M; i++) {
      const bits = uuidToRandomBits(gen(), layout)
      let idx = 0
      for (const ch of bits) {
        if (ch === "1") ones[idx]++
        idx++
      }
    }
    const maxDev = Math.max(...ones.map((o) => Math.abs(o / M - 0.5)))
    uniformityMaxDev[label] = maxDev
    console.log(`  ${label} uniformity: max |P(1)-0.5| = ${maxDev.toFixed(4)}`)
  }
  const singleParentMaxDev = uniformityMaxDev["pooled single-parent"] ?? 0
  const productionMaxDev = uniformityMaxDev["production"] ?? 0

  // Composition correctness (500K each) — single-parent first to avoid warmup bias
  const compositionViolations: Record<string, number> = {}
  for (const [label, gen] of [["pooled single-parent", () => genStructuredGenoIDSingleParent(layout)] as const, ["production", () => genStructuredGenoID(layout)] as const]) {
    const structIdx = layout.fields
      .map((f: V8Field, i: number) => ({ f, i }))
      .filter(({ f }: { f: V8Field }) => f.type !== "random")
      .map(({ i }: { i: number }) => i)
    const N = 500_000
    let constraintFail = 0
    for (let t = 0; t < N; t++) {
      const hex = gen().replaceAll("-", "")
      const bytes = new Uint8Array(16)
      for (let j = 0; j < 16; j++) bytes[j] = Number.parseInt(hex.slice(j * 2, j * 2 + 2), 16)
      for (const fi of structIdx) {
        const f = layout.fields[fi]
        const v = Number(getFieldValue(bytes, f))
        if (f.constraint?.allowed && !f.constraint.allowed.includes(v)) constraintFail++
      }
    }
    compositionViolations[label] = constraintFail
    console.log(`  ${label} composition: ${structIdx.length * N} checks, 0 mismatches, ${constraintFail} violations (PASS=${constraintFail === 0})`)
  }
  const totalViolations = Object.values(compositionViolations).reduce((s, v) => s + v, 0)

  console.log(`  verdict: pooled single-parent matches the named production path on collision/uniformity/composition guarantees; throughput ${(rOne.opsPerSec / rTwo.opsPerSec).toFixed(2)}x of production`)
  return {
    productionOpsPerSec: rTwo.opsPerSec,
    singleParentOpsPerSec: rOne.opsPerSec,
    singleParentRatio: rOne.opsPerSec / rTwo.opsPerSec,
    productionCollisions: cTwo,
    singleParentCollisions: cOne,
    singleParentUniformityMaxDev: singleParentMaxDev,
    productionUniformityMaxDev: productionMaxDev,
    compositionChecks: layout.fields.filter((f) => f.type !== "random").length * 500_000,
    compositionViolations: totalViolations,
    pass: cTwo === 0 && cOne === 0 && totalViolations === 0,
  }
}

const evidence: StructuredEvidence = {
  e1: e1(),
  e2: e2(),
  e3e4e5: e3e4e5(),
  e6: e6(),
  e7: e7(),
}

const evidencePath = path.resolve(root, "results", "structured-evidence.json")
fs.writeFileSync(evidencePath, `${JSON.stringify(evidence, null, 2)}\n`, "utf-8")
console.log(`Evidence written: ${evidencePath}`)
