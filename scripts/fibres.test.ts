import { test } from "node:test"
import assert from "node:assert/strict"
import { pathToFileURL } from "node:url"
import path from "node:path"

// Fibre-size theorem (§4.3 of the manuscript). Index-modulo repair maps a
// raw ℓ-bit value v to allowed[v mod m], so the preimage count of
// allowed[i] is floor((2^ℓ - 1 - i)/m) + 1. When the admissible set's
// declaration-order indices form a complete residue system modulo m and
// m divides 2^ℓ, every fibre has exactly 2^ℓ/m elements and the repaired
// distribution is uniform. This suite pins the prediction against every
// shipped generator path, so a change to any repair branch that alters
// the fibre structure fails here rather than in the paper.

const __dirname = import.meta.dirname
const root = path.resolve(__dirname, "..")
const algo = await import(pathToFileURL(path.resolve(root, "dist/algo.js")).href)

const {
  genStructuredGenoID,
  genStructuredGenoIDSingleParent,
  compileLayout,
  completeLayout,
  uuidToBytes,
  getFieldValue,
  DBKEY_LAYOUT,
  MULTITENANT_LAYOUT,
} = algo as {
  genStructuredGenoID: (l: unknown) => string
  genStructuredGenoIDSingleParent: (l: unknown) => string
  compileLayout: (l: unknown, poolSize?: number) => { source: string; fn: () => string }
  completeLayout: (name: string, core: unknown[]) => { name: string; fields: { name: string; start: number; length: number; type: string; constraint?: { allowed?: number[] } }[] }
  uuidToBytes: (u: string) => Uint8Array
  getFieldValue: (b: Uint8Array, f: unknown) => bigint
  DBKEY_LAYOUT: { name: string; fields: { name: string; start: number; length: number; type: string; constraint?: { allowed?: number[] } }[] }
  MULTITENANT_LAYOUT: { name: string; fields: { name: string; start: number; length: number; type: string; constraint?: { allowed?: number[] } }[] }
}

// Sufficiency condition for exact uniformity on the compiled path
// (unguarded `A[v mod m]`): every residue class has the same size,
// which holds exactly when m divides 2^ℓ.
function isExactlyUniformCompiled(allowed: number[], ell: number): boolean {
  return 2 ** ell % allowed.length === 0
}

// Sufficiency condition for exact uniformity on the pooled path, which
// keeps an already-admissible value as itself. Its fibre for a_i is
// 1 + C_i - G_i, where C_i is the size of residue class i and G_i the
// number of admissible values inside it, so equality with 2^ℓ/m needs
// both m | 2^ℓ and exactly one admissible value per residue class.
function isExactlyUniformGuarded(allowed: number[], ell: number): boolean {
  const m = allowed.length
  if (!isExactlyUniformCompiled(allowed, ell)) return false
  return new Set(allowed.map((v) => v % m)).size === m
}

// Fibre sizes under the unguarded compiled operator A[v mod m].
function fibreSize(index: number, m: number, ell: number): number {
  return Math.floor((2 ** ell - 1 - index) / m) + 1
}

// Fibre sizes under the guarded pooled operator `v in A ? v : A[v mod m]`.
function guardedFibreSize(index: number, allowed: number[], ell: number): number {
  const m = allowed.length
  const classSize = Math.floor((2 ** ell - 1 - index) / m) + 1
  const admissibleInClass = allowed.filter((a) => a % m === index % m).length
  return 1 + classSize - admissibleInClass
}

// Distinct fibre count observed from the generator: every emitted value
// must be admissible, and the observed value multiplicities must equal
// the predicted fibre multiplicities (as a multiset, not per-value, so
// the test is insensitive to which residue is heavy).
function observedFibreMultiplicities(
  gen: () => string,
  layout: { fields: { name: string; start: number; length: number; type: string; constraint?: { allowed?: number[] } }[] },
  fieldName: string,
  allowed: number[],
  draws: number,
): number[] {
  const field = layout.fields.find((f) => f.name === fieldName)
  assert.ok(field, `layout has no field ${fieldName}`)
  const counts = new Map<number, number>(allowed.map((v) => [v, 0]))
  for (let i = 0; i < draws; i++) {
    const v = Number(getFieldValue(uuidToBytes(gen()), field))
    const c = counts.get(v)
    counts.set(v, (c ?? 0) + 1)
  }
  const allAdmissible = allowed.every((v) => (counts.get(v) ?? 0) > 0)
  assert.ok(allAdmissible, `some admissible value never emitted: ${JSON.stringify([...counts])}`)
  return [...counts.values()].toSorted((a, b) => b - a)
}

