# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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
