# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.9.0] - 2026-07-18

### Summary

Statistical significance testing for the benchmarks. Throughput is no longer a
single-run point estimate: every generator is measured over **10 repeated
trials** and reported with the sample standard deviation and a **95% confidence
interval**, and generator-to-generator differences are tested with a **Welch
t-test** (plus Cohen's *d* effect size) so each "GenoID vs baseline" claim is
stated as statistically significant or not — addressing the prior gap of
"NIST pass/fail only, no confidence intervals, no repeated-trial variance."

### Highlights

#### 📊 Repeated trials, confidence intervals, significance tests

- `bench-core.ts`: new `benchRepeated` / `benchRepeatedAsync` wrap the existing
  timing primitives in N repeated trials and return `BenchStats` (mean, std,
  coefficient of variation, min/max, **95% CI**, raw samples). The CI critical
  value is a small exact t-distribution lookup, so the browser-loaded harness
  stays lean.
- `scripts/significance.ts` (new, pure module): `welchTTest` + `cohensD` +
  `compareBench` with a proper two-tailed Student-t p-value (regularized
  incomplete beta via Lanczos log-gamma). Kept out of `bench-core.ts` so it is
  not shipped to the browser.
- `scripts/bench.ts`: every generator prints `mean ± std ops/sec (95% CI …)`
  and a **Statistical significance** block (e.g. *GenoID vs v4: Δ=−35.4%,
  Welch t=−16.91, p<0.0001, d=−7.56 — SIGNIFICANT*).
- `scripts/bench-ci.ts` + `scripts/ci-result.ts`: CI now emits error-bounded
  numbers (`ci95`, `std`, `trials`) per environment.
- `scripts/bench-core.test.ts` + `scripts/significance.test.ts` (TDD, red→green)
  cover the repeated-trial stats and the Welch/Cohen math.

### Breaking Changes

- None.

### Upgrade Guide

- No code changes required. Run `bun run bench` to see CIs and significance;
  `bun run bench-ci` emits per-environment error-bounded throughput.

### Known Issues

- Throughput variance is reported for Node-side benchmarks only; the interactive
  browser benchmark (`benchmark.ts`) still shows a single run (no repeated trials
  in-browser yet).

### Dependencies Updated

- None.

## [1.8.0] - 2026-07-18

### Summary

Formal security analysis for the GenoID "Security class" labels. Turns the
per-field bit counts in `algo.ts` into an explicit entropy budget, defines an
adversarial model (passive observer, state compromise, structure inference), and
benchmarks GenoID against RFC 9562 §8 security considerations — replacing the
previously asserted labels with a grounded argument in
[`sources/security-analysis.md`](sources/security-analysis.md). README now links
the analysis, and the browser table's pool window is corrected to 256 UUIDs.

### Highlights

#### 🔐 Formal security argument (replaces asserted labels)

- [`sources/security-analysis.md`](sources/security-analysis.md): per-field
  **entropy accounting** (only random bits count; timestamp/counter/shard are
  observable → 0 min-entropy), an explicit **adversarial model**, and a
  **RFC 9562 §8 comparison**.
- Min-entropy table: v4/GenoID v8 122 bit · v7/ULID-v8 74 bit · GenoID-structured
  (dbkey) 50 bit · pg_uuid_v8 up to 122 bit (AES-steganographic) · Math.random 0 bit.
- Two honest caveats now documented: (1) the **pool forward-secrecy window** —
  an in-process pool refills every **256** UUIDs, so a state-compromise adversary
  can predict at most 256 future UUIDs per refill; (2) **structured layouts leak
  metadata by design** (timestamp ±1 ms, shard, counter, tenant) and are
  distinguishable from random, consistent with RFC 9562 §8.2's v7-style warning.

### Breaking Changes

- None.

### Upgrade Guide

- No code changes required. Read `sources/security-analysis.md` for the security
  rationale behind the evaluation tables.

### Known Issues

- No formal cryptographic reduction (entropy-bounding + adversarial reasoning
  only). Pool epoch length (`GENO_POOL_N = 256`) is tunable for tighter forward
  secrecy at a throughput cost.

### Dependencies Updated

- None.

## [1.7.0] - 2026-07-18

### Summary

Task D: a 100M-scale batched collision test (`bun run collision-100m`). The shared
`collisionTest` keeps every ID in a `Set<string>`, which cannot hold 100M entries in
memory, so this replaces it with an exact dedup built on a compact open-addressing
128-bit hash set (`BigUint64Array`) and fans the work out across every CPU core with
`worker_threads`. All generators report **0 collisions** at 100M — far below the
122-bit birthday bound (~2.7×10¹⁸ IDs).

### Highlights

#### 🧨 Collision at scale (100M, all cores)

- New `scripts/collision-100m.ts` + `bun run collision-100m` (env: `COLLISION_N`,
  `COLLISION_SYNC=1` for the single-threaded path) + `scripts/collision-100m.test.ts`
  (TDD, red→green).
- A `Uuid128Set` stores each 128-bit UUID as two 64-bit slots in a `BigUint64Array`
  with power-of-two capacity + linear probing — ~2.3 GB for 100M IDs instead of the
  ~10 GB a `Set<string>` would need.
- Work is fanned out across `os.cpus().length` workers; each dedups its own partition.
  Cross-worker uniqueness follows from independent per-worker CSPRNG pools (proven in
  Task B). Memory splits per worker (≈ 68 MB/worker at 10M on 6 cores vs 272 MB
  single-threaded) and throughput scales with core count.
- Result: **0 collisions** for v4, GenoID v8, v7, GenoID-structured, and ULID-v8 at
  100M — confirms the implementation produces no systematic duplicates at production
  scale, matching the theoretical birthday bound.

### Breaking Changes

- None.

### Upgrade Guide

- No action required. `bun run collision-100m` is opt-in; existing `bun run bench`,
  `bun run bench-ci`, `bun run bench-concurrent`, `bun run bench-sqlite`, and
  `bun run test` are unchanged.

### Known Issues

- None.

### Dependencies Updated

- None.

## [1.6.0] - 2026-07-18

### Summary

Task C: a SQLite B-tree index benchmark (`bun:sqlite`) that proves structured,
sortable IDs keep the primary-key index index-friendly. It bulk-inserts 100k IDs of
each kind (v4, GenoID v8, v7, GenoID-structured `dbkey`, ULID-v8) into a fresh
in-memory table with a `TEXT PRIMARY KEY`, then reports insert throughput and B-tree
compactness (`page_count`, `freelist_count`, `bytes/row`).

### Highlights

#### 🗄️ B-tree index benchmark (SQLite)

- New `scripts/bench-sqlite.ts` + `bun run bench-sqlite` + `scripts/bun-sqlite.d.ts`
  (ambient type shim, no extra dependency — uses Bun's built-in `bun:sqlite`).
- New `scripts/bench-sqlite.test.ts` (TDD, red→green): every ID type fills a clean
  B-tree (`integrity_check = ok`) with **zero fragmentation** (`freelist_count = 0`),
  and page counts across all types stay within 5% of each other — confirming leaf
  packing is order-independent.
- Key finding: page count is set by N and key size, **not** insertion order, so B-tree
  depth is the same for random and sortable IDs. The structured-ID benefit is
  index-friendliness — sortable IDs (v7, ULID-v8) match/exceed random IDs on insert
  throughput **while preserving insertion-time order** for efficient time/tenant/shard
  range scans.

### Breaking Changes

- None.

### Upgrade Guide

- No action required. `bun run bench-sqlite` is opt-in; existing `bun run bench`,
  `bun run bench-ci`, `bun run bench-concurrent`, and `bun run test` are unchanged.

### Known Issues

- None.

### Dependencies Updated

- None.

## [1.5.0] - 2026-07-18

### Summary

Task B: a concurrent / multi-process generation simulation that proves GenoID is
safe to fan out across `worker_threads`. GenoID is a pure, stateless function over
the process-global CSPRNG pool, so a cluster of app servers or a bulk ETL pipeline can
each mint IDs without coordination. The experiment spawns N worker threads, each
generating `perWorker` UUIDs, then verifies globally: 0 cross-worker collisions, 0
constraint violations in structured fields, and every UUID carries the RFC 9562 v8
marker.

### Highlights

#### 🧵 Concurrent generation (worker_threads)

- New `scripts/bench-concurrent.ts` + `bun run bench-concurrent`: spawns N workers
  (configurable via `CONCURRENT_WORKERS`, `CONCURRENT_PER_WORKER`, `CONCURRENT_MODE`),
  each calling `genGenoID` / `genStructuredGenoID`, and aggregates a global uniqueness
  and constraint check.
- New `scripts/bench-concurrent.test.ts` (TDD, red→green): across worker threads,
  plain GenoID yields **0 collisions** (3×50k) and the structured `concurrent-dbkey`
  layout yields **0 collisions and 0 tenant-constraint violations** (4×50k). The
  `tenant` enum (allowed `0..7`) is preserved correctly under fan-out, confirming the
  constraint-repair path is thread-safe.

### Breaking Changes

- None.

### Upgrade Guide

- No action required. `bun run bench-concurrent` is opt-in; existing `bun run bench`,
  `bun run bench-ci`, and `bun run test` are unchanged.

### Known Issues

- None.

### Dependencies Updated

- None.

## [1.4.0] - 2026-07-18

### Summary

Phase B: a literature review, related-work survey, and novelty assessment for
GenoID, delivered as `sources/related-work.md`. It situates GenoID against the
UUID standards (RFC 4122 → RFC 9562 v6–v8), the family of sortable/structured
identifiers (ULID, KSUID, Snowflake, TypeID, xid, COMBGUID, ObjectID, CUID),
steganographic UUIDs (the closest prior art, `pg_uuid_v8`), genetic/evolutionary
computation, and high-throughput CSPRNG pooling.

### Highlights

#### 📚 Literature & related work

- RFC 9562 (Davis, Peabody, Leach; May 2024) obsoletes RFC 4122 and adds v6/v7/v8;
  v8 leaves 122 implementation-specific bits and is explicitly "not a replacement
  for UUIDv4". The popular `uuid` JS package ships no `v8()` because the RFC defines
  no algorithm — GenoID supplies that missing, declarative algorithm.
- RFC 9562's Motivation surveyed 16 prior sortable-ID implementations (ULID,
  KSUID, Snowflake, Flake, Sonyflake, COMBGUID, xid, ObjectID, CUID, …), all with
  fixed, hand-coded layouts — none declarative.
- `pg_uuid_v8` (PostgreSQL steganographic extension, May 2026) is the closest prior
  art: v4-format-compliant UUIDs embedding an encrypted microsecond timestamp.
  GenoID generalises this into a portable, declarative v8-layout framework with
  field-boundary crossover and constraint-guided mutation as repair.

#### 🧬 Novelty assessment

- A literature survey (Semantic Scholar, arXiv, OpenAlex, web) confirms **no
  academic paper applies genetic/evolutionary algorithms to UUID or identifier
  generation**. GenoID is the first application of GA-style operators to v8 payload
  *composition* (not entropy improvement) — consistent with the project's finding
  that GA's value here is architectural, not statistical.
- High-throughput secure generation: reusing/amortising CSPRNG draws (e.g. Go
  `pscheid92/uuid` Pool ≈ 17 ns vs 247 ns stateless) motivates GenoID's pooled
  64-UUIDs-per-call design.

### Breaking Changes

- None.

### Upgrade Guide

- No action required. The review is documentation only; the implementation is
  unchanged from 1.3.0.

### Known Issues

- `sources/related-work.md` is the Phase B deliverable; later phases (C/D) will
  extend the tech report (e.g. evaluation write-up, limitations).

### Dependencies Updated

- None.

## [1.3.0] - 2026-07-18

### Summary

This release adds multi-environment validation in response to reviewer feedback
that single-machine, one-browser evaluation was insufficient. It introduces a
CI benchmark matrix across operating systems and Node.js runtimes, a standalone
CI benchmark harness, cross-environment job summaries, and a known-answer/structural
verification suite for the Phase A baselines. The README gains CI and release badges,
a Phase A baseline comparison table, a multi-environment validation section, and a
Quick Start.

### Highlights

#### 🌐 Multi-environment CI matrix

- Added `.github/workflows/bench.yml` running the benchmark on Bun (ubuntu, macOS,
  Windows) and Node.js 20/22/23 (ubuntu) via `tsx`. Each job uploads its raw results
  (`dist/bench-ci-results.json`) and a rendered summary (`dist/ci-summary.md`) as
  artifacts.
- Added `scripts/bench-ci.ts`: an environment-aware JSON benchmark harness that runs
  unchanged under both Bun and `bun x tsx` (Node), so CI numbers are reproducible locally.
- Added `scripts/ci-summary.ts`: aggregates per-environment results into a cross-platform
  comparison and appends it to `GITHUB_STEP_SUMMARY`.

#### ✅ Baseline verification suite

- Added `scripts/baselines-verify.test.ts` (7 tests): the published ULID spec vector plus
  structural round-trips for `pg_uuid_v8`, `ULID-v8`, `KSUID`, and `Snowflake`, and an
  all-timestamps-embedded check. The full suite is now **22/22 passing**.

#### 📝 Documentation

- README: CI + release badges, Phase A baseline comparison table, multi-environment
  validation section, and a Quick Start.

### Breaking Changes

- None.

### Upgrade Guide

- No action required. To reproduce CI numbers locally, run `bun run bench-ci` (Bun) or
  `bun x tsx scripts/bench-ci.ts` (Node).

### Known Issues

- The inline GitHub Actions "Summary" tab can render empty in the runner UI; the
  authoritative cross-environment report is the uploaded `ci-summary.md` artifact (and
  the job logs). `dist/` is gitignored, so results live only in CI artifacts.
- Phase B (literature review) and Tasks B–D (concurrent generation, SQLite index
  benchmark, 100M-scale collision) are not yet part of this release.

### Dependencies Updated

- Added devDependency `tsx` (runs `.ts` scripts under Node in CI). `ulid` was briefly
  evaluated and removed.

## [1.2.0] - 2026-07-17

### Summary

This release strengthens the experimental evaluation (Phase A) with comparison
baselines against the closest prior art and the broader structured-ID landscape,
scales collision testing to 10M UUIDs, and validates baseline random payloads
against the full NIST SP 800-22 battery. It also documents the automatic-versioning
policy and renders the README Evaluation section as a table.

### Highlights

#### 📊 Comparison baselines

- Added `pg_uuid_v8` (closest prior art — UUID v4-compatible steganographic
  timestamp), `ULID`, `ULID-v8`, `KSUID`, and `Snowflake` generators, each with
  TDD unit tests.
- Benchmarked throughput across all generators: GenoID stays within ~1.4× of
  native v4, while baselines range from ~0.5M (KSUID) to ~4.9M (Snowflake) ops/s.

#### 🔬 Stronger evaluation

- Scaled collision testing to 10M with an exact BigInt check — **0 collisions**
  for v4, GenoID, pg_uuid_v8, and ULID-v8.
- Ran NIST SP 800-22 on baseline random payloads: pg_uuid_v8 and ULID-v8 pass
  **all 15 tests**, matching GenoID's statistical quality.
- Fixed a methodology flaw: a naive whole-UUID uniformity check is invalid for
  timestamped IDs (byte 0 is a constant timestamp), so uniformity is now measured
  on the random payload only.

#### 🛠 Tooling & docs

- Documented the automatic-versioning policy in `AGENTS.md`.
- Rendered the README Evaluation section as a table.

### Breaking Changes

None.

### Upgrade Guide

No special steps required. Standard deployment process applies.

### Known Issues

None.

### Dependencies Updated

| Package | From | To | Reason |
| --- | --- | --- | --- |
| (none) | — | — | No dependency changes in this release |

## [1.1.0] - 2026-07-17

### Summary

This release introduces the declarative RFC 9562 v8 structured-layout framework,
adds `node:test` suites and a TDD workflow, and migrates the toolchain to Bun.
It also fixes two critical correctness bugs in the structured generator.

### Highlights

#### 🧩 Declarative v8 layout framework

- Added `genStructuredGenoID`, `composeStructured`, `repairConstraints`,
  `readStructured`, and `completeLayout` for composing structured UUIDs with
  field-boundary crossover and constraint-guided mutation as repair.
- Validated via E1–E6: composition correctness, repair-vs-rejection, collision /
  uniformity, NIST, and throughput.

#### 🧪 Testing & tooling

- Added `node:test` suites (`scripts/layout.test.ts`, `scripts/structured-read.test.ts`).
- Adopted the `mattpocock/skills@tdd` red-green discipline and the Bun toolchain
  (`bun run test` / `build` / `lint` / `typecheck` / `bench`).

#### 🐛 Critical bug fixes

- **32-bit truncation** — fixed bit-by-bit field math so fields >32 bits keep
  their high bits (previously caused catastrophic NIST bias).
- **Single-parent population** — structured fields are now populated in both
  pooled parents so crossover always yields valid values.

### Breaking Changes

None.

### Upgrade Guide

No special steps required. Standard deployment process applies.

### Known Issues

None.

### Dependencies Updated

| Package | From | To | Reason |
| --- | --- | --- | --- |
| @changesets/cli | — | 2.31.1 | Added for version management |
