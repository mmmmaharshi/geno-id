# GenoID claim-to-evidence audit

**Audit date:** 2026-09-25  
**Manuscript:** `paper.tex` at the current working tree, with `HEAD` `249cb3c7b557e960c4345437997f49284b57ea1c`  
**Artifact:** GenoID repository, package version `1.21.2`

## Executive finding

The current manuscript is not ready for journal submission. Several core statements have only a plausible implementation or a prior prose summary behind them. The strongest directly traceable artifacts are the 40-cell rejection sweep, the curated dieharder table, the browser collision table, and one SQLite locality result. They do not cover the manuscript's claimed 10^8 field-frequency experiment, full NIST output, 1.5M production-path correctness result, consolidated nine-environment CI table, or paper-specific composite-key table.

The most serious correctness issue is the mismatch between the current modulo repair and the manuscript's stated frequency prediction. For the current implementation and `allowed = [1, 2, 3, 4, 5]`, source inspection gives 51 preimages for each output value, not four values with 51 preimages and one with 52. No 10^8 measurement artifact exists to resolve the discrepancy. This is missing empirical evidence plus a failed analytical cross-check, not a recorded failed experiment.

The second serious issue is path identity. `genStructuredGenoID()` normally selects a compiled per-call path, while the manuscript and several source notes describe a pooled, two-parent, crossover path. The Rust check covers only the single-parent interpreted path. The security notes also state a 256-entry structured pool, while current source sets the structured single-parent pool to 1024 and the compiled path makes a fresh CSPRNG call per UUID.

No ICTDSC acceptance claim is made here. No acceptance statement was found in the inspected manuscript or repository sources.

## Audit method and status vocabulary

This audit read the current contents of `CONTEXT.md`, `paper.tex`, `AGENTS.md`, `CITATION.cff`, `README.md`, `package.json`, every Markdown file under `sources/`, the experiment scripts, the Rust golden checker, workflow files, and all files under `results/`. It also checked Git tracking and the external DataCite records for the two DOI values present in the repository.

The working tree was already dirty before this report: `AGENTS.md` is modified, and many support files are untracked. `results/db-native.json` and `scripts/bench-db-native.ts` are untracked. The five tracked result files are `results/rejection-sweep.json`, `results/rejection-sweep.csv`, `results/dieharder-results.md`, `results/benchmark_results.json`, and `results/db-sqlite.json`. The `dist/` directory is absent in the inspected tree.

The status terms mean:

- **Proved:** follows from a stated mathematical or code-level invariant, within the stated assumptions.
- **Measured:** an actual result artifact or raw output exists for the stated scope.
- **Inferred:** follows from reasoning or a proxy, but the claimed endpoint was not directly tested.
- **Conjectural:** plausible, but not established by the inspected evidence.
- **Unsupported:** no adequate artifact exists, or the current implementation contradicts the wording.

“Missing evidence” means the experiment was not recorded. “Failed or contradicted evidence” means a current source or artifact disagrees with the claim. These states are kept separate throughout.

## Evidence inventory

| Artifact or source | Git status | Direct content | Evidentiary limit |
|---|---|---|---|
| `results/rejection-sweep.json` and `.csv` | tracked | 40 cells, `idsPerCell = 10,000`; repair counts, timings, and measured/calculated rejection flags | No runtime, OS, CPU, seed, or timing confidence intervals; 16 of 40 rejection cells are analytical |
| `results/dieharder-results.md` | tracked | Four generators, 38 result rows per generator, five-trial modal table, 100M-bit sample description | Curated eight-ID dieharder/STS subset, not the full battery; raw samples and all trial p-values absent |
| `results/benchmark_results.json` | tracked | Three browser-labelled runs, ten timing trials, 2,000,000 collision samples for synchronous algorithms, empty `browserErrors` | All three records contain the same HeadlessChrome user agent despite Firefox/WebKit labels; browser versions are not pinned in the artifact |
| `results/db-sqlite.json` | tracked | SQLite 3.53.0 on Windows, 500,000 rows, three runs, BLOB keys, locality and write-amplification metrics | Different workload from the manuscript's 100,000-row composite-key table; no paper table rows or trial arrays |
| `results/db-native.json` | untracked | PostgreSQL-only native run, 500,000 rows, three runs, table size and write-amplification fields | Not committed; no PostgreSQL version, WAL/container settings, MySQL section, or InnoDB result |
| `golden/*.txt` | tracked | 1,000 lines in each of nine generated files | CI regenerates files before Rust comparison; the committed files are not the immutable comparison input |
| `paper.tex` | tracked | Current manuscript claims, tables, and availability paragraph | Manuscript was updated on 2026-09-23; most result artifacts were last committed on 2026-07-27 |
| `dist/bench-ci-results.json`, `dist/all-results.json`, NIST outputs, rank-scan output, and 100M collision output | absent | No local artifact | Scripts depend on generated `dist/` files or write only stdout/ignored output |

## Claim-to-evidence ledger

### C1. RFC 9562 opportunity and declarative constrained layout

**Exact claim.** The abstract says that RFC 9562 “reserves 122 bits” for v8 but “defines no algorithm to fill them,” and that GenoID produces valid v8 UUIDs “from arbitrary constrained fields.” The contribution list calls this a declarative RFC 9562 v8 layout abstraction.

**Claim type.** **Proved** for the existence of typed layout declarations and the RFC's implementation-defined payload. **Unsupported** as written for “arbitrary” constraints and for a workload-to-layout compiler.

**Implementation source.** `algo.ts:266-310` defines `FieldType`, `V8FieldConstraint`, `V8Field`, and `V8Layout`. `algo.ts:313-345` validates coverage, reserved version/variant bits, and field bounds. `algo.ts:535-553` fills undeclared ranges with `random` fields. `index.ts:8-22` exposes the public layout and generation API.

**Experiment/script.** No novelty experiment establishes the standard opportunity or priority. `scripts/bench-structured.ts` exercises the implementation, but it does not compare against a complete set of prior layout systems.

**Sample size and runtime.** No direct sample or runtime. The nominal E1 harness uses 500,000 parent pairs and three structured fields, but its result is not recorded.

