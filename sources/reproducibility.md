# GenoID — Reproducibility Package

This document is the single reference for reproducing every experiment cited
in the README, CHANGELOG, and `sources/*.md` from a clean clone. Written to
satisfy an artifact-evaluation committee's checklist (availability,
functional, reusable) at the level a Scopus Q1 systems/security venue expects.

## 1. Environment

| Requirement | Version pinned by |
|---|---|
| Node.js | `>=22` (`package.json` `engines.node`; needed for `crypto.randomUUID()` / `crypto.subtle`) |
| Bun | `latest` at CI time (`oven-sh/setup-bun@v2` in `.github/workflows/bench.yml`); exact lockfile in `bun.lock` |
| TypeScript | `7.0.2` (pinned in `package.json` devDependencies) |
| Python (NIST bridge only) | 3.x + `numpy`, `scipy`, `nist80022` (imported by `scripts/nist-bridge.py`) |
| dieharder (extended randomness only) | Ubuntu `apt` package, installed fresh per CI run — see §3 |

`bun.lock` pins every transitive dependency, so `bun install` reproduces the
exact dependency graph used to produce the numbers in the README, not just
compatible semver ranges.

## 2. One-command reproduction of each claim

| Claim in README / CHANGELOG | Command | Output |
|---|---|---|
| Composition correctness (E1), repair-vs-rejection (E2), collision/uniformity (E3-E5), throughput (E6) | `bun run scripts/bench-structured.ts` | stdout table |
| Node.js speed + uniformity + collision (v4/v7/hash/mr/GenoID) | `bun run bench` | stdout, with mean±std/95%CI + Welch t-test (v1.9.0+) |
| CI-style condensed JSON benchmark | `bun run bench-ci` | `dist/bench-ci-results.json` |
| NIST SP 800-22, all 15 tests, all sample layouts | `bun run test:stats` (wraps `scripts/nist-bridge.py`) | stdout PASS/FAIL per test |
| Concurrent generation, cross-worker collision (Task B) | `bun run bench-concurrent` | stdout |
| SQLite B-tree index locality (Task C) | `bun run bench-sqlite` | stdout |
| 100M-scale collision test, all cores (Task D) | `bun run collision-100m` | stdout |
| Extended dieharder battery (this addition) | `bun run export-dieharder` then `dieharder -d <N> -g 201 -f dist/<name>.dieharder.bin` per test ID (see `.github/workflows/bench.yml` job `dieharder` for the exact curated test-ID list and loop) | `dieharder-summary.md` |
| Baseline generators (pg_uuid_v8, ULID, ULID-v8, KSUID, Snowflake) known-answer tests | `bun test scripts/baselines.test.ts` and `scripts/baselines-verify.test.ts` | pass/fail per generator |
| Full unit test suite | `bun run test` | pass/fail (29 tests as of v1.11.x) |
| Browser benchmark (interactive, with 95% CI table) | `bun run build && open index.html`, click "Run All" | in-page results table |
| Automated headless-browser check (deployable = development parity) | `bun run puppeteer` | stdout, `browserErrors: []` expected |
| Multi-OS / multi-runtime matrix + consolidated report | Push to a branch / open a PR (runs `.github/workflows/bench.yml`); or run any single `bun run bench-ci` locally per OS | `ci-consolidated` GitHub Actions artifact |

All of the above are deterministic in *procedure* (same script, same inputs)
but **not** in *output values*, because every generator draws from the OS
CSPRNG — this is intentional (a seed-fixed CSPRNG would defeat the point of
testing real randomness) and is why every experiment reports many trials /
large sample counts rather than a single run, per
`sources/threats-to-validity.md` §1 and §4.

## 3. Extended dieharder battery — methodology and disclosed limitation

NIST SP 800-22 (`scripts/nist-bridge.py`, full 15-test battery) validates
~1.22M-bit samples. dieharder is a larger, independently-implemented battery
that expects much more data before its harder sub-tests (e.g.
`rgb_lagged_sum`, `diehard_bitstream`) can run without the input file being
rewound (re-used), which invalidates their p-values. `scripts/export-dieharder.ts`
exports 100M-bit (12.5MB) raw binary samples per generator (v4, raw-v8,
GenoID-pooled, GenoID-structured `dbkey`) to close that gap — 12.5MB avoids
rewinding on any dieharder sub-test's default sample request for a single
pass.

**Disclosed limitation:** the CI job (`.github/workflows/bench.yml`, job
`dieharder`) runs a **curated 15-test subset** (`-d 0 2 4 5 7 8 10 13 15 100
102 203 249 251 254`, spanning the diehard/sts/rgb/dab families), not the
full `-a` battery (~114 sub-tests), because `-a` at this sample size would
take well beyond a practical CI time budget across four generators. This
trade-off is stated here explicitly rather than silently only reporting the
subset as if it were the full battery — see `sources/threats-to-validity.md`
§1 ("selection bias in which tests are reported"). Anyone wanting the full
`-a` battery can run `dieharder -a -g 201 -f dist/<name>.dieharder.bin`
locally against the exported files; it is not run in CI by default.

Because this sandbox environment had no root access to install `dieharder`
via `apt`, the CI job's exact output has not yet been observed by the agent
authoring this document — it is designed to run correctly on GitHub Actions'
`ubuntu-latest` runners (which grant passwordless `sudo` by default) and
should be verified on the next push before being cited as a completed result
in a paper draft.

## 4. Artifact availability

| Item | Location |
|---|---|
| Source code | https://github.com/mmmmaharshi/geno-id (public) |
| Version tags | `git tag` per release, e.g. `v1.11.3`; see `CHANGELOG.md` for the full history |
| CI results (multi-OS/runtime benchmarks, NIST, dieharder) | GitHub Actions run artifacts (`ci-consolidated`, `bench-bun-*`, `bench-node-*`, `dieharder-results`) — retained per GitHub's default artifact retention window, not permanently archived |
| License | `LICENSE` (MIT) — permits reuse/replication without restriction |
| Citation metadata | `CITATION.cff` |
| Long-term archival DOI | **Not yet reserved.** For a paper submission, mint a Zenodo (or software-heritage) DOI snapshot of the exact tagged commit before submission, since GitHub Actions artifacts alone are not a permanent archive. This is the one open action item gating a fully artifact-evaluation-ready package. |

## 5. What "reproducible" means here, precisely

Given the CSPRNG-driven nondeterminism noted in §2, reproducibility claims in
this repo are of the form: *re-running the same script on the same or
comparable hardware yields the same qualitative conclusion (NIST 15/15 PASS,
0 collisions at the tested scale, GenoID throughput within the reported
confidence interval of the original run) — not bit-identical output.* This
is the standard and expected notion of reproducibility for
randomness/performance claims, and matches how the NIST STS suite and
throughput benchmarking literature define it.
