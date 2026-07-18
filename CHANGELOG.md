# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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