**Statistical test or metric.** Layout coverage, version/variant conformance, field round trips, and constraint membership. No statistical test is appropriate for the RFC fact.

**Exact result artifact.** No result file for C1. The source and tests are implementation artifacts, not a novelty or conformance result.

**Reproducibility status.** Partially reproducible from source after a build. The public API is inspectable, but no archived result ties the current code to the manuscript's broad wording.

**Known caveat.** The supported constraint language is finite: `allowed`, numeric bounds, and monotonic metadata, over a bounded set of field types. It is not an arbitrary predicate language. There is no inspected end-to-end planner that infers offsets or repair policy from database workload statistics.

**Required journal action.** Cite RFC 9562 directly, define the supported input language, and replace “arbitrary constrained fields” with a bounded claim. If “compiler” is retained, define its input, output, validation rules, and optimization problem.

### C2. 1.5M structured-field checks

**Exact claim.** `paper.tex:484` states: “Over 1.5M structured-field checks: 0 mismatches and 0 constraint violations.” The same claim appears in `README.md:311`, `AGENTS.md:218-220`, and `sources/formal-proofs.md:79-83`.

**Claim type.** **Unsupported**. The check is missing as a recorded result, and the current E1 source does not test the claimed repaired production path.

**Implementation source.** The nominal experiment is `scripts/bench-structured.ts:41-71`. It uses `genStructuredParent`, `composeStructured`, and `getFieldValue`. In current `algo.ts:617-631`, `applyStructuredFields` writes timestamp and fixed fields only; it does not apply allowed, range, or monotonic constraints. `genStructuredParent` calls `applyStructuredFields` and then forces version/variant (`algo.ts:637-647`), but does not call `repairConstraints`. `composeStructured` copies fields (`algo.ts:656-670`) and does not repair them.

**Experiment/script.** E1 generates two parents and a child for each iteration, uses `Math.random()` for the field selector, checks field-copy equality, and checks allowed-set membership. It does not check range or monotonic constraints and does not call the public `genStructuredGenoID()` path.

**Sample size and runtime.** Nominal `N = 500,000`; DBKEY has three non-random fields, giving 1,500,000 field observations. Runtime and exit status are not stored. `dist/` is absent, so the script was not freshly rerun during this audit.

**Statistical test or metric.** Count of copy mismatches and count of allowed-set violations. This is a deterministic correctness count, not a statistical test.

**Exact result artifact.** None. No E1 JSON, CSV, stdout transcript, or CI artifact is committed.

**Reproducibility status.** Procedure is not currently evidenced. A fresh run would first need a build, and the source predicts that raw shard values from un-repaired parents can violate `[1, 2, 3, 4, 5]`. That prediction is not reported as an executed failure because no run artifact exists.

**Known caveat.** The manuscript calls this the empirical counterpart to a by-construction proof, but the tested lower-level crossover function is not the normal public structured generator. The current test can observe copying correctness while failing to observe repair correctness.

**Required journal action.** Rewrite E1 to test the exact shipped path, or explicitly label it as a lower-level crossover test. Apply every declared constraint before checking, include range and monotonic checks, save the output, and report whether the result is for compiled, pooled, or parent-composition code.

### C3. Repair complexity and rejection complexity

**Exact claim.** The abstract and contribution list claim `O(k)` repair versus `O(64^k)` rejection. Section `paper.tex:414-419` gives the general product model and then uses the special case of independent 8-bit fields with four admissible values, where the expected rejection count is `64^k`.

**Claim type.** **Proved** for the stated bounded-field special case. **Unsupported** if read as a universal comparison between arbitrary rejection sampling and arbitrary layouts.

**Implementation source.** `algo.ts:682-700` makes one loop over `layout.fields`; the allowed branch is an idempotent modulo lookup, followed by min/max clamping. `getFieldValue` (`algo.ts:347-355`) is a bit loop using `BigInt`; `writeFieldValue` (`algo.ts:396-402`) is a bounded byte-plan operation. There is no retry loop in `repairConstraints`.

**Experiment/script.** `scripts/bench-rejection.ts:37-181` creates 8-bit fields, allowed sets of sizes 128, 64, 32, 16, 8, 4, 2, and 1, and field counts `k = 1, 2, 3, 4, 6`. It measures GenoID repair and rejection where feasible, otherwise stores the analytical expectation.

**Sample size and runtime.** 40 cells; 10,000 GenoID IDs per cell; 500 rejection samples for feasible cells; 200 warm-up iterations per rejection cell. No runtime, host, operating system, or timing uncertainty is recorded.

**Statistical test or metric.** Repairs per ID, nanoseconds per ID, rejection trials per ID, and measured versus analytical flags. No confidence interval is calculated for the rejection mean.

**Exact result artifact.** `results/rejection-sweep.json:1-445` and `results/rejection-sweep.csv:1-41` contain 40 cells. Twenty-four cells have `rejectionTrialsMeasured: true`; sixteen have `false`. The JSON does not record environment, runtime, random seed, or confidence intervals.

**Reproducibility status.** Qualitative reruns are plausible after `bun run build`; exact timings are not reproducible because the script shuffles configurations with `Math.random()` and writes no machine metadata.

**Known caveat.** The actual code iterates over every layout field, including filler fields, so the unconditional cost is `O(n)` for `n` layout fields. It becomes `O(k)` only when the number of fields is proportional to the constrained-field count and field widths and allowed-set sizes are bounded. The general rejection expectation is `product(2^ell_i / a_i)`, not always `64^k`. The stale `sources/formal-proofs.md:28-42` also describes a different `a_i = 1` setup, while the current sweep uses `a_i = 4`.

**Required journal action.** State the bounded-layout assumptions in the theorem. Replace universal `O(64^k)` wording with the product model plus the `64^k` special case. Do not call a ratio of analytical trial counts a measured time speedup.

### C4. Rejection sweep: measured versus analytical cells

**Exact claim.** `paper.tex:489-509` claims 40 cells, repair counts following `k(1-d)`, linear per-field cost, and exact `64^k` values at `d = 1/64` for `k = 3, 4, 6`.

