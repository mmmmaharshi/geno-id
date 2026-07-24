# GenoID

Novel GA-inspired UUIDv8 algorithm benchmarked against v4, v7, SHA-256 hash-derived, and Math.random baselines.

## Start here (next action)

1. Pick the task. Implement code → run the **Quality gates** (below). Docs/config only → run gate 9 (verify) + ask before publish.
2. After any `.ts` change, the quality gates are the contract: lint → typecheck → test → build → bench-ci → playwright. Zero errors before continuing.
3. Never push or publish without explicit confirmation.

## Project Overview

GenoID is a TypeScript RFC 9562 v8 UUID library + CLI + browser benchmark. The proposed algorithm (`geno`) is a pooled CSPRNG with byte-level GA crossover/mutation. The research contribution is the **structured (declarative v8 layout) framework** — GA helps UUIDs through *composition*, not randomness (see Research findings).

**Architecture — 5 algorithms benchmarked in `algo.ts`:**
- `v4` — `crypto.randomUUID()` (native baseline)
- `v7` — RFC 9562 UUIDv7 (48-bit timestamp + 74 random bits)
- `hash` — SHA-256 hash-derived (v5-style, async via SubtleCrypto)
- `mr` — Math.random (Xorshift128+, insecure baseline)
- `geno` — GenoID (pooled CSPRNG + byte-level GA crossover/mutation, RFC 9562 v8)

`scripts/bench.ts` holds extra GenoID variants (Fast v1–v3) used in development; the browser ships only `genGenoID`. `bench-core.ts` is the shared harness used by both `benchmark.ts` (browser) and `scripts/bench.ts` (Node).

**Key tech:** Bun (runtime/build/test/lint/typecheck/publish), Node 22+ (CI), Deno 2.9.3 (CI-only research runtime), Playwright (browser benchmark), oxlint, changesets.

## Setup Commands

- Install deps: `bun install`
- Compile to `dist/`: `bun run build` (~5s)
- Install Playwright browsers: `bun x playwright install` (for `bun run playwright`)
- Deno (CI-only): install from https://deno.com

## Development Workflow

| Command | What | Time | Requires |
|---|---|---|---|
| `bun run build` | Compile TypeScript to `dist/` | ~5s | `bun install` |
| `bun run lint` | oxlint over all `.ts` | ~3s | `bun install` |
| `bun run lint:fix` | Auto-fix lint issues | ~3s | `bun install` |
| `bun run typecheck` | Typecheck root + scripts tsconfigs | ~10s | `bun install` |
| `bun run test` | Run all unit tests (`scripts/*.test.ts`) | ~4s | `bun install` |
| `bun run bench-ci` | Condensed CI-shaped benchmark + collisions → `dist/bench-ci-results.json` | ~30s | `bun install` |
| `bun run bench-rejection` | O(k) vs (1/d)^k repair sweep → `results/rejection-sweep.json` | ~5s | `bun install` |
| `bun run bench-db` | SQLite index-locality benchmark → `results/db-sqlite.json` | ~30s | `bun install` |
| `bun run bench` | Full Node.js benchmark + uniformity | ~2min | `bun install` |
| `bun run test:stats` | NIST SP 800-22 monobit/runs/chi-square/correlation | ~30s | `bun install` |
| `bun run playwright` | Browser benchmark (Chromium/Firefox/WebKit; `--browser=name`/`all`) | ~3min | `bun install` + `bun x playwright install` |
| `bun run verify-playwright` | Dry-run Playwright with jsdom | ~5s | `bun install` |
| `open index.html` | Interactive browser benchmark | manual | Any browser |
| `deno run --allow-read --allow-write --allow-env --allow-sys scripts/deno/bench-ci.ts` | CI-shaped Deno benchmark + collisions | ~30s | `deno` |
| `deno run --allow-read --allow-env --allow-sys scripts/deno/collision-100m.ts` | Deno 100M collision test (fanned across cores) | ~1min | `deno` |
| `deno run --allow-read --allow-write --allow-env --allow-sys scripts/deno/stats.ts` | Deno NIST SP 800-22 battery | ~30s | `deno` |
| `deno check scripts/deno/bench-ci.ts scripts/deno/collision-100m.ts scripts/deno/stats.ts` | Type-check Deno CI entry ports | ~5s | `deno` |

**Source files:**

