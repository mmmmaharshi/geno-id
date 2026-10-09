# Bit allocation under an entropy budget

**Manuscript section:** §4.4 (Bit allocation)
**Implementation:** `algo.ts` — `minBitsForCardinality`, `collisionProbabilityUpperBound`, `minRandomBitsForCollisionBudget`, `planBitAllocation`
**Experiment:** `scripts/bench-bit-allocation.ts` → `results/bit-allocation.json`
**Tests:** `scripts/bit-allocation.test.ts` (24 tests, including exhaustive optimality checks)

## 1. The problem

An RFC 9562 v8 identifier carries 128 bits. Six are fixed — four version bits at
48–51 and two variant bits at 64–65 — leaving 122 usable. Any identifier that
embeds application structure must answer two questions at once:

1. **How wide is each declared field?** A shard field holding one of five values
   needs three bits, not eight. A field wider than its domain wastes residual
   entropy that the collision guarantee depends on.
2. **Where does each field sit?** A field that a query filters on costs more the
   deeper it sits in the key, because every comparison walks past it.

The shipped planner (`placeSchemaFields`, `algo.ts`) answered (2) by sorting
fields into three role ranks — `partition` and `cluster` first, then `lookup`,
then everything else — and within a rank by descending width. It answered (1)
not at all: field widths were caller-declared and never checked against the
cardinality they must represent. No collision-safety constraint existed
anywhere in the compiler.

Neither choice is wrong. Neither is justified. This note supplies the
justification, the correct algorithm for (2), the missing floor for (1), and a
new hard constraint the planner did not have.

## 2. Model

Let the free payload be the bit interval $[0,128)$ with the six reserved bits
removed, giving free segments $S_1=[0,48)$, $S_2=[52,64)$, $S_3=[66,128)$ and
budget $B=122$.

An instance is a set of fields $f_1,\dots,f_m$. Each field $f_i$ has:

| Symbol | Meaning |
|---|---|
| $c_i$ | cardinality — the number of distinct values that must be representable |
| $w_i \ge 0$ | weight — how much queries on this field pay for depth in the key |
| $\ell_i$ | assigned width in bits (a decision variable) |
| $o_i$ | assigned bit offset (a decision variable) |

**Decisions.** Choose widths $\ell_i$ and offsets $o_i$ for every field.

**Constraints.**
- C1 (representability) $\ell_i \ge \lceil \log_2 c_i \rceil$ for all $i$.
- C2 (no overlap) the intervals $[o_i, o_i+\ell_i)$ are pairwise disjoint and
  contain no reserved bit.
- C3 (entropy budget) the residual $r = B - \sum_i \ell_i$ satisfies
  $r \ge R_{\min}$, where $R_{\min}$ is derived from the emission volume and the
  target collision probability (§3).
- C4 (alignment) $o_i \equiv 0 \pmod{a_i}$ where $a_i \in \{1,4,8\}$ is the
  field's declared alignment. The default is 8, which keeps the field
  extractable by a byte predicate.

**Objective.** Minimise weighted depth
\[
  D \;=\; \sum_i w_i\,\bigl(o_i + \ell_i\bigr),
\]
the sum over fields of weight times end-offset. A field's end-offset is how far
into the key a reader must walk before it can discard a row, so $D$ is directly
the comparison work a range of queries performs.

## 3. The entropy constraint

For $n$ identifiers drawn with $r$ random bits, the probability that at least
one pair collides is bounded by
\[
  P_{\text{coll}}(n, r) \;\le\; 1 - \exp\!\left(-\frac{n(n-1)}{2^{\,r+2}}\right).
\]
This is the standard birthday bound, written as an exact upper bound on
$1-\Pr[\text{no collision}]$ rather than the usual approximation.

**Proposition (minimum residual width).** The smallest $r$ with
$P_{\text{coll}}(n,r) \le \tau$ is
\[
  r_{\min} \;=\; \left\lceil \log_2 \frac{n(n-1)}{4\ln\frac{1}{1-\tau}} \right\rceil .
\]

*Proof.* $1-e^{-x} \le \tau$ holds iff $x \le \ln\frac{1}{1-\tau}$. Substituting
$x = n(n-1)/2^{r+2}$ and solving for $r$ gives the closed form. The two
adjacent values are checked explicitly because the ceiling can be off by one
when the argument is within rounding distance of an integer. $\square$

Worked values, produced by `minRandomBitsForCollisionBudget`:

| volume $n$ | target $\tau$ | $r_{\min}$ |
|---|---|---|
| $10^4$ | $10^{-2}$ | 32 |
| $2\times10^6$ | $10^{-2}$ | 47 |
| $2\times10^6$ | $10^{-9}$ | 70 |

For scale: a bare UUIDv4 has $r = 122$ and the shipped `dbkey` layout has
$r = 55$, against a requirement of 47 for two million identifiers.

## 4. Locality allocation is weighted completion time

Give each field a "job" that occupies $\ell_i$ consecutive positions on a
single timeline and completes at $o_i+\ell_i$. Then $D = \sum_i w_i C_i$, the
classic single-machine weighted-completion-time objective $1 \,\|\, \sum w_j C_j$.

**Theorem (locality ordering).** On one unconstrained timeline, $D$ is minimised
by ordering fields in non-increasing $w_i/\ell_i$.