**Claim type.** **Measured** for repair counts and feasible rejection cells. **Inferred/analytical** for infeasible rejection cells.

**Implementation source.** The current implementation is modulo repair, not Hamming-nearest repair. This is visible at `algo.ts:689-690` and in the current compiled generator at `algo.ts:1087-1090`.

**Experiment/script.** `scripts/bench-rejection.ts` stores a separate `rejectionTrialsMeasured` boolean. At `d = 1/64`, the artifact records approximately `262100`, `16780000`, and `68720000000` for `k = 3, 4, 6`, with `rejectionTrialsMeasured: false`. Those are rounded analytical values, not executed rejection trials.

**Sample size and runtime.** 10,000 IDs per cell and 500 rejection samples where feasible. Analytical cells do not have a rejection sample count or runtime.

**Statistical test or metric.** Agreement of measured trial means with `(1/d)^k` is visual/model agreement, not a fitted test. The artifact has no uncertainty estimate for the measured means.

**Exact result artifact.** `results/rejection-sweep.json` and `.csv` are the only current rejection evidence. `sources/rejection-cost.md:38-49` is stale: it describes an eight-row Hamming-nearest experiment and does not match the current 40-cell modulo artifact.

**Reproducibility status.** The artifact is usable as a record of one run, but it cannot reproduce its timings or establish the manuscript's exact prose without a new environment manifest.

**Known caveat.** The artifact's `speedupVsGeno` field is a ratio of trials to repairs, not measured wall-clock speed. The paper must not present that field as a latency or operation-time result.

**Required journal action.** Mark every analytical cell in the manuscript and figure. Align `sources/rejection-cost.md` with the current script, or archive the older experiment under a separate name. Add environment metadata and uncertainty for the measured rejection means.

### C5. Two-million collisions and 50,000-sample uniformity

**Exact claim.** `AGENTS.md:220`, `sources/related-work.md:141-143`, and `CHANGELOG.md:277-281` report zero collisions at `n = 2,000,000` and a maximum uniformity deviation of about `0.0053` or `0.0051` for a 50,000-UUID check.

**Claim type.** **Measured** for browser collision rows at two million. **Unsupported** for the quoted 50,000-sample uniformity values because no corresponding result artifact is committed.

**Implementation source.** Browser collision code is `benchmark.ts:203-223`, with collision sets supplied by `bench-core.ts:41-63`. The structured benchmark is `scripts/bench-structured.ts:144-168`. The head-to-head prior-art script is `scripts/bench-pg-uuid-v8.ts:83-107`.

**Experiment/script.** `results/benchmark_results.json` contains three browser-labelled runs. Synchronous algorithms use 2,000,000 collision samples; the SHA-256 algorithm uses 50,000 because it is async. `bench-structured.ts` uses 2,000,000 collision samples and `M = 50,000` random-bit samples, but writes only stdout. `bench-pg-uuid-v8.ts` uses the same nominal sizes and writes NIST bit files, not a result JSON.

**Sample size and runtime.** Browser: three labelled runs, ten timing trials, 200,000 synchronous timing IDs, 20,000 async timing IDs, 2,000,000 collision samples, and 50,000 hash collision samples. Structured Node/Bun uniformity: `M = 50,000`; no runtime is recorded. Prior-art head-to-head: 2,000,000 collisions and 50,000 uniformity samples; no result file.

**Statistical test or metric.** Exact duplicate count for collisions; maximum absolute bit-frequency deviation for uniformity. No collision-rate confidence interval or uniformity confidence interval is saved.

**Exact result artifact.** `results/benchmark_results.json:4-42`, `112-150`, and `219-257` support zero browser collision counts. No artifact contains the quoted `0.0053` or `0.0051` uniformity result.

**Reproducibility status.** Browser collision results are partially reproducible with Playwright. The 50,000 uniformity result is not reproducible from a committed output, and `bench-structured.ts` requires a build.

**Known caveat.** Zero collisions at 2,000,000 is a sanity check against implementation duplication, not evidence that a 122-bit space has been exhausted. The source notes correctly acknowledge this limitation.

**Required journal action.** Save the structured uniformity output as JSON with raw counts, environment, runtime, and source commit. Separate browser collision evidence from Node/Bun uniformity evidence. Do not use `CHANGELOG.md` prose as a substitute for raw data.

### C6. Claimed 10^8 field-frequency data

**Exact claim.** `paper.tex:72`, `512`, and `633` claim 100,000,000 `dbkey` draws, four shard frequencies at `51/256`, one at `52/256`, and matching multitenant frequencies to within 0.01 percentage points.

**Claim type.** **Unsupported**. The frequency measurement is missing, and the stated analytical frequency pattern conflicts with the current modulo implementation.

**Implementation source.** `repairConstraints` maps an invalid value with `c.allowed[v % c.allowed.length]` at `algo.ts:689-690`. The compiled path emits the same modulo map for allowed fields at `algo.ts:1087-1090`.

**Experiment/script.** No inspected script generates a 100,000,000-draw field histogram. `scripts/bench-structured.ts:157` uses 50,000 UUIDs. `scripts/export-structured.ts:24` emits 1,220,000 random bits per layout. `scripts/collision-100m.ts` counts duplicate UUIDs, not field frequencies. `scripts/export-dieharder.ts` exports 100M bits, not 100M field histograms.

**Sample size and runtime.** Claimed `10^8`; actual histogram sample is not present. No runtime is recorded.

**Statistical test or metric.** Field-value histogram and deviation from a predicted distribution. The manuscript explicitly declines a chi-square test, so no inferential threshold is defined.

**Exact result artifact.** None. No `10^8` frequency file exists under `results/`, and `dist/` is absent.

**Reproducibility status.** Not reproducible from the current scripts. A new histogram script and output artifact are required.

**Known caveat.** For the current map with `allowed = [1, 2, 3, 4, 5]`, values 1 through 5 pass through unchanged. The 250 invalid values, 6 through 255, contribute 50 values to each residue class modulo 5. Each output therefore has 51 preimages out of 256. The manuscript's four-51/one-52 pattern does not describe this operator. The general `m/2^ell` bound also needs assumptions about the allowed set; divisibility alone does not guarantee equal output masses for an arbitrary allowed list.