| File | Responsibility |
|---|---|
| `algo.ts` | Pure algorithm implementations (authoritative). No DOM or I/O. |
| `bench-core.ts` | Shared harness: `benchSync`, `benchAsyncBatched`, `birthdayBound50`, `collisionTest`, `collisionTestAsync`. No DOM, no I/O. |
| `benchmark.ts` | Browser runner. Exports `init(host?)` + `runAll`, `copyToClipboard`, `copyTableToClipboard`. No module-level side effects. |
| `index.html` | Loads `dist/benchmark.js` via `<script type="module">` and calls `init()`. |
| `scripts/bench.ts` | Node.js benchmark + GenoID experimental variants (Fast v1–v3). |
| `scripts/stats.ts` | NIST SP 800-22 monobit, runs, chi-square, pairwise correlation. |
| `scripts/playwright.ts` | Playwright automation. Exports `runBenchmark` with injectable `launch` factory. |
| `scripts/playwright.dryrun.ts` | Dry-run with JSDOM mock. Calls `init()` after import. |

## Testing Instructions

- Run all tests: `bun run test` (~4s; Bun runner over `scripts/*.test.ts`)
- Run a subset: `bun test scripts/algo.test.ts`
- Typecheck (not a test but a gate): `bun run typecheck`
- e2e (browser): `bun run playwright` — asserts `browserErrors: []`, `GenoID-structured` present, 0 collisions
- Coverage expectation: **`NN pass, 0 fail`** before continuing.