function predictedFibreMultiplicities(allowed: number[], ell: number): number[] {
  return allowed.map((_, i) => fibreSize(i, allowed.length, ell)).toSorted((a, b) => b - a)
}

// The count of draws whose per-value count is zero must stay zero, and
// the multiplicity profile must match the predicted fibre profile.
// Each observed fibre count is compared to its predicted size scaled to
// the draw count, with a ±1-cell tolerance. One cell at 200k draws has a
// binomial SD of ≈0.23 of a 256-unit cell, so ±1 is well beyond 4σ and
// still tight enough that a changed repair branch fails here.
function assertProfile(label: string, observed: number[], predicted: number[], draws: number, ell: number): void {
  const scale = draws / 2 ** ell
  const observedScaled = observed.map((c) => c / scale)
  let worst = 0
  for (let k = 0; k < observedScaled.length; k++) worst = Math.max(worst, Math.abs(observedScaled[k] - predicted[k]))
  assert.ok(
    worst <= 1,
    `${label}: observed fibre profile [${observedScaled.map((c) => c.toFixed(2)).join(", ")}] != predicted [${predicted.join(", ")}] (max deviation ${worst.toFixed(2)} cells)`,
  )
}

function assertFibreProfile(label: string, gen: () => string, layout: unknown, fieldName: string, allowed: number[], ell: number, draws: number): void {
  const observed = observedFibreMultiplicities(gen, layout as never, fieldName, allowed, draws)
  assertProfile(label, observed, predictedFibreMultiplicities(allowed, ell), draws, ell)
}

// Same check against the guarded pooled operator, whose fibre for a_i is
// 1 + C_i - G_i rather than C_i.
function assertGuardedFibreProfile(label: string, gen: () => string, draws: number): void {
  const observed = observedFibreMultiplicities(gen, DBKEY_LAYOUT, "shard", dbkeyAllowed, draws)
  const predicted = dbkeyAllowed.map((_, i) => guardedFibreSize(i, dbkeyAllowed, 8)).toSorted((a, b) => b - a)
  assertProfile(label, observed, predicted, draws, 8)
}

const dbkeyShard = DBKEY_LAYOUT.fields.find((f) => f.name === "shard")!
const dbkeyAllowed = dbkeyShard.constraint!.allowed!
assert.equal(dbkeyShard.length, 8)

test("fibre theorem: dbkey shard predicted profile is (52,51,51,51,51) with value 1 heavy", () => {
  const predicted = predictedFibreMultiplicities(dbkeyAllowed, 8)
  assert.deepEqual(predicted, [52, 51, 51, 51, 51])
  // Value 1 sits at index 0, whose residue class is the heavy one
  // because 256 mod 5 = 1.
  assert.equal(fibreSize(0, 5, 8), 52)
  for (const i of [1, 2, 3, 4]) assert.equal(fibreSize(i, 5, 8), 51)
  assert.equal(fibreSize(0, 5, 8) + 4 * fibreSize(1, 5, 8), 256, "fibres must partition the 256 raw values")
})

const DRAWS = 200_000

test("fibre theorem: multitenant tenant and region are exactly uniform on both paths", () => {
  for (const name of ["tenant", "region"]) {
    const f = MULTITENANT_LAYOUT.fields.find((x) => x.name === name)!
    const allowed = f.constraint!.allowed!
    assert.ok(isExactlyUniformCompiled(allowed, f.length), `${name} must be exactly uniform on the compiled path`)
    assert.ok(isExactlyUniformGuarded(allowed, f.length), `${name} must be exactly uniform on the pooled path`)
    const uniq = new Set(allowed.map((_, i) => fibreSize(i, allowed.length, f.length)))
    assert.equal(uniq.size, 1, `${name} predicted fibres must all be equal, got ${[...uniq]}`)
  }
})