**Required journal action.** Correct the operator description and prediction first. Then either run and archive the 100,000,000-draw histogram with raw counts and uncertainty, or remove the 10^8 claim and report only the evidence that exists.

### C7. NIST SP 800-22 output

**Exact claim.** `paper.tex:516` states that all 15 NIST SP 800-22 sub-tests pass on three structured layouts. `README.md:308` and `sources/related-work.md:142-144` repeat the claim.

**Claim type.** **Unsupported**. The full-battery harness exists, but the output and exact dependency/runtime record do not.

**Implementation source.** `scripts/nist-bridge.py:24-149` implements the full 15-category battery. `scripts/export-structured.ts:18-43` is the nominal producer of `dist/struct-dbkey.bits.txt`, `dist/struct-multitenant.bits.txt`, and `dist/struct-eventsourcing.bits.txt`.

**Experiment/script.** `scripts/nist-bridge.py:178-209` names the expected input files and runs samples in a process pool. It prints text by default and does not write a result file. `package.json:39` maps `test:stats` to `scripts/stats.ts`, not to `nist-bridge.py`.

**Sample size and runtime.** Structured exports target 1,220,000 random-field bits per layout. No generated bit files, p-values, library version, Python version, or runtime are present in the inspected tree. `scripts/stats.ts` is a different in-house monobit/runs/chi-square/correlation battery and does not test the three structured layouts.

**Statistical test or metric.** NIST library pass/fail and p-values, nominally at `alpha = 0.01`, with no family-wise correction across tests or samples.

**Exact result artifact.** None under `results/` or `dist/`. The CHANGELOG and source notes contain prose claims, not the missing p-value table.

**Reproducibility status.** The harness is inspectable but not self-contained from a clean clone: Python dependencies are documented in prose, not pinned in `package.json`, and `test:stats` points to a different script. The expected `dist/` inputs are absent.

**Known caveat.** NIST SP 800-22 is a statistical sanity check, not a cryptographic-security proof. The paper correctly says this, but the missing output prevents even the narrower empirical claim from being audited.

**Required journal action.** Run the full bridge on the exact archived commit, record Python and `nist80022` versions, save all p-values and pass/fail decisions as a machine-readable artifact, and correct the command documentation. Do not cite the in-house `stats.ts` output as the 15-test NIST battery.

### C8. Curated dieharder output

**Exact claim.** `paper.tex:516` reports 38 sub-tests, five trials, 100M-bit samples, and `152/152 PASS` across UUIDv4, raw, pooled, and structured-dbkey variants.

**Claim type.** **Measured** for the curated subset and modal table. **Unsupported** if read as a full dieharder battery or as proof of randomness quality.

**Implementation source.** `scripts/export-dieharder.ts:8-10` requests 100,000,000 bits. `scripts/dieharder-common.ts:90-145` packs flat and structured bitstreams. `scripts/run-dieharder.ts:37-43, 163-229` defines the curated IDs, five trials, aggregation, and result writer.

**Experiment/script.** Four generators, eight curated diehard/STS IDs, five independent trial files per generator, and 152 visible result rows. The runner explicitly excludes `diehard_opso`, `diehard_squeeze`, and the rgb/dab family. It is local, not a CI job.

**Sample size and runtime.** 100M bits, approximately 12.5 MB, per generator per trial; five trials; no dieharder version, host, elapsed time, sample hash, or all-trial p-value table is recorded.

**Statistical test or metric.** Dieharder assessment strings aggregated by modal vote, tie-broken toward `PASSED`. The artifact shows several `3/5` and `4/5` trial counts among otherwise `PASSED` rows.

**Exact result artifact.** `results/dieharder-results.md:1-158` is tracked and contains the claimed 152-row modal table. The raw `.bin` samples are not committed.

**Reproducibility status.** The table is reproducible only on a host with the matching dieharder binary and enough disk/CPU. The current runner requires a local install and the repository does not record its version.

**Known caveat.** Selection bias is disclosed but remains. A modal `PASSED` row is not a conventional independent pass for all trials. The manuscript's explanation of `3/5` results as Type II error is not established by the artifact, which does not retain all trial p-values. The paper must not call this the full dieharder battery.

**Required journal action.** Retain the result as “curated dieharder/STS subset,” publish the exact test IDs and dieharder version, save all trial p-values, and remove the unsupported Type II explanation. Either run a larger representative battery or state the selection limitation as a limitation.

### C9. Nine-environment CI throughput table

**Exact claim.** The abstract claims `2.0`--`6.7x` throughput over the closest prior art across nine runtime environments. `paper.tex:522-579` reports nine rows and pairwise Welch tests.

**Claim type.** **Measured in the implemented CI design**, but **unsupported as a current manuscript table** because the consolidated per-environment artifacts are absent.

**Implementation source.** `scripts/bench-ci.ts:52-145` runs 200,000 IDs per timing trial, ten trials after three warm-ups, one-million-ID collision tests, and pairwise Welch/Cohen's-d calculations. `scripts/deno/bench-ci.ts:49-169` is the Deno port. `scripts/ci-consolidate.ts:68-146` renders the nine-column table.

**Experiment/script.** `.github/workflows/bench.yml:35-120` defines three Bun jobs, three Node 22 jobs, and three Deno 2.9.3 jobs. The Deno Linux job also runs a separate 100M collision command. The workflow uploads transient `bench-*` artifacts and a transient consolidated artifact.

**Sample size and runtime.** 200,000 IDs per timing trial, ten trials, three discarded warm-ups, and one million collision IDs per collision-tested generator in each CI job. No current run ID, commit SHA, hardware manifest, raw trial arrays, or `dist/all-results.json` is committed.

**Statistical test or metric.** Mean, standard deviation, 95% CI, Welch two-sided p-value, Cohen's d, and zero-collision pass/fail. The manuscript's `p < 10^-7` statements cannot be checked from the repository.

**Exact result artifact.** No `dist/bench-ci-results.json` or `dist/all-results.json` is present. `results/benchmark_results.json` is browser output, not CI output.

