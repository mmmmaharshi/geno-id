# GenoID — Threats to Validity

Standard structure for empirical software/systems research: internal,
external, construct, and conclusion validity, plus mitigations already in
place and open items. Written to be lifted directly into a paper's
Threats to Validity section.

## 1. Internal validity (is the measured effect actually caused by GenoID?)

| Threat | Mitigation | Residual risk |
|---|---|---|
| Confounding from JIT warm-up / GC pauses in JS benchmarks | `benchRepeated`/`benchRepeatedAsync` (`bench-core.ts`) run 10 trials and report mean ± std + 95% CI, not a single-shot number; `scripts/significance.ts` runs a Welch t-test (unequal-variance-safe) + Cohen's d rather than eyeballing means | Node/Bun JIT tiering could still differ run-to-run; mitigated but not eliminated by 10 trials |
| Implementation bugs silently inflating/deflating a result | Two critical bugs (32-bit truncation, single-parent population) were caught by the test suite (`AGENTS.md` §Research findings) and fixed before any result was reported; 29 unit tests (`bun run test`) plus `scripts/baselines-verify.test.ts` for known-answer checks on every baseline | Absence of further undiscovered bugs cannot be proven; mitigated by the TDD red→green discipline (`AGENTS.md` §Agent workflow) |
| Selection bias in which NIST/dieharder tests are reported | `scripts/nist-bridge.py` runs the **full** 15-test SP 800-22 battery unconditionally (no cherry-picked subset) on every sample; the extended dieharder battery (`sources/reproducibility.md` §3) is an explicitly curated *subset* for CI time budget, and that curation is disclosed, not hidden | dieharder subset choice could itself be non-representative; documented, not resolved |
| Measuring uniformity on the whole UUID rather than the random payload | Caught and fixed (CHANGELOG 1.2.0): "a naive whole-UUID uniformity check is invalid for timestamped IDs (byte 0 is a constant timestamp)... uniformity is now measured on the random payload only" | n/a — fixed |

## 2. External validity (do results generalize beyond this repo's setup?)

| Threat | Mitigation | Residual risk |
|---|---|---|
| Single machine / single OS | Task A: CI matrix across ubuntu/macos/windows × Bun + Node 20/22/23, consolidated (`ci-consolidated` artifact) | Cloud CI runners (GitHub Actions hosted) have different characteristics (shared vCPUs, no NUMA, capped burst credit) than dedicated bare-metal or on-prem production hardware; absolute throughput numbers should be read as *relative* comparisons across generators run on the *same* runner, not absolute production capacity planning numbers |
| Synthetic workload only (uniform random shard/tenant draws, no real traffic skew) | Task C (SQLite B-tree) uses a fixed key count (100k) and uniform distribution | Real production key distributions (e.g. hot shards, bursty tenants, non-uniform counter increments under partial outages) are not modeled; B-tree behavior under skewed insert order is future work |
| Single database engine (SQLite, in-memory) | Explicitly scoped in README/CHANGELOG as an index-locality proxy, not a claim about Postgres/MySQL/CockroachDB internals (which have different B-tree/LSM implementations) | Findings about "sortable IDs help B-tree locality" are well-established in the wider literature (cited in `related-work.md` §2) independent of this repo, which reduces — but does not eliminate — this threat |
| Browser benchmark engine coverage | Migrated to Playwright with a Chromium/Firefox/WebKit matrix (`bun run playwright`); v1.10.0 added repeated-trial CIs to the browser harness | SpiderMonkey (Firefox) and JavaScriptCore (WebKit) are now exercised alongside V8; throughput ratios across engines can now be compared directly rather than assumed |
| JavaScript/TypeScript-only implementation | n/a | The composition algorithm is language-agnostic (bit operations over byte arrays), but no port to another language/runtime (Go, Rust, Java) exists to confirm the approach's throughput/complexity claims transfer; this is the single largest external-validity gap for a systems-venue reviewer to flag |

## 3. Construct validity (are the metrics measuring what they claim to?)