**TDD discipline:** follow [`mattpocock/skills@tdd`](https://skills.sh/mattpocock/skills/tdd) — write the failing test first (red), then only enough implementation to pass (green). Confirm the public seam under test; tests verify behavior through public interfaces, never implementation details.

## Code Style

- **Lint/format:** `bun run lint` (oxlint). `bun run lint:fix` auto-fixes.
- **No comments unless asked** (project convention).
- **File org:** `algo.ts` (pure, no DOM/I/O) + `bench-core.ts` (harness) + `scripts/*` (Node/Deno entry points, dynamically import `dist/*.js`).
- **Imports/exports:** `scripts/*.ts` dynamically import the compiled `dist/algo.js` directly — no shim.
- **Naming/version:** GenoID version nibble is `0x8` (RFC 9562 custom/experimental), not `0x4`.

**Response style (for this agent):**
- Follow the `/i-have-adhd` skill when responding: lead with the next concrete action, number multi-step work, externalize state across turns, suppress tangents, give specific time estimates, make wins visible, matter-of-fact tone.
- Always apply the `caveman` skill (full level) on every response: terse fragments, drop filler, no tool-call narration, no decorative tables/emoji, keep technical substance (API names, CLI commands, exact error strings) verbatim. Code/commits/PRs written normally.
- `README.md` must follow `research-paper-spj` + `i-have-adhd`: one-idea hook, 4-sentence TL;DR, concrete example in first 2 paragraphs, problem before solution, related work after technical content, refutable claims with evidence. Keep professional tone (no caveman style) in docs.

## Build and Deployment

- **Build:** `bun run build` → `dist/` (gitignored; rebuild after changing `algo.ts`/`benchmark.ts`/`bench-core.ts`).
- **Browser benchmark (deployable):** `open index.html` or serve `dist/`. `index.html` loads `dist/benchmark.js` (ES module) and calls `init()`.
- **CI/CD:** `.github/workflows/bench.yml` runs a matrix: `bun-matrix` (ubuntu/macos/windows), `node-matrix` (Node 22 × 3 OS), `deno-matrix` (Deno 2.9.3 × 3 OS), then a `consolidate` job merging per-env `bench-ci-results.json` into one table. Deno is CI-only.
- **Release:** changesets (metadata + git tags only; no npm registry). See Automatic versioning.

## Quality Gates (Agent workflow)

After every change to any `.ts` file, run in order. **Stop and fix on any failure — do not continue.**

1. `/thermo-nuclear-code-quality-review` — kill duplication, spaghetti, oversized files, redundant layers.
2. `bun run lint` — oxlint over all `.ts`.
3. `bun run typecheck` — both root + scripts tsconfigs.
4. `bun run test` — Bun test runner over `scripts/*.test.ts`.
5. `bun run build` — compiles to `dist/`.
6. `bun run bench-rejection` — validates O(k) vs O((1/d)^k) repair bound. **Confirm no NaN/null cells + `results/rejection-sweep.json` written.**
7. `bun run bench-db` — index-locality benchmark. **Confirm output written to `results/db-sqlite.json`.**
8. `bun run bench-ci` — condensed CI-shaped benchmark + collisions (exact command the CI matrix runs per environment). **Confirm 0 collisions + clean `dist/bench-ci-results.json`.**
9. `bun run playwright` — browser/deployable check. **Confirm** `browserErrors: []`, `GenoID-structured` present, 0 collisions.
10. Fix any errors from above before continuing.
11. **After any change** that passes gates 1–10, **ask the user** if they want `npm publish`. Do not publish without explicit confirmation.

### Visible wins (what "green" looks like)

| Gate | Pass condition |
|---|---|
| lint | `oxlint` exits 0 |
| typecheck | both `tsc` configs exit 0 |
| test | `NN pass, 0 fail` |
| bench-rejection | no NaN/null cells, `results/rejection-sweep.json` written |
| bench-db | output written to `results/db-sqlite.json` |
| bench-ci | all collision rows `PASS`, `dist/bench-ci-results.json` written |
| playwright | every browser `browserErrors: []`, `GenoID-structured` present, 0 collisions |

## Verification before completion (Iron Law)

No completion, "passing", "fixed", or "done" claim without **fresh verification evidence produced in the same turn**. Before asserting any status — or committing, tagging, releasing, or delegating — run the exact command that proves the claim, read its full output and exit code, and state the claim *with* that evidence. A prior run, "should pass", linter-only output, or an agent's self-reported success are never sufficient.

## Utilize multiple CPU cores

Any CPU-bound task with independent units (separate files/samples/sub-tests) must be fanned out across all cores, not run strictly in series. Keep output byte-for-byte identical to the serial run (same results, same order); only wall time drops. Use the right primitive:
- **Child processes** (`execFile` + pool capped at `os.cpus().length`) — e.g. dieharder.
- **`worker_threads`** — CPU-bound single-threaded JS (single-threaded JS does **not** gain cores from `Promise.all`). The `stats.ts` battery uses this (`stats-core.ts` + `stats-worker.ts`).
- **`ProcessPoolExecutor`** — Python/numpy/scipy (releases GIL), e.g. `nist-bridge.py`.

## Push Policy

The agent never pushes to `origin` automatically. Commit changes locally (incl. release commits + tags), then ask the user to push when a feature is complete. Do not run `git push` unless explicitly requested.

## Automatic Versioning

When a **worthy improvement** is completed and gates 1–7 are green, proactively cut a release with changesets — do **not** leave `package.json` stale.

**Worthy** = new feature/public API, completed experiment phase, bug fix, or significant results/docs addition. Trivial formatting/lint-only/comment-only changes are not worthy alone.

| Bump | When |
|---|---|
| **major** | breaking change to a public API or on-disk/sample format |
| **minor** | new feature, new public function, new baseline/experiment, or newly documented result |
| **patch** | bug fix, documentation correction, or behavior-preserving refactor |

1. `bun x changeset add` (or write `.changeset/<name>.md`) with type + one-line summary.
2. `bun run version-packages` — bumps `package.json`, consumes the changeset (CHANGELOG generation disabled via `changelog: false`).
3. Add the `CHANGELOG.md` entry for `vX.Y.Z` in **Keep a Changelog** style: Summary, Highlights (emoji), Breaking Changes, Upgrade Guide, Known Issues, Dependencies Updated. Prepend above previous release.
4. Commit the bump (`package.json`, `CHANGELOG.md`, `.changeset/`).
5. Tag locally: `git tag -a vX.Y.Z -m "genoid X.Y.Z"`.
6. **Do NOT push automatically.** Ask the user before pushing `main` + tag to `origin`.
7. Only after the user pushes, create the GitHub Release: `gh release create vX.Y.Z --title "genoid X.Y.Z" --latest --notes-file <vX.Y.Z section>`.

Example: Phase A (new baselines + 10M collision scaling + NIST on baselines) → **minor** bump to `1.2.0`.

## Pull Request / Commit Guidelines

- Commit message: concise, matches repo style; never commit secrets.
- Title format: `[component] Brief description`.
- Required checks before submission: `bun run lint`, `bun run typecheck`, `bun run test`, `bun run build`, `bun run bench-ci` (and `bun run playwright` for browser/deployable changes).
- Do not update git config, skip hooks, or force-push unless explicitly requested.
- Tags alone do not create a Release page — use `gh release create` after push.

## Security Considerations

- **Never** introduce code that exposes or logs secrets/keys. Never commit secrets or keys to the repository.
- `hash` uses `crypto.subtle` (WebCrypto) — async; Node 22+ required.
- `mr` (Math.random) is an **insecure baseline** — documented as such; do not present it as production-safe.
- Publishing/`npm publish` requires explicit user confirmation (gate 9). Releases are metadata + git tags only (no registry).
- Use full sentences for security warnings and irreversible-action confirmations (auto-clarity exception to caveman style).

## Debugging and Troubleshooting

- **`dist/` missing/stale:** always `bun run build` after editing `algo.ts`/`benchmark.ts`/`bench-core.ts`; `dist/` is gitignored.
- **Node version:** `crypto.randomUUID()` + `crypto.subtle` need Node 22+.
- **Deno CI-only:** Deno ports (`scripts/deno/*`) mirror Bun/Node for cross-runtime comparison; excluded from `oxlint` + `tsconfig.scripts.json`, import types from source.
- **Version nibble:** GenoID uses `0x8`, not `0x4`.
- **Playwright:** install browsers once (`bun x playwright install`); `verify-playwright` dry-runs with jsdom if browsers unavailable.
- **Slow CI on Node/Windows:** per-call `getRandomValues` schemes (v7, pg-uuid-v8, ulid, ulid-v8, ksuid) are slower on Node/Windows — a BCryptGenRandom backend artifact, not a GenoID defect. Pooled GenoID CSPRNG + native v4 are unaffected.

## Research Findings

| Finding | Detail |
|---|---|
| GA is cosmetic on CSPRNG | All ablation variants (raw-v8, full, xonly, monly) pass NIST. CSPRNG is sole source of quality. |
| GA cannot be assessed on weak entropy at 1.2M bits | Math.random (Xorshift128+) passes all 15 NIST tests at 1.22M bits — no failures to "rescue". 100M+ bits needed to see Xorshift128+ weaknesses. |
| GA cannot rescue controlled degradations | Across 5 degraded sources (biased, correlation, range-restricted, periodic, LCG), GA failed to fix any core structural failures. In 2 cases, GA worsened quality. |
| GA is architectural, not statistical | The GA framework's value is in v8 UUID composition (pooling, parallelism, structured data embedding). It does not improve, and occasionally degrades, statistical randomness. |
| 34B > 16B for CSPRNG samples | **Corrected by scan (`scripts/export-rank-scan.ts`, T=60 trials/size, 1M bits/trial):** `binary_matrix_rank` false-positive rate is ~1.7% and roughly *uniform* across draw sizes 16/20/24/28/32/34B. Matches expected Type II/α noise (~1% at p<0.01), NOT a draw-size effect. |

## Structured (declarative v8 layout) framework — GenoID v2 direction

GA genuinely helps UUIDs only through *composition*, not randomness. Implemented in `algo.ts` (`V8Layout`/`V8Field`, `genStructuredGenoID`, `composeStructured`, `repairConstraints`, `copyField`, `getFieldValue`, `forceVersionVariant`) and validated in `scripts/bench-structured.ts` (E1–E6) + `scripts/export-structured.ts` + `scripts/nist-bridge.py`.

| RQ | Experiment | Result |
|---|---|---|
| RQ1 composition correctness | E1: 1.5M structured-field checks | 0 mismatches, 0 constraint violations |
| RQ2 GA repair vs rejection | E2: constrained fields k=1..6 | GA repairs/UUID ≈ k (O(k·8)); rejection = 64^k trials (k=6 → 6.9e10) |
| RQ3 statistical quality | E3/E4/E5: dbkey, 2M UUIDs | 0 collisions (p=0.5 at n=2.71e18); uniformity max dev 0.0053 |
| RQ3 NIST | struct-dbkey / multitenant / eventsourcing | all 15 SP 800-22 tests PASS |
| RQ4 throughput | E6 + browser | Node: v4 7.3M/s, GenoID-structured 0.4M/s (≈19× slower). Browser (Playwright): v4 1.65M/s, GenoID-structured 0.52M/s (≈3× slower vs v4 in-browser; ≈24× slower vs base GenoID pool). Native `crypto.randomUUID` far slower in-browser, narrowing the gap. |

**Two critical bugs found and fixed:**
1. *32-bit truncation* — `getFieldValue`/`setFieldBytes` used 32-bit integer math; fields >32 bits lost high bits → catastrophic NIST bias (multitenant hit 19.6% ones). Fixed with bit-by-bit `Number` arithmetic.
2. *Single-parent population* — structured fields written to only one pooled parent while `fieldSelect` could pick either → ~50% of children inherited garbage (e.g. `tenant`=3239 instead of ≤8). Fixed by populating every structured field in **both** parents.

**Prior art:** no academic GA-for-UUID paper exists; `pg_uuid_v8` (May 2026, steganographic timestamps via XOR/AES, code-only) is closest. Contribution = declarative RFC 9562 v8 layout composition + constraint-guided mutation as repair.

## Scripts Reference

| Script | Purpose |
|---|---|
| `scripts/export-samples.ts` | Export CSPRNG samples (v4, rawv8, genoid) for NIST |
| `scripts/export-ablation.ts` | Export ablation variants (rawv8, full, xonly, monly) |
| `scripts/export-weak-entropy.ts` | Export Math.random variants |
| `scripts/export-degraded.ts` | Export 5 degraded sources × (raw + GA) for NIST |
| `scripts/export-structured.ts` | Export structured-layout samples for NIST |
| `scripts/bench-structured.ts` | E1–E6: composition, repair-vs-rejection, collision/uniformity, throughput |
| `scripts/baselines.ts` | Phase A baselines: `genPgUuidV8`, `genUlid`/`genUlidV8`, `genKsuid`, `genSnowflake` + `extractRandomBits` |
| `scripts/baselines.test.ts` | TDD unit tests for baseline generators |
| `scripts/export-baselines.ts` | Export random-payload bit streams of UUID-shaped baselines |
| `scripts/nist-bridge.py` | Full 15-test NIST SP 800-22 battery |
| `scripts/test-crypto-v8.ts` | Node.js crypto test suite adapted for v8 (4 tests) |
| `scripts/stats.ts` | In-house monobit, runs, chi-square, pairwise correlation, entropy |

### Deno ports (`scripts/deno/*`, CI-only)

| Script | Purpose |
|---|---|
| `scripts/deno/bench-ci.ts` | CI-shaped benchmark + collisions (Deno `deno-matrix`) |
| `scripts/deno/bench.ts` | Full Deno speed benchmark + Welch significance |
| `scripts/deno/bench-structured.ts` | E1–E6 structured on Deno |
| `scripts/deno/stats.ts` | NIST SP 800-22 battery |
| `scripts/deno/stats-core.ts` / `stats-worker.ts` | Per-position chi-square + correlation core / worker |
| `scripts/deno/collision-100m.ts` / `collision-100m-worker.ts` | 100M collision test fanned across cores |
| `scripts/deno/pool.ts` | CSPRNG pool (Deno `crypto.getRandomValues`) |
| `scripts/deno/deno-io.ts` | Deno `writeBitsFile`/`readBitsFile` helpers |
| `scripts/deno/export-samples.ts` / `export-ablation.ts` / `export-weak-entropy.ts` / `export-degraded.ts` / `export-structured.ts` / `export-baselines.ts` | Deno export mirrors |

## Key Constraints

- **Deno is CI-only.** Runtime is Bun (build/test/lint/typecheck/publish). Deno ports excluded from `oxlint` + `tsconfig.scripts.json`.
- Node 22+ required (`crypto.randomUUID()` and `crypto.subtle`).
- GenoID version nibble is `0x8` (not `0x4`).
- `scripts/*.ts` dynamically import compiled `dist/algo.js` directly — no shim.
- `dist/` is gitignored; rebuild after changing core modules.
- `benchmark.ts` has no module-level side effects — call `init(host?)`.
- `tsconfig.json` / `tsconfig.scripts.json` extend `tsconfig.base.json`.

## Releasing

GenoID uses [changesets](https://github.com/changesets/changesets) for version management (no npm publish — version is metadata + git tags only).

| Command | What |
|---|---|
| `bun x changeset add` | Describe a change → writes a file in `.changeset/` |
| `bun run version-packages` | Bumps `package.json`, consumes the changeset |
| `git tag -a vX.Y.Z -m "genoid X.Y.Z"` | Tag locally (skip `changeset publish`) |

Workflow: add changeset → `version-packages` → write `CHANGELOG.md` entry manually (Keep a Changelog) → commit bump → tag. `commit: false` in `.changeset/config.json`, so changesets never auto-commits.
