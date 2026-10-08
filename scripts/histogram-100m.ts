import { writeFileSync, mkdirSync } from "node:fs"
import { execSync } from "node:child_process"
import os from "node:os"
import { performance } from "node:perf_hooks"
import path from "node:path"

interface V8FieldConstraint {
  allowed?: number[]
  monotonic?: boolean
  range?: { min: number; max: number }
}
interface V8Field {
  name: string
  start: number
  length: number
  type: string
  constraint?: V8FieldConstraint
}
interface V8Layout {
  name: string
  fields: V8Field[]
}

const __dirname = import.meta.dirname!
const root = path.resolve(__dirname, "..")
const algoPath = `file://${path.join(root, "dist", "algo.js").replace(/\\/g, "/")}`

const algo = (await import(algoPath)) as {
  genStructuredGenoID: (l: V8Layout) => string
  getFieldValue: (b: Uint8Array, f: V8Field) => number | bigint
  uuidToBytes: (uuid: string) => Uint8Array
  getStructuredGenerationMode: () => string
  DBKEY_LAYOUT: V8Layout
  MULTITENANT_LAYOUT: V8Layout
}

const N = Number(process.argv[2] ?? 100_000_000)

const HEX_LOWER = "0123456789abcdef"
const NIBBLE = new Int8Array(128).fill(-1)
for (let i = 0; i < 16; i++) {
  NIBBLE[HEX_LOWER.codePointAt(i)!] = i
  NIBBLE[HEX_LOWER.toUpperCase().codePointAt(i)!] = i
}

// Canonical UUID string index for hex-character ordinal j (0..31), skipping dashes.
function hexIndex(j: number): number {
  if (j < 8) return j
  if (j < 12) return j + 1
  if (j < 16) return j + 2
  if (j < 20) return j + 3
  return j + 4
}

interface Segment {
  charIndex: number
  mask: number
  shift: number
  bits: number
}

// Split a bit-field into per-canonical-hex-character segments, MSB-first, so a
// field value can be read straight out of the UUID string without re-parsing
// the whole identifier.
function planField(field: V8Field): Segment[] {
  const segs: Segment[] = []
  const j0 = field.start >> 2
  const j1 = (field.start + field.length - 1) >> 2
  for (let j = j0; j <= j1; j++) {    const lo = Math.max(field.start, j * 4) - field.start
    const hi = Math.min(field.start + field.length - 1, j * 4 + 3) - field.start
    const bits = hi - lo + 1
    const shift = 3 - (hi + field.start - j * 4)
    segs.push({ charIndex: hexIndex(j), mask: (2 ** bits - 1) << shift, shift, bits })
  }
  return segs
}

function readField(uuid: string, segs: Segment[]): number {
  let v = 0
  for (const s of segs) {
    v = (v << s.bits) | ((NIBBLE[uuid.codePointAt(s.charIndex)!] & s.mask) >> s.shift)
  }
  return v
}

// Number of raw field values in [0, 2^ell) that fall in residue class r mod m.
function classSize(r: number, m: number, fieldLen: number): number {
  const T = 2 ** fieldLen
  return Math.floor((T - 1 - r) / m) + 1
}

// Shipped compiled path: `[a0,a1,...][raw % m]` — no identity guard, so a
// value's preimage count is exactly the size of its index residue class.
function preimagesCompiled(allowed: number[], index: number, fieldLen: number): number {
  return classSize(index, allowed.length, fieldLen)
}

// Pooled fallback path: `v in A ? v : A[v mod m]` — the identity guard moves
// one element (the admissible value itself) out of the residue class and back
// in as its own preimage, and it pulls the other admissible value sharing that
// residue out of the class.
function preimagesGuarded(allowed: number[], index: number, fieldLen: number): number {
  const m = allowed.length
  const r = index % m
  const sameResidue = allowed.filter((a) => a % m === r).length
  return 1 + classSize(index, m, fieldLen) - sameResidue
}

