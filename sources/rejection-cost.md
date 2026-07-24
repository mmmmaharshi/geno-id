# Constraint repair vs. rejection sampling — the sparsity sweep

The empirical face of the paper's central complexity claim (§III): embedding *k*
constrained fields by **rejection sampling** costs O((1/d)^k) — you redraw the
whole identifier until every field lands in its allowed set — whereas GenoID's
**constraint-guided repair** is a single O(k) pass whose cost is *independent* of
how sparse the allowed sets are. This experiment measures both as the allowed-set
density d = |allowed| / field-space shrinks.

It exercises the **shipped** `repairConstraints` operator (not a proxy), so it
validates the real mechanism. Reproduce:

```bash
bun run build && bun run bench-rejection   # writes results/rejection-sweep.{json,csv}
```

## Method

k independent 8-bit fields (field-space 256) are packed into the leading bytes of
a 16-byte buffer. For each (k, density):

- **GenoID:** fill the buffer with CSPRNG bytes, then one `repairConstraints`
  pass maps every out-of-set field to its Hamming-nearest allowed value. Always
  yields one valid identifier. We report ns per valid ID and repairs per ID.
- **Rejection:** redraw all k fields until every one is in its allowed set; report
  trials per valid ID. Where a single valid ID would require more than 2×10⁴
  trials, the run is infeasible, so the **exact analytical expectation (1/d)^k** is
  reported instead — the impossibility of executing, e.g., 10¹⁴ redraws is itself
  the result.

**Model validation.** Where rejection is feasible, the *measured* trials match the
analytical (1/d)^k closely — e.g. k=4, d=0.125: measured 4.17×10³ vs. 8⁴ = 4096;
k=6, d=0.25: measured 4.15×10³ vs. 4096. The agreement confirms the (1/d)^k model,
so the extrapolated cells are trustworthy rather than speculative.

## Results

Apple A18 Pro, Bun; 10⁴ GenoID samples / 500 rejection samples per cell.

| k | density d | GenoID ns/ID | repairs/ID | rejection trials/ID |
|---:|---:|---:|---:|---:|
| 2 | 0.500 | 1142 | 1.00 | 3.99×10⁰ (meas) |
| 2 | 0.0039 | 501 | 1.99 | 6.55×10⁴ (calc) |
| 4 | 0.500 | 2076 | 1.98 | 1.55×10¹ (meas) |
| 4 | 0.125 | 1498 | 3.50 | 4.17×10³ (meas) |
| 4 | 0.0039 | 1008 | 3.98 | 4.29×10⁹ (calc) |
| 6 | 0.500 | 3162 | 3.00 | 6.59×10¹ (meas) |
| 6 | 0.125 | 2310 | 5.25 | 2.62×10⁵ (calc) |
| 6 | 0.0039 | **1439** | 5.98 | **2.81×10¹⁴** (calc) |

Two facts drive the figure (log-log: x = density, y = per-ID cost):

1. **GenoID is flat — better than flat.** Cost stays in the low microseconds and
   *decreases* as density falls (k=6: 3162 → 1439 ns), because a smaller allowed
   set is a smaller Hamming-nearest search. Repairs per ID → k, confirming the O(k)
   bound empirically. This is precisely the regime where rejection is worst.

2. **Rejection detonates as (1/d)^k.** At k=6, d≈0.004, a single valid ID needs
   ≈2.81×10¹⁴ redraws — on the order of months of CPU time — while GenoID emits it
   in 1.44 µs. That is ~10¹³× fewer operations, using the shipped repair operator.

## Why it matters

This is the one capability fixed-layout UUID schemes (v7, ULID, Snowflake,
pg_uuid_v8) **cannot express at all**: they have no per-field constraint
mechanism, so "generate an ID whose shard field is drawn only from the currently
provisioned, non-contiguous set {1,3,4,7}" has no formulation in them — and the
naive way to force it, rejection sampling, is exactly the curve above. GenoID's
constraint-guided repair turns an exponential-cost or impossible operation into a
bounded O(k) one. The result validates the §III proof on real hardware and is the
empirical anchor for the paper's novelty: not "another UUID variant," but a
**composition-with-guarantees primitive** for the version RFC 9562 leaves
undefined.