**Reproducibility status.** Workflow and scripts are present, but the table is not independently auditable from a clean clone. Deno's `collectEnv` also records `cpuModel: "unknown"` and zero memory, weakening hardware provenance.

**Known caveat.** Generators are benchmarked sequentially, not interleaved as paired randomized trials. The reported ratio is a ratio of means, not a paired per-trial ratio. No multiple-comparison correction is shown across environments and comparisons. The paper's statement at `paper.tex:480` that every evaluation number comes from `bun run bench-ci` is false for E1, rejection, NIST, dieharder, database, browser, and Rust experiments.

**Required journal action.** Archive the exact CI run's `all-results.json`, raw per-trial samples, commit SHA, runner metadata, and environment labels. Recompute the table from that artifact. Narrow the claim to same-run relative comparisons on shared CI runners.

### C10. Browser results

**Exact claim.** `paper.tex:589` claims a cross-browser Playwright test with Chromium, Firefox, and WebKit, zero browser errors, and zero collisions.

**Claim type.** **Measured**, with a material provenance defect in the committed artifact.

**Implementation source.** `scripts/playwright.ts:105-290` launches each named engine, collects `pageerror` and console errors, scrapes results and collision rows, and asserts the structured row and zero collisions. `index.html:15-22` sets 200,000 synchronous IDs, 20,000 async IDs, and 2,000,000 collision IDs by default.

**Experiment/script.** The committed result was produced by the Playwright-style path and contains three records labelled `chromium`, `firefox`, and `webkit`.

**Sample size and runtime.** Ten timing trials per algorithm; 200,000 synchronous timing IDs; 20,000 async timing IDs; 2,000,000 collision samples for synchronous algorithms; 50,000 for SHA-256. Timestamps are 2026-07-27. No browser binary versions are recorded.

**Statistical test or metric.** Exact duplicate count and empty `browserErrors`; timing mean and 95% CI.

**Exact result artifact.** `results/benchmark_results.json:1-325` records empty error arrays and zero collisions for all three labelled runs. It also records the same `HeadlessChrome/149.0.7827.55` user agent for all three records at lines 108, 215, and 322.

**Reproducibility status.** The harness is rerunnable, but the committed artifact does not independently establish Firefox or WebKit identity. It may be stale or captured through a different browser configuration; the files do not resolve which.

**Known caveat.** The browser test does not measure field-level uniformity, constraint satisfaction, or entropy. It establishes page execution and collision checks only.

**Required journal action.** Rerun from the archived commit, preserve per-engine user agents and browser versions, retain logs, and verify engine identity before citing the three-engine result. Keep browser results separate from CI and Node results.

### C11. SQLite composite-key table

**Exact claim.** `paper.tex:243-299` reports a 100,000-row SQLite composite-key comparison: embedded keys at 27.5--27.6 bytes/row and 914--961K inserts/s, a secondary-index arm at 54.5 bytes/row and 492K inserts/s, and a 1.95x insert tax and 1.45x lookup difference.

**Claim type.** **Unsupported** as a traceable paper result. A different SQLite experiment is measured and tracked, but it is not the table's experiment.

**Implementation source.** The composite-key arms and repeated trials are in `scripts/bench-sqlite.ts:97-375`. The tracked `results/db-sqlite.json` is produced by `scripts/bench-db.ts`, which uses a different schema, BLOB keys, eight arms, two modes, 500,000 rows, and three runs.

**Experiment/script.** `bench-sqlite.ts` is the likely source for the manuscript's five-arm table, but it writes stdout only. `bench-db.ts` writes `results/db-sqlite.json` and contains no composite-arm rows matching Table `tab:composite`.

**Sample size and runtime.** Manuscript table: `N = 100,000`, ten trials, described as two uncontended runs. Tracked artifact: Windows x64, Intel i3, four cores, SQLite 3.53.0, `rows = 500,000`, `runs = 3`, 16 MB cache, 64-byte payload, BLOB keys.

**Statistical test or metric.** Insert rows/s, bytes/row, point-lookup latency, range-scan latency, and 95% CI. The current tracked artifact reports clustered means of 27,654 rows/s for v4, 245,600 for v7, and 269,235 for `genoid_structured`; it reports an 18.3% secondary-index tax and 7,745,536 index bytes at `results/db-sqlite.json:586-593`. It reports a 13.277 ms GenoID shard range versus a 2.556 ms indexed baseline at lines 576-584.

**Exact result artifact.** `results/db-sqlite.json:1-595` is tracked, but its values and workload do not map to the manuscript table. `sources/db-benchmark.md:47-69` reports a different Apple A18 Pro/SQLite 3.51.0 run and different values.

**Reproducibility status.** The current `bench-db` result is inspectable. The paper's composite table has no committed raw output, no trial arrays, and no direct artifact-to-row mapping.

**Known caveat.** SQLite's B-tree and page-repacking behaviour are a locality proxy, not native InnoDB or PostgreSQL evidence. Text versus BLOB keys, schema, cache, transaction settings, and hardware materially change the numbers.

**Required journal action.** Archive the exact `bench-sqlite.ts` run that generated Table `tab:composite`, or replace the table with values from the tracked `bench-db` artifact. Record schema, key encoding, trial selection, and the contaminated-run decision.

### C12. PostgreSQL and InnoDB evidence

**Exact claim.** `paper.tex:307-354` states that PostgreSQL 17 measured `uuid_v7` at 61.5K rows/s versus `uuid_v4` at 28.7K, an 8.1% secondary-index tax, and extends the mechanism to InnoDB and other MVCC engines.

**Claim type.** **Measured** for an uncommitted PostgreSQL result. **Unsupported** for the InnoDB/generalization claim.

**Implementation source.** `scripts/bench-db-native.ts` is an untracked script. It defines PostgreSQL and MySQL paths, but imports `pg` and `mysql2`, neither of which is declared in `package.json`. The PostgreSQL path uses `bytea PRIMARY KEY`; the MySQL path uses `BINARY(16) PRIMARY KEY`.