*Proof.* Exchange argument. Take any schedule $S$ with two adjacent fields
$a,b$ in that order where $w_a/\ell_a < w_b/\ell_b$, and let $L$ be the start
of the pair. Swapping them changes only the two terms
\[
  \Delta = \bigl[w_a(L+\ell_a+\ell_b) + w_b(L+\ell_b)\bigr]
         - \bigl[w_b(L+\ell_b+\ell_a) + w_a(L+\ell_a)\bigr]
        = \ell_a\ell_b\!\left(\frac{w_a}{\ell_a}-\frac{w_b}{\ell_b}\right) \le 0 .
\]
So every inversion is a non-improvement to remove, and a fully sorted schedule
has no inversion. $\square$

This is Smith's rule (Smith, 1956). It is the rule the shipped planner did *not*
use: sorting by role rank, then by width, is neither Smith order nor a special
case of it.

**Corollary (width floor).** $\ell_i = \lceil \log_2 c_i \rceil$ is the
entropy-minimising width satisfying C1, because $D$ is non-decreasing in every
$\ell_i$ and every other term of the objective is unaffected by width.

## 5. The reserved bits fragment the timeline, and the guarantee is exact only per segment

C2 splits the timeline into three free segments. Smith's rule is exact for one
unconstrained segment; across a boundary the first-fit packer can be forced into
a placement that no permutation on a contiguous timeline would choose. The
resulting deviation is real, small, and bounded.

Measured on 500 randomised instances (`results/bit-allocation.json`, E-A1):

| Quantity | Value |
|---|---|
| Instances attaining the exhaustive optimum | 495 / 500 (99.0%) |
| Instances with all structure inside $[0,48)$ attaining the optimum | **100%** |
| Instances missing the optimum | 5, with `structuredBits` $\in [51,54]$ — every one crosses bit 48 |
| Relative excess on those 5 | 0.39%, 0.47%, 0.77%, 1.13%, 2.40% |

The guarantee is therefore stated exactly: **the allocator is optimal for any
declaration whose fields fit within one free segment, and misses the optimum by
at most a few percent when structure spills across a reserved region.** The test
suite pins both halves — exhaustive verification on single-segment instances,
and a named fragmented instance whose excess must stay under 5%.

## 6. How much the old order was losing

Same 500 instances, same objective, comparing the allocator's Smith order
against the role-rank order the planner shipped:

| Quantity | Value |
|---|---|
| Instances where role-rank is strictly worse | 418 / 500 |
| Median relative gap | **23.26%** |
| Maximum relative gap | **200.95%** |

The gap is not an artefact of the random instance generator: a two-field
instance with $w_a/\ell_a = 10$ and $w_b/\ell_b = 1/10$ is lost by longest-first
ordering by a factor of six in $D$.

## 7. The entropy–locality frontier

Widening a field buys capacity and costs residual entropy. `E-A2` widens a
tenant field one bit at a time against a fixed weight vector and records both
the weighted depth paid and the collision probability at $n = 2\times10^6$:

| structured bits | residual bits | weighted depth | $P_{\text{coll}}(2\text{M})$ |
|---|---|---|---|
| 46 | 76 | 706 | $1.32\times10^{-11}$ |
| 51 | 71 | 1367 | $4.24\times10^{-10}$ |
| 58 | 64 | 2032 | $5.42\times10^{-8}$ |

Each structural bit costs about 95 units of weighted depth and exactly doubles
the collision probability, so the frontier is a straight line in depth and a
log line in risk. This is the trade the old planner made silently, one
caller-declared width at a time. It is now explicit and checkable.

## 8. What the shipped layout gets right

`E-A3` runs the allocator on the shipped `dbkey` declaration (48-bit timestamp,
5-value shard, 16-bit counter):

| field | width | offset | $w/\ell$ |
|---|---|---|---|
| timestamp | 48 | 0 | 0 (forced leading) |
| shard | 3 | 52 | 13.33 |
| counter | 16 | 66 | 0.3125 |

`structuredBits = 67`, `randomBits = 55` against a requirement of 47. The
weighted-depth improvement over the role-rank order is **zero**: with the
timestamp pinned at offset 0 and only two free fields, the two orders coincide.
This is a validation of the hand-written declaration rather than a weakness of
the result — the planner was already optimal here, and the allocator says so
instead of merely failing to disagree.

The one thing the old declaration got wrong is width: the shard field is
declared at 8 bits for five admissible values, surrendering 5 bits of residual
entropy that C1 would have kept. `minBitsForCardinality(5) = 3` recovers them.

## 9. What is not claimed

- No global optimality across the fragmented timeline. See §5.
- No claim that lower weighted depth improves real query throughput. `D` is a
  proxy for comparison work; the SQLite composite-key experiment is the closest
  empirical check, and it measures point lookups and range scans, not $D$.
- No new constrained-generation theory. The allocation problem is a scheduling
  problem with a classical solution; the contribution is the reduction, the
  entropy constraint, and the measurement of what the old order was losing.
- `w_i` is caller-declared. Nothing here infers it from a workload; the
  `DatabaseWorkloadProfile` fields `readWeight` and `skew` are the intended
  inputs, and mapping them to $w_i$ is left to the caller.

## 10. References

- W. E. Smith, "Various optimizers for single-stage production," *Naval Research
  Logistics Quarterly* 3(1–2), 1956. (Smith's rule for $1\|\sum w_j C_j$.)
- K. Davis, B. Peabody, P. Leach, "Universally Unique IDentifiers (UUIDs),"
  RFC 9562, 2024. (Version and variant bit positions; the 122 custom bits.)
- NIST SP 800-22, 2010. (Statistical-test caveats; not used as a security
  argument here.)