test("fibre theorem: compiled production path reproduces the predicted dbkey profile", () => {
  const compiled = compileLayout(DBKEY_LAYOUT)
  assertFibreProfile("compiled dbkey", compiled.fn, DBKEY_LAYOUT, "shard", dbkeyAllowed, 8, DRAWS)
})

test("fibre theorem: single-parent pooled path reproduces the predicted guarded dbkey profile", () => {
  assertGuardedFibreProfile("pooled dbkey", () => genStructuredGenoIDSingleParent(DBKEY_LAYOUT), DRAWS)
})

test("fibre theorem: production genStructuredGenoID reproduces the predicted dbkey profile", () => {
  assertFibreProfile("production dbkey", () => genStructuredGenoID(DBKEY_LAYOUT), DBKEY_LAYOUT, "shard", dbkeyAllowed, 8, DRAWS)
})

// The two shipped repair operators agree on every contiguous admissible
// set — which is why dbkey and multitenant are path-insensitive — and
// diverge as soon as the set skips a residue class.
test("fibre theorem: compiled and pooled paths agree on contiguous sets and differ on non-contiguous ones", () => {
  for (const allowed of [[1, 2, 3, 4, 5], [1, 2, 3, 4, 5, 6, 7, 8], [1, 2, 3, 4]]) {
    const compiled = predictedFibreMultiplicities(allowed, 8)
    const guarded = allowed.map((_, i) => guardedFibreSize(i, allowed, 8)).toSorted((a, b) => b - a)
    assert.deepEqual(compiled, guarded, `contiguous allowed=[${allowed}] must give identical fibre profiles`)
  }
  // allowed=[0,2] skips residue 1: m | 2^ℓ, so the unguarded compiled
  // path stays uniform, while the guarded path folds residue-1 draws
  // onto value 2 and yields a 1:3 split.
  assert.ok(isExactlyUniformCompiled([0, 2], 2), "m | 2^ell makes the compiled path uniform regardless of the set")
  assert.equal(isExactlyUniformGuarded([0, 2], 2), false, "the pooled path needs one admissible value per residue class")
  assert.deepEqual(predictedFibreMultiplicities([0, 2], 2), [2, 2])
  assert.deepEqual([0, 2].map((_, i) => guardedFibreSize(i, [0, 2], 2)), [1, 3])
})

// Empirical counterpart of the path divergence: the pooled generator
// really does emit ≈3:1 on allowed=[0,2] where the compiled default
// stays 50/50.
test("fibre theorem: pooled path emits 75/25 on allowed=[0,2] where the compiled path stays uniform", () => {
  const layout = completeLayout("fibre-counterexample", [
    { name: "f", start: 0, length: 2, type: "shard", constraint: { allowed: [0, 2] } },
  ])
  const N = 400_000
  // allowed=[0,2]: the guarded pool keeps 0 for itself (1 preimage of 4)
  // and folds the residue-1 draws onto 2, so 2 is the heavy value.
  const tally = (gen: () => string) => {
    let heavy = 0
    let light = 0
    for (let i = 0; i < N; i++) {
      const v = Number(getFieldValue(uuidToBytes(gen()), layout.fields[0]))
      if (v === 2) heavy++
      else if (v === 0) light++
      else assert.fail(`value ${v} outside the declared admissible set`)
    }
    return heavy / light
  }
  const compiledRatio = tally(() => genStructuredGenoID(layout))
  assert.ok(
    compiledRatio > 0.9 && compiledRatio < 1.1,
    `compiled path must stay uniform on allowed=[0,2], observed ${compiledRatio.toFixed(2)}:1`,
  )
  const pooledRatio = tally(() => genStructuredGenoIDSingleParent(layout))
  assert.ok(
    pooledRatio > 2.4 && pooledRatio < 3.6,
    `pooled path must show the ≈3:1 split on allowed=[0,2], observed ${pooledRatio.toFixed(2)}:1`,
  )
})