function samplingSdPp(p: number, n: number): number {
  return 100 * Math.sqrt((p * (1 - p)) / n)
}

interface CountRow {
  value: number
  count: number
  predicted_preimages: number
  predicted_preimages_guarded_path?: number
  observed_pp: number
  predicted_pp: number
  abs_dev_pp: number
  sampling_sd_pp: number
  z: number
}

interface FieldReport {
  field: string
  bit_start: number
  bit_length: number
  allowed: number[]
  repair_operator: string
  exact_uniform: boolean
  counts: CountRow[]
  out_of_allowed_set: number
  max_abs_dev_pp: number
  max_abs_z: number
}

function runLayout(layout: V8Layout): { fields: FieldReport[]; elapsedMs: number } {
  const constrained = layout.fields.filter(
    (f) => Array.isArray(f.constraint?.allowed) && (f.constraint?.allowed?.length ?? 0) > 0,
  )
  const plans = constrained.map((f) => ({ field: f, segs: planField(f) }))

  const counters = new Map<string, Map<number, number>>()
  for (const f of constrained) {
    const m = new Map<number, number>()
    for (const v of f.constraint!.allowed!) m.set(v, 0)
    counters.set(f.name, m)
  }
  const outOfSet = new Map<string, number>()
  for (const f of constrained) outOfSet.set(f.name, 0)

  // The string reader must agree with the shipped byte-level reader before the
  // long run, otherwise the histogram measures the extractor, not the generator.
  for (const { field, segs } of plans) {
    for (let i = 0; i < 512; i++) {
      const u = algo.genStructuredGenoID(layout)
      const viaString = readField(u, segs)
      const viaBytes = Number(algo.getFieldValue(algo.uuidToBytes(u), field))
      if (viaString !== viaBytes) {
        throw new Error(`extractor mismatch on ${layout.name}.${field.name}: ${viaString} != ${viaBytes}`)
      }
    }
  }

  const t0 = performance.now()
  for (let i = 0; i < N; i++) {
    const u = algo.genStructuredGenoID(layout)
    for (const { field, segs } of plans) {
      const v = readField(u, segs)
      const m = counters.get(field.name)!
      if (m.has(v)) m.set(v, m.get(v)! + 1)
      else outOfSet.set(field.name, outOfSet.get(field.name)! + 1)
    }
  }
  const elapsedMs = performance.now() - t0

  const fields: FieldReport[] = constrained.map((f) => {
    const allowed = f.constraint!.allowed!
    const m = counters.get(f.name)!
    const T = 2 ** f.length
    const rows: CountRow[] = allowed.map((v) => {
      const count = m.get(v) ?? 0
      const index = allowed.indexOf(v)
      const predicted = preimagesCompiled(allowed, index, f.length)
      const predictedGuarded = preimagesGuarded(allowed, index, f.length)
      const observedPp = (count / N) * 100
      const predictedPp = (predicted / T) * 100
      const sd = samplingSdPp(predicted / T, N)
      return {
        value: v,
        count,
        predicted_preimages: predicted,
        predicted_preimages_guarded_path: predictedGuarded === predicted ? undefined : predictedGuarded,
        observed_pp: Number(observedPp.toFixed(6)),
        predicted_pp: Number(predictedPp.toFixed(6)),
        abs_dev_pp: Number(Math.abs(observedPp - predictedPp).toFixed(6)),
        sampling_sd_pp: Number(sd.toFixed(6)),
        z: Number(((observedPp - predictedPp) / sd).toFixed(3)),
      }
    })
    const residues = new Set(allowed.map((a) => a % allowed.length))
    return {
      field: f.name,
      bit_start: f.start,
      bit_length: f.length,
      allowed,
      repair_operator: `v in A ? v : A[v mod ${allowed.length}]  (A=[${allowed.join(",")}], ell=${f.length})`,
      exact_uniform: T % allowed.length === 0 && residues.size === allowed.length,
      counts: rows,
      out_of_allowed_set: outOfSet.get(f.name) ?? 0,
      max_abs_dev_pp: Math.max(...rows.map((r) => r.abs_dev_pp)),
      max_abs_z: Math.max(...rows.map((r) => Math.abs(r.z))),
    }
  })

  return { fields, elapsedMs }
}

