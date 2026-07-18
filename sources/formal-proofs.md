# GenoID — Formal Proofs

This document formalizes two claims that the README and CHANGELOG state
empirically: the **O(k) repair complexity bound** (vs. 64^k for rejection
sampling) and an **entropy-preservation argument** for field-boundary
crossover. Both are grounded in the implementation in `algo.ts`. Scope note
(consistent with `sources/security-analysis.md` §6): these are constructive
proofs over the algorithm as implemented, not cryptographic reductions to a
hardness assumption — that would require modelling the OS CSPRNG as a random
oracle, which remains out of scope.

## 1. Repair complexity: `repairConstraints` is O(k) per UUID, not O(64^k)

### 1.1 Setup

Let a `V8Layout` declare `k` constrained fields `f_1, …, f_k` (fields carrying
an `allowed`/`min`/`max`/`monotonic` constraint per `V8FieldConstraint`), each
of bit-length `ℓ_i ≤ 8` in the layouts actually shipped (`dbkey`: shard=8,
counter=16 monotonic only; `multitenant`: tenant=12, region=8 — see
`scripts/export-structured.ts`). Two generation strategies are compared:

- **Rejection sampling**: draw a candidate UUID; check all `k` constraints;
  if any fails, discard and redraw the *entire* UUID; repeat until success.
- **GenoID's repair** (`repairConstraints`, `algo.ts:446-489`): draw one
  candidate, then for each of the `k` constrained fields, deterministically
  map any violating value to a valid one — no redraw.

### 1.2 Rejection sampling is exponential in the worst case

