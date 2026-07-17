# COMPARABILITY_REPORT

Comparison boundaries for GenoID research candidates. All comparisons are
against the same frozen evaluation_source (NIST SP 800-22 + Node crypto tests
+ collision/uniformity harness) and the same trusted-lane implementation.

## What is kept frozen across candidates
- algo.ts GenoID implementation (34-byte, pooled, v8 nibble).
- NIST sample suite: CSPRNG ablation, weak-entropy, controlled-degradation.
- Evaluation: NIST SP 800-22 battery, birthday-bound collision test,
  uniformity chi-square.

## Candidate-to-candidate boundaries
- A vs B: A is the architectural framing; B is the negative-result contribution.
  They share the same evidence base and are recommended as one paper.
- B vs D: D is the refuted original hypothesis; B is the published negative
  result built FROM D's failure. Same data, opposite framing (hypothesis vs
  evidence).
- C vs A: C is a methodology lens; subsumed by A's validation section to avoid
  a separate single-variable claim below the 0.6 gate.

## Known comparability limits
- Weak-entropy and degradation samples at 1.22M bits: insufficient to expose
  Xorshift128+ weaknesses (needs 100M+ bits). Degradation conclusions rest on
  structural failures, not marginal p-values.
- NIST run used `nist80022` library; results are per-file, not a formal
  meta-analysis.
- No external SOTA contrast performed yet (RFC 9562, UUIDv7, GA-randomness
  literature) — required before any contribution claim.