**Experiment/script.** The untracked result has a PostgreSQL section only. It records 500,000 rows, three runs, table bytes, and a write-amplification comparison. No MySQL section is present.

**Sample size and runtime.** 500,000 rows and three runs per arm. The result records Windows x64, Intel i3, four cores, and 7,991 MB, but no PostgreSQL version, server configuration, WAL setting, container image, client library version, or elapsed runtime.

**Statistical test or metric.** Insert rows/s and secondary-index insert tax. The PostgreSQL result has raw run arrays, but no statistical test or confidence interval in the JSON.

**Exact result artifact.** `results/db-native.json:1-73` exists but is untracked. Its PostgreSQL values are approximately 61,871 rows/s for v7 and 28,729 for v4; the no-index/with-index values are 60,586 and 55,682 rows/s, consistent with the paper's rounded 8.1% tax. There is no `mysql` or InnoDB artifact.

**Reproducibility status.** The local PostgreSQL observation is visible but not part of the committed evidence package and cannot be rerun from declared dependencies. The PostgreSQL 17 version claim is not recorded in the artifact.

**Known caveat.** PostgreSQL is not a clustered InnoDB-like table in the same sense. The manuscript's “all three systems store the primary key as a leaf-level B+tree” wording needs a more careful engine-specific explanation. The structural InnoDB discussion is cited reasoning, not a measured result.

**Required journal action.** Either commit the native benchmark, its dependencies, server configuration, and a PostgreSQL result, or label SQLite as the only measured engine. Add a real InnoDB/MySQL run before making an InnoDB performance claim. Record server versions and transaction settings.

### C13. Rust cross-language vectors

**Exact claim.** `paper.tex:591-600` claims byte identity across an independent Rust reimplementation for 1,000 UUIDs per layout across three layouts, zero mismatches across 3,000 vectors, mutation discrimination, and CI verification of committed golden files.

**Claim type.** **Measured** for the narrow single-parent seeded path if the golden files are accepted as the comparison input. **Unsupported** for production-default coverage, committed-file verification, and mutation claims.

**Implementation source.** `golden-check/src/main.rs:185-343` implements a Rust xorshift128+ generator, pool refill, timestamp/counter handling, modulo repair, and comparison. `scripts/export-golden.ts:29-95` emits 1,000 vectors for each interpreted and compiled layout.

**Experiment/script.** The Rust checker reads only `dbkey-single-parent.txt`, `multitenant-single-parent.txt`, and `eventsourcing-single-parent.txt`. It does not check the two-parent or compiled golden files. The workflow at `.github/workflows/bench.yml:122-140` runs `export-golden.ts` before Cargo, so it regenerates the comparison files rather than checking the immutable committed files.

**Sample size and runtime.** 1,000 vectors per layout, three layouts, fixed seed `(0xdeadbeef, 0x4f15f00d)`, fixed time `1_700_000_000_000`. No fresh Cargo output or runtime is committed.

**Statistical test or metric.** Exact string equality per vector and aggregate mismatch count. The claimed nearest-value and saturating-counter mutation matrix has no inspected executable mutation script or CI step.

**Exact result artifact.** Nine tracked files under `golden/`, each with 1,000 lines. No mismatch log or mutation-result artifact is committed. `sources/threats-to-validity.md:25` still says no Rust port exists, which is stale relative to the current repository.

**Reproducibility status.** The narrow files are present and inspectable. The CI check is not an immutable golden-file check, and it does not cover the normal compiled public path.

**Known caveat.** The Rust implementation mirrors a single-parent pooled path. `genStructuredGenoID()` normally chooses `compileLayout()` under the default CSPRNG, so byte identity of this path does not establish byte identity of the shipped default path. The paper's “committed golden files” wording is stronger than the workflow.

**Required journal action.** Commit a manifest with hashes, compare Rust output against committed vectors without regenerating them, add a production compiled-path check or narrow the claim, and add an executable mutation harness to CI. Update the stale threats-to-validity note.

### C14. Security, entropy, and forward-secrecy claims

**Exact claim.** The security section assigns 122 bits to pooled GenoID, 50 random bits to DBKEY, labels the generator “High,” states that non-structured bits are computationally indistinguishable from uniform, and states that a pool-state thief predicts at most 256 future UUIDs. It also states that `Math.random` is a 128-bit-state Xorshift128+ source with zero min-entropy.

**Claim type.** **Inferred** for the structural entropy budget and threat reasoning. **Unsupported or contradicted** for the universal security labels, the 256-UUID structured-pool bound, the `Math.random` implementation description, and any implication of cryptographic reduction.

**Implementation source.** `algo.ts:82-162` makes the entropy source injectable; the default is Web Crypto. `algo.ts:216-225` sets the simple pool to 256. `algo.ts:217` sets the structured single-parent pool to 1024. `genStructuredGenoID` at `algo.ts:785-798` normally selects the compiled path, whose generated source calls `getRandomValues` per UUID at `algo.ts:1071-1076`. `genMathRandom` at `algo.ts:183-191` calls the runtime's native `Math.random`; it does not implement Xorshift128+ in GenoID.

**Experiment/script.** No adversarial prediction, state-compromise, side-channel, or cryptographic-reduction experiment is present. NIST and dieharder are statistical batteries, not proofs of the stated threat model. `configureRandom` explicitly permits a caller-supplied weak source.

**Sample size and runtime.** No security experiment sample or runtime. The relevant entropy statements are arithmetic over the layout: DBKEY has 48 timestamp bits, 8 shard bits, 16 counter bits, 6 reserved bits, and 50 remaining random bits.

**Statistical test or metric.** Structural bit count, assumed OS-CSPRNG reliability, and qualitative adversary capabilities. No attack success rate, prediction benchmark, or formal reduction is measured.

**Exact result artifact.** `sources/security-analysis.md:15-142` is an analysis note, not an executable security result. The tracked dieharder table does not validate forward secrecy or metadata confidentiality.

**Reproducibility status.** Conceptual only. The threat model is readable, but its assumptions are not tied to a versioned security artifact or formal proof.