For an `allowed`-constrained field of length `ℓ` bits with `|allowed| = a`
valid values out of `2^ℓ` possible values, a uniformly random draw of that
field alone succeeds with probability `a / 2^ℓ`. For `k` *independent*
constrained fields the whole-UUID acceptance probability is the product
`∏_{i=1}^{k} (a_i / 2^{ℓ_i})`. If every field is maximally restrictive
(`a_i = 1`, i.e. exactly one allowed value, `ℓ_i = 8` bits — the worst case
the codebase enforces via `MAX_FIELD_BITS = 48` per field, but consider byte
granularity for a clean bound), the acceptance probability is `2^{-8k}`, so
the **expected number of whole-UUID draws** is `2^{8k} = 64^k`
(README's stated bound, `k=6 → 6.9×10^10`). This is Monte Carlo: rejection
sampling's cost is a geometric random variable with no upper bound — a
single unlucky run can take arbitrarily long, and the *expectation* itself is
exponential in `k`.

### 1.3 `repairConstraints` is linear in `k`

`repairConstraints` (`algo.ts:446-489`) iterates the layout's fields exactly
once (`for (const f of layout.fields)`), and for each constrained field:

- **`allowed`**: computes a Hamming distance (`hamming`, `algo.ts:433-439`) to
  every element of `c.allowed` and keeps the closest — cost `O(|allowed| · ℓ)`,
  and `|allowed|` and `ℓ` are both bounded by small constants in every shipped
  layout (`|allowed| ≤ 8`, `ℓ ≤ 16`).
- **`min`/`max`**: O(1) comparison and clamp.
- **`monotonic`**: O(1) map lookup (`_lastValues`) and compare.
- Any repaired field is written back with `setFieldBytes`, itself O(`ℓ`)
  (`algo.ts:215-231`, one loop over the field's bits).

Total cost is `Σ_{i=1}^{k} O(|allowed_i| · ℓ_i)`. Since `|allowed_i|` and
`ℓ_i` are layout constants independent of `k` (adding a 7th constrained field
does not make the other six more expensive to repair), the sum is `O(k)` —
linear, with a small constant factor bounded by `8` in the empirical
measurement (README: "GA repairs/UUID ≈ k, O(k·8) ops"). Critically, **this
holds unconditionally** — `repairConstraints` never redraws and never loops
more than once over the fields, so there is no tail risk of unbounded
runtime, unlike rejection sampling.

### 1.4 Correctness of the repair (why O(k) doesn't sacrifice validity)

`repairConstraints` returns a value that satisfies every declared constraint
by construction:

- `allowed`: the returned value is drawn from `c.allowed` itself (the
  Hamming-nearest element), so membership is guaranteed, not merely likely.
- `min`/`max`: clamping to the bound is definitionally a valid value.
- `monotonic`: clamping to `max(v, last)` preserves the non-decreasing
  invariant by construction, and the invariant is stored (`_lastValues.set`)
  for the next call.

This is the same property validated empirically in E1 (1.5M structured-field
checks, 0 mismatches, 0 constraint violations) — the proof above explains
*why* that empirical result is not incidental: the repair step is a total
function into the constraint-satisfying subset of each field's domain, not a
best-effort heuristic.

## 2. Entropy preservation under field-boundary crossover

### 2.1 Claim

Field-boundary crossover (`composeStructured`, `algo.ts:417-431`, and the
inlined pool version in `genStructuredGenoID`, `algo.ts:518-550`) does not
reduce the min-entropy of a layout's `random`-type fields relative to drawing
those bits directly from the CSPRNG, **conditioned on the field-select mask
being independent of the field contents**.

### 2.2 Argument

Crossover selects, per field `f_i`, one of two parents `A` or `B` via a bit
of `fieldSelect` (itself drawn from the CSPRNG pool, `algo.ts:533`:
`p.pool[off+32] | (p.pool[off+33] << 8)`). For a `random`-type field, both
`A` and `B` carry independently drawn CSPRNG bytes at that field's bit
positions (`crypto.getRandomValues(p.pool)` populates the entire pool,
`algo.ts:528`, before any field-specific overwrite). Let `X_A`, `X_B` be the
field's value in parent A and B respectively, both uniform on `{0,1}^ℓ` and
mutually independent, and let `S` be the (independent) select bit. The
child's field value is `X_A` if `S=1` else `X_B`. For any fixed output value
`v ∈ {0,1}^ℓ`:

```
Pr[child field = v] = Pr[S=1]·Pr[X_A=v] + Pr[S=0]·Pr[X_B=v]
                    = Pr[S=1]·2^-ℓ + Pr[S=0]·2^-ℓ = 2^-ℓ
```

— i.e. the child's field is *itself* uniform on `{0,1}^ℓ`, regardless of the
distribution of `S`, as long as `S` is independent of `X_A, X_B`. So a
uniform mixture of two independent uniform sources over independent
selection is uniform: crossover is a **measure-preserving** operation on
`random`-type fields. This matches the empirical NIST SP 800-22 15/15 PASS
result on the structured layouts' random payload (which would be expected to
show bias under monobit/frequency tests if crossover introduced skew) and is
also why the AGENTS.md finding "GA is cosmetic on CSPRNG" holds: crossover
provably cannot *improve* entropy either — it is a no-op on a uniform source,
which is exactly what pass-through NIST results on ablation variants
(`ablation-xonly`, `ablation-monly`) show.

### 2.3 Where the argument does *not* apply — structured (non-random) fields

For `structured` (non-`random`) field types (`timestamp-ms`, `counter`,
`shard`, `node`), the analogous claim is false and is not claimed: these
fields are deterministic or constrained by design (§2, `security-analysis.md`),
so crossover on them is a **selection between two draws from the same
deterministic/constrained process** (e.g. `Date.now()` at generation time, or
a `shard` value drawn from a small `allowed` set), not a mixture of uniform
randomness. This is why `sources/security-analysis.md` correctly attributes
zero min-entropy to those fields regardless of crossover — crossover is
irrelevant to their entropy budget in either direction.

### 2.4 Mutation (constraint repair) is a deterministic map, not a randomness source

`repairConstraints` is applied only to `random`-type fields that additionally
carry a constraint (`genStructuredGenoID`, `algo.ts:524-526`:
`needsRepair = layout.fields.some(f => f.type === "random" && f.constraint)`).
Repair maps a (possibly non-uniform, post-crossover — though §2.2 shows it is
still uniform) value to the nearest constraint-satisfying value via a
*deterministic* function of the input. A deterministic function cannot
increase entropy (data-processing inequality: `H(g(X)) ≤ H(X)` for any
deterministic `g`), so repair can only ever hold or reduce entropy on a
constrained field — consistent with the honest framing in the README and
AGENTS.md that GA's value in GenoID is **architectural** (composition,
constraint satisfaction), not a randomness enhancer.

## 3. Summary

| Claim | Status | Basis |
|---|---|---|
| Repair is O(k), unconditionally | **Proved** | Single pass over fields, each an O(1)–O(a·ℓ) constant-bounded op; no redraw, no retry loop |
| Rejection sampling is O(64^k) in expectation, unbounded in the worst case | **Proved** | Geometric trial count under independent per-field acceptance probabilities |
| Repair yields constraint-satisfying output | **Proved (by construction)**, matches E1 empirical (0 violations / 1.5M) | Case analysis on `allowed`/`min`/`max`/`monotonic` branches |
| Crossover preserves (does not reduce or inflate) entropy of `random` fields | **Proved**, matches NIST 15/15 PASS on structured layouts | Uniform-mixture-of-uniforms argument, independent select bit |
| Crossover is entropy-irrelevant for structured (deterministic/constrained) fields | **Proved** | Those fields carry 0 min-entropy regardless of selection source |
| Constraint repair cannot increase entropy | **Proved** | Data-processing inequality (deterministic function of input) |