| Threat | Mitigation | Residual risk |
|---|---|---|
| "Statistical quality" operationalized only as NIST SP 800-22 pass/fail | `sources/security-analysis.md` explicitly scopes this: "statistical randomness (NIST SP 800-22) is a necessary but not sufficient condition for cryptographic security... it does not prove unpredictability under an adversary" | Addressed by adding the adversarial/entropy-accounting analysis (§security-analysis.md) and the broader dieharder battery (§reproducibility.md) as independent constructs, rather than relying on one measure |
| "Collision safety" measured only up to 100M IDs (Task D) | Compared against the theoretical 50%-collision birthday bound (~2.7×10^18 for 122-bit space) so the empirical test is explicitly framed as a sanity check against catastrophic implementation bugs, not a claim to have exhausted the birthday-bound-scale space (computationally infeasible for anyone) | This is standard practice across the whole field (no UUID paper tests to 2.7×10^18); disclosed rather than hidden |
| "Novelty" construct — "no prior GA-for-identifier work" | Grounded in an explicit, disclosed search methodology (`related-work.md` §4, re-verified in the July 2026 adversarial recheck) across Semantic Scholar/arXiv/OpenAlex/web/patent search, with the closest adjacent work (arXiv:2509.08969, pg_uuid_v8) explicitly cited and differentiated rather than a bare novelty assertion | Absence of evidence is not evidence of absence — a non-English-language or non-indexed paper could exist; mitigated, not eliminated, by breadth of search |
| Security class labels ("High"/"Insecure") as a construct | Formalized in `security-analysis.md` as an entropy-accounting + adversarial-model argument with explicit caveats (256-UUID pool forward-secrecy window, structured-field metadata leakage), not a bare label | No formal cryptographic reduction proof (disclosed as out of scope in `security-analysis.md` §6 and `formal-proofs.md` §0) |

## 4. Conclusion validity (do the stats support the stated conclusions?)

| Threat | Mitigation | Residual risk |
|---|---|---|
| Point-estimate throughput claims ("GenoID is 7.8× faster than v4") | v1.9.0 replaced single-run point estimates with `benchRepeated` (10 trials, mean ± std, 95% CI) and Welch t-test + Cohen's d significance testing (`scripts/significance.ts`) for every "GenoID vs baseline" claim | Sample size (10 trials) is adequate for the effect sizes observed (large Cohen's d, e.g. d=-7.56 reported in CHANGELOG 1.9.0) but a power analysis for *smaller* future effect sizes (e.g. comparing two close competitors) has not been formally computed |
| NIST PASS/FAIL treated as binary without correction for multiple comparisons | Each sample undergoes the same fixed 15-test battery; no p-hacking via selective re-running is possible since `nist-bridge.py` runs the full battery unconditionally and is checked into version control | A Bonferroni-style correction across the 15 tests × many samples is not applied; standard practice in the NIST STS literature is per-test α=0.01, which this follows, but a stricter family-wise correction would be more conservative for a security venue |
| "0 collisions" reported without a confidence interval on the collision rate itself | Reported alongside the theoretical birthday-bound expectation (n for 50% collision probability) so the reader can assess how far 100M is from the regime where collisions would be expected, rather than treating "0 observed" as "0 probability" | Reasonable given the extreme rarity implied by the 128-bit/122-bit space; not itself in question |

## 5. Summary for a paper's Threats to Validity section

The strongest remaining threats, ranked by what a Q1 reviewer is most likely
to press on:

1. **Single-language, single-ecosystem implementation** (external validity) —
   no cross-language replication of the complexity/throughput claims.
2. **CI-runner hardware vs. production hardware** (external validity) —
   relative comparisons are robust; absolute numbers should not be read as
   production capacity planning figures.
3. **No formal cryptographic reduction** (construct validity) — the security
   argument is entropy-accounting + adversarial reasoning, not a proof against
   a standard hardness assumption; disclosed explicitly in
   `security-analysis.md` and `formal-proofs.md`.
4. **Novelty claim rests on a disclosed but non-exhaustive search** (construct
   validity) — mitigated by breadth (multi-database + patent + web search,
   explicit differentiation from the closest 2025 paper) but not provably
   exhaustive.

None of these are hidden; each is cross-referenced from the relevant
evaluation section so a reader can weigh the claim against its own limits.