**Known caveat.** The metadata-leakage warning is appropriate. The pool-forward-secrecy statement is not uniform across implementations: base `genGenoID` uses 256 entries, single-parent structured mode uses 1024, and compiled structured mode has no 256-entry pool. The claim that `Math.random` has exactly zero min-entropy is not established by the source. The claim that `pg_uuid_v8` uses AES is also not the mode used by the local baseline, which uses XOR (`scripts/baselines.ts:40-59`).

**Required journal action.** Scope every entropy statement to a named path and RNG assumption. Replace “secure” with the defined CSPRNG and threat-model wording. Correct pool sizes and counter-path descriptions. Remove unsupported `Math.random` internals and AES claims, or provide direct evidence for them.

### C15. GA operators and randomness quality

**Exact claim.** The paper separates GenoID's architectural contribution from CSPRNG-inherited randomness quality. The notes further claim that all ablation variants pass NIST, that GA cannot rescue weak or degraded sources, and that CSPRNG is the sole source of quality.

**Claim type.** **Inferred** from the data-processing argument. **Unsupported** as an empirical conclusion because the claimed ablation and degraded-source results are not committed.

**Implementation source.** `genGenoID` uses pooled byte crossover/mutation in `algo.ts:224-250`. `composeStructured` and `genStructuredParent` are lower-level field-composition functions at `algo.ts:637-670`. The normal public structured path is compiled at `algo.ts:785-798`; inspected callers show `composeStructured` is used by tests and E1/E7-style scripts, not by the normal compiled public generator.

**Experiment/script.** `scripts/export-ablation.ts` exports raw-v8, full, crossover-only, and mutation-only streams. `scripts/export-weak-entropy.ts` exports four Math.random variants. `scripts/export-degraded.ts` exports five degraded sources, raw and GA variants. `scripts/nist-bridge.py` can consume such files, but no result output is committed.

**Sample size and runtime.** The exporters use 10,000 UUIDs per variant, approximately 1.22M free bits per variant. Five degraded sources produce ten variants. No runtime, library version, raw bitstream, or p-value table is present.

**Statistical test or metric.** NIST 15-test pass/fail and alleged structural-failure comparison across degraded sources. The information-theoretic statement that a deterministic map cannot increase Shannon entropy is a valid general argument, but it does not measure the implementation.

**Exact result artifact.** No ablation, weak-entropy, degraded-source, rank-scan, or NIST result file exists under `results/`. `results/dieharder-results.md` covers only four selected generators and does not cover all ablation/degraded variants.

**Reproducibility status.** Export scripts are inspectable, but the claimed experiment cannot be audited or rerun from a clean result package. The current production structured path also makes the “GA in structured generation” wording ambiguous.

**Known caveat.** Passing tests cannot establish that GA improves randomness, and failing to rescue a weak stream at one sample size cannot establish a universal negative result. The negative finding should be scoped to the tested transforms, sources, and sample sizes.

**Required journal action.** Archive every exported bitstream or its hash, run the named battery, save all p-values, and state the tested scope. Separate the base pooled GA path from the compiled structured path. Keep the negative result only if its evidence is actually archived.

### C16. `pg_uuid_v8` baseline and prior-art wording

**Exact claim.** `paper.tex:612` describes `pg_uuid_v8` as generating RFC 9562 v8 UUIDs with an encrypted timestamp and presents it as the closest prior art.

**Claim type.** **Unsupported/contradicted** for the RFC-v8 characterization. The comparison may still be valid as a timestamp-embedding prior-art baseline if its output format is described accurately.

**Implementation source.** `scripts/baselines.ts:40-59` implements the local baseline as UUID v4-compatible XOR output and sets version nibble `0x4`. `scripts/bench-pg-uuid-v8.ts:64-77` explicitly checks for version `0x4` and variant `0x2`. `sources/journal-novelty-audit.md:108-112` records the same v4-compatible concern.

**Experiment/script.** The head-to-head script uses 200,000 throughput IDs, 2,000,000 collision IDs, and 50,000 uniformity samples, but writes no result artifact for those metrics.

**Sample size and runtime.** Nominal sizes are present in the script; no result runtime is recorded.

**Statistical test or metric.** Version/variant checks, timestamp round trip, exact duplicate count, and payload-bit deviation.

**Exact result artifact.** None for the P1 head-to-head. `CHANGELOG.md:279` contains a prose result, not raw output.

**Reproducibility status.** The local baseline implementation is reproducible, but its identity and external prior-art description are not aligned with the manuscript.

**Known caveat.** The baseline's name can lead readers to infer v8 output when the implementation is v4-compatible. The security comparison also describes AES while the benchmark uses XOR.

**Required journal action.** Correct the paper and related-work text to say v4-compatible timestamp embedding unless an actual v8 implementation is evaluated. Separate external prior-art capabilities from the local baseline implementation.

### C17. Artifact title, version, DOI, and release identity

**Exact claim.** `paper.tex:603` says the artifact is tag `v1.21.0` archived at DOI `10.5281/zenodo.21617109`, and that every evaluation table and golden mutation check runs in CI.

**Claim type.** **Measured metadata with contradictory records**. The version/DOI relationship is recoverable, but the manuscript, README, and citation file do not agree.

**Implementation source and metadata.** `package.json:3` says version `1.21.2`. `CITATION.cff:2-11` says version `1.13.1`, date `2026-07-19`, and explicitly says no archival DOI has been minted. `README.md:5` points to DOI `10.5281/zenodo.21618258`. `paper.tex:603` points to DOI `10.5281/zenodo.21617109` and tag `v1.21.0`. `CHANGELOG.md:22-31` says DOI `10.5281/zenodo.21617109` was finalized.

**Experiment/script.** Git and DataCite metadata were checked. Local tags `v1.13.1`, `v1.21.0`, and `v1.21.2` exist. DataCite reports DOI `10.5281/zenodo.21617109` as version `v1.21.0`, related to the `v1.21.0` Git tag. DataCite reports DOI `10.5281/zenodo.21618258` as version `v1.21.2`, related to the `v1.21.2` Git tag. The paper title appears as an alternative title on the v1.21.2 record.

