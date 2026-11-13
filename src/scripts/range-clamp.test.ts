import { test } from "node:test"
import assert from "node:assert/strict"
import { pathToFileURL } from "node:url"
import path from "node:path"

// Range-clamp endpoint-accumulation bound (§4.3 of the manuscript). Clamp
// repair sends a raw ℓ-bit value v to min when v < min and to max when
// v > max, so out-of-range draws accumulate at the endpoints instead of
// folding evenly: P(out = min) = (min+1)/2^ℓ, P(out = max) = (2^ℓ−max)/2^ℓ,
// every interior value keeps 1/2^ℓ. This suite pins the closed form and
// its empirical match on the production generator path, so a change to
// the clamp branch that alters endpoint accumulation fails here rather
// than in the paper.

const __dirname = import.meta.dirname
const root = path.resolve(__dirname, "..", "..")
const algo = await import(pathToFileURL(path.resolve(root, "dist/algo.js")).href)

const {
  genStructuredGenoID,
  completeLayout,
  uuidToBytes,
  getFieldValue,
  rangeClampMass,
} = algo as {
  genStructuredGenoID: (l: unknown) => string
  completeLayout: (name: string, core: unknown[]) => { name: string; fields: { name: string; start: number; length: number; type: string; constraint?: { min?: number; max?: number } }[] }
  uuidToBytes: (u: string) => Uint8Array
  getFieldValue: (b: Uint8Array, f: unknown) => bigint
  rangeClampMass: (ell: number, min: number, max: number) => { pMin: number; pMax: number; pInterior: number; pinned: number }
}

test("range clamp: worked endpoint masses for ell=2, [1,2]", () => {
  // Raw values {0,1,2,3} clamp to {1,1,2,2}: each endpoint takes half.
  const m = rangeClampMass(2, 1, 2)
  assert.equal(m.pMin, 1 / 2)
  assert.equal(m.pMax, 1 / 2)
  assert.equal(m.pInterior, 1 / 4)
  assert.equal(m.pinned, 1 / 2)
})

test("range clamp: masses partition the raw space", () => {
  for (const [ell, min, max] of [[4, 1, 14], [8, 10, 245], [12, 100, 3995]] as const) {
    const m = rangeClampMass(ell, min, max)
    const total = m.pMin + m.pMax + (max - min - 1) * m.pInterior
    assert.ok(Math.abs(total - 1) < 1e-12, `ell=${ell} [${min},${max}] masses sum to ${total}`)
  }
})

test("range clamp: over-wide max never accumulates", () => {
  // The shipped conformance window declares max=4999 on a 12-bit field
  // (domain max 4095), so no raw value exceeds max: only raw 4095 itself
  // lands on the upper endpoint.
  const m = rangeClampMass(12, 100, 4999)
  assert.equal(m.pMin, 101 / 4096)
  assert.equal(m.pMax, 1 / 4096)
  assert.equal(m.pinned, 100 / 4096)
})

test("range clamp: full-width range pins nothing", () => {
  const m = rangeClampMass(8, 0, 255)
  assert.equal(m.pinned, 0)
  assert.equal(m.pMin, 1 / 256)
  assert.equal(m.pMax, 1 / 256)
})

// bun caps ordinary tests at 5s; the draw-count test below costs ~1s
// alone but runs slower in the full suite. A per-test timeout is the
// portable lever both bun and node honor.
const DRAWS_TIMEOUT = 30_000

test("range clamp: production path matches the stated endpoint bound", { timeout: DRAWS_TIMEOUT }, () => {
  const layout = completeLayout("range-clamp-cell", [
    { name: "w", start: 0, length: 8, type: "shard", constraint: { min: 10, max: 245 } },
  ])
  const field = layout.fields.find((f) => f.name === "w")!
  const predicted = rangeClampMass(8, 10, 245)
  const N = 200_000
  let atMin = 0
  let atMax = 0
  for (let i = 0; i < N; i++) {
    const v = Number(getFieldValue(uuidToBytes(genStructuredGenoID(layout)), field))
    assert.ok(v >= 10 && v <= 245, `value ${v} outside the declared range [10, 245]`)
    if (v === 10) atMin++
    else if (v === 245) atMax++
  }
  // ±0.5pp: a 200k-draw cell has binomial SD ≈0.05pp on the endpoints,
  // so this is ~10σ and still tight enough that a changed clamp fails.
  assert.ok(
    Math.abs(atMin / N - predicted.pMin) < 0.005,
    `P(min) measured ${atMin / N} != stated ${predicted.pMin}`,
  )
  assert.ok(
    Math.abs(atMax / N - predicted.pMax) < 0.005,
    `P(max) measured ${atMax / N} != stated ${predicted.pMax}`,
  )
})