function gitSha(): string {
  try {
    return execSync("git rev-parse HEAD", { cwd: root, encoding: "utf-8" }).trim()
  } catch {
    return "unknown"
  }
}

function runtimeVersion(): string {
  const globalBun = (globalThis as { Bun?: { version: string } }).Bun
  if (globalBun) return `Bun ${globalBun.version}`
  return `Node ${process.version}`
}

function envInfo(): Record<string, string> {
  const cpu = os.cpus()[0]?.model ?? "unknown"
  return {
    os: `${os.platform()} ${os.release()} ${os.arch()}`,
    cpu_model: cpu,
    logical_cores: String(os.cpus().length),
    runtime: runtimeVersion(),
  }
}

const layouts = [algo.DBKEY_LAYOUT, algo.MULTITENANT_LAYOUT]
const mode = algo.getStructuredGenerationMode()
const generationsPerLayout: Record<string, unknown> = {}

const started = performance.now()
const perLayout = layouts.map((l) => {
  const { fields, elapsedMs } = runLayout(l)
  generationsPerLayout[l.name] = { fields, elapsed_ms: Math.round(elapsedMs * 100) / 100 }
  return l.name
})
const totalMs = performance.now() - started

const report = {
  experiment: "shard-histogram-100m",
  description:
    "Per-field value histogram for declared admissible-set layouts, measured through the shipped genStructuredGenoID() production path",
  draws_per_layout: N,
  structured_generation_mode: mode,
  layouts: perLayout,
  repair_operator: "index-modulo: v in A ? v : A[v mod |A|]",
  sampling_model:
    "binomial; sampling SD = 100 * sqrt(p(1-p)/n) in percentage points, reported per cell",
  exact_uniformity_condition:
    "the admissible set is a complete residue system mod |A| and |A| divides 2^ell; then every admissible value has exactly 2^ell/|A| preimages and the repaired distribution is uniform",
  environment: { ...envInfo(), commit_sha: gitSha(), generated_at: new Date().toISOString() },
  elapsed_ms_total: Math.round(totalMs * 100) / 100,
  per_layout: generationsPerLayout,
}

mkdirSync("results", { recursive: true })
const out = path.join(root, "results", "shard-histogram-100m.json")
writeFileSync(out, `${JSON.stringify(report, null, 2)}\n`)

console.log(`\n=== shard-histogram-100m (${mode}, N=${N.toLocaleString()}/layout) ===`)
for (const name of perLayout) {
  const entry = generationsPerLayout[name] as { fields: FieldReport[]; elapsed_ms: number }
  for (const f of entry.fields) {
    console.log(`${name}.${f.field}: exact_uniform=${f.exact_uniform} max|dev|=${f.max_abs_dev_pp}pp max|z|=${f.max_abs_z}`)
    for (const r of f.counts) {
      console.log(
        `  ${String(r.value).padStart(2)}: count=${r.count.toLocaleString().padStart(13)} obs=${r.observed_pp.toFixed(4)}pp pred=${r.predicted_pp.toFixed(4)}pp dev=${r.abs_dev_pp.toFixed(4)}pp sd=${r.sampling_sd_pp.toFixed(4)}pp z=${r.z.toFixed(2)}`,
      )
    }
  }
}
console.log(`out-of-allowed-set draws: ${JSON.stringify(Object.fromEntries(layouts.map((l) => [l.name, (generationsPerLayout[l.name] as { fields: FieldReport[] }).fields.map((f) => f.out_of_allowed_set)])))}`)
console.log(`Result saved: results/shard-histogram-100m.json (${(report.elapsed_ms_total / 1000).toFixed(1)}s)`)