**Sample size and runtime.** No experimental sample. The relevant provenance points are `HEAD` `249cb3c` dated 2026-09-23, package release metadata dated 2026-07-27, and tracked result files last committed on 2026-07-27.

**Statistical test or metric.** Version, tag, title, DOI, and artifact-manifest consistency.

**Exact result artifact.** No single manifest maps the manuscript, source revision, result files, browser binaries, native database result, and DOI. `results/db-native.json` is untracked and therefore cannot be part of the archived package.

**Reproducibility status.** Partially reproducible. Git tags and two DOI records exist, but the manuscript's selected version differs from the package/README and the citation file is stale. CI artifacts are not permanently archived in the repository.

**Known caveat.** The title difference is partly explained by DataCite's primary and alternative titles. The version and DOI choices are not harmless wording differences because they identify different archives.

**Required journal action.** Choose one frozen release. For the current package, align the manuscript, README, and `CITATION.cff` to `v1.21.2` and DOI `10.5281/zenodo.21618258`, or explicitly freeze the manuscript to `v1.21.0` and DOI `10.5281/zenodo.21617109`. Archive the exact commit, result manifest, checksums, and native result if it is cited.

### C18. “Every evaluation table is regenerated by `bun run bench-ci`”

**Exact claim.** `paper.tex:603` states that every table in Section 6 is regenerated by `bun run bench-ci`, and that golden vectors and mutation checks run in CI on every push.

**Claim type.** **Unsupported**.

**Implementation source.** `package.json:30-41` maps separate commands for `bench-ci`, `bench-rejection`, `bench-db`, `collision-100m`, `dieharder`, and `playwright`. `scripts/bench-structured.ts` contains E1-E7. `scripts/nist-bridge.py`, `scripts/run-dieharder.ts`, `scripts/bench-db.ts`, and `scripts/playwright.ts` have separate output paths.

**Experiment/script.** `bench-ci` runs throughput and one-million collision tests. It does not run E1, the rejection sweep, NIST, dieharder, the database benchmark, the browser harness, or the Rust checker. The workflow's golden job runs `export-golden.ts` and Cargo, but contains no mutation-check command.

**Sample size and runtime.** Not applicable to this provenance claim. The relevant scripts use different sample sizes and runtimes: 40 rejection cells, 1.22M-bit NIST exports, 100M-bit dieharder streams, 500K-row database runs, 2M browser collision samples, and 3,000 Rust vectors.

**Statistical test or metric.** Command-to-artifact provenance, not a statistical metric.

**Exact result artifact.** The tracked result set demonstrates separate artifacts and dates; no single `bench-ci` artifact contains the manuscript's full evaluation section.

**Reproducibility status.** False as written. A reader following the availability sentence cannot regenerate the claimed evidence set from that one command.

**Known caveat.** The repository has good individual scripts, but the manuscript's aggregate reproducibility sentence obscures their different scopes and artifact lifetimes.

**Required journal action.** Replace the sentence with a table mapping every paper table/figure to its exact command, input, output path, runtime, and archive. Do not claim CI execution for experiments that are local or absent.

## Cross-cutting contradictions requiring correction

1. **Repair operator.** Current source uses index modulo. `sources/rejection-cost.md` and `sources/formal-proofs.md` describe Hamming-nearest repair. The paper's frequency prediction also does not match the current modulo map for the five-value shard set.
2. **Production structured path.** The paper describes pooled two-parent crossover. The normal public structured generator selects a compiled per-call path. The Rust and E1 evidence exercise different seams.
3. **Pool size.** The paper and security note use 256. Current source uses 1024 for the single-parent structured pool and no 256-entry pool in the compiled path.
4. **Counter semantics.** The paper says tick-keyed monotonic handling occurs before repair. That is true for the single-parent refill path, not the normal compiled counter path, which uses a generated counter expression and separate state.
5. **NIST command.** `package.json` and AGENTS documentation point `test:stats` at `scripts/stats.ts`, while the full 15-test implementation is `scripts/nist-bridge.py`.
6. **Native database evidence.** PostgreSQL output exists only in an untracked file; InnoDB output is absent. SQLite and PostgreSQL workloads are not interchangeable.
7. **Prior-art format.** The local `pg_uuid_v8` baseline is v4-compatible XOR, while the manuscript calls it an RFC v8 implementation and the security note discusses AES.
8. **Version and artifact identity.** Current package, paper, README, and `CITATION.cff` identify different versions or DOI states.
9. **Golden verification.** CI regenerates golden files before comparing Rust output and does not execute the claimed mutation matrix.

## Prioritized journal blockers

1. **Correct the repair theorem and 10^8 claim.** Resolve modulo versus nearest-value semantics, derive the exact output distribution, and either archive the 100,000,000-draw histogram or remove that claim.
2. **Archive the missing central results.** Commit or rerun E1, full NIST p-values, 2M/50k structured quality output, the nine-environment CI consolidation, and any 100M collision output. Map every manuscript number to one artifact.
3. **Align the shipped structured path with the paper.** Decide whether the contribution is compiled per-call generation, pooled single-parent generation, or two-parent crossover. Re-run security, counter, throughput, and Rust evidence on the selected path.
4. **Repair database evidence and wording.** Commit native PostgreSQL evidence with dependencies/configuration, add InnoDB or narrow the claim to SQLite, and replace the unsupported composite table with a traceable artifact.
5. **Freeze and verify the artifact.** Choose `v1.21.0` or `v1.21.2`, synchronize title/version/DOI metadata, preserve immutable golden hashes, add mutation checks, and archive the exact result manifest.

## Current evidence disposition

The rejection sweep is usable after analytical cells and timing limitations are labeled. The dieharder table is usable only as a curated dieharder/STS subset. The browser collision result is useful but needs a fresh engine-provenance capture. The SQLite artifact supports its own relative 500,000-row BLOB experiment, not the manuscript's composite-key table. The Rust files support a narrow seeded single-parent comparison. The 10^8 frequency claim, full NIST claim, production-path 1.5M claim, consolidated CI table, InnoDB claim, broad security labels, and GA empirical conclusions are not currently supported by committed artifacts.

This audit does not determine journal acceptance and makes no ICTDSC acceptance claim.
