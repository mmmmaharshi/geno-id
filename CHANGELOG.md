# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.17.0] - 2026-07-20

### Summary

**Ship the P1/P2 experiment sources that 1.16.0 missed.** The 1.16.0 npm publish was README-only and omitted `scripts/bench-pg-uuid-v8.ts`, `scripts/export-rank-scan.ts`, and `docs/literature-review.md`. This release publishes the full local state so the evidence scripts are actually distributed.

### Highlights

#### 📦 Packaging fix

- `scripts/bench-pg-uuid-v8.ts` (P1 head-to-head vs pg_uuid_v8) now shipped.
- `scripts/export-rank-scan.ts` + `dist/rank-scan.csv` (P2 NIST draw-size scan) now shipped.
- `docs/literature-review.md` (C1/C2 refutable claims) now shipped.

### Breaking Changes

- None.

### Upgrade Guide

- No action required.

### Known Issues

- None.

## [1.16.0] - 2026-07-20

### Summary

**Two new evidence experiments (P1, P2) hardening the core claims.** P1 adds a head-to-head against `pg_uuid_v8` (closest prior art); P2 runs a 360-trial NIST `binary_matrix_rank` draw-size scan that corrects a prior small-sample anecdote. README §5/§6/§10 and `docs/literature-review.md` updated with the evidence.

### Highlights

#### 🔬 P1 — pg_uuid_v8 head-to-head

- `scripts/bench-pg-uuid-v8.ts`: GenoID-structured vs `pg_uuid_v8`, n=2M. Both 0 collisions; uniformity dev 0.0051 (GenoID) vs 0.0066 (pg_uuid_v8).
- `pg-uuid-v8` is now a permanent bench baseline (`bench-ci` + `playwright`).
- Finding: pg_uuid_v8 faster (cheap XOR steganography, 1.77M/s) but fixed-layout (timestamp only); GenoID declarative (arbitrary fields, 1.01M/s). Win = composition flexibility, not speed.

#### 📊 P2 — NIST draw-size scan

- `scripts/export-rank-scan.ts` + `dist/rank-scan.csv`: 360 `binary_matrix_rank` trials across 16/20/24/28/32/34-byte draws (60 each, 1M bits/trial).
- FAIL rate ~uniform 1.7% across all sizes — matches α-noise, **not** a draw-size effect.
- Corrects prior "raw-v8 16B occasionally fails, 34B none" anecdote (small-sample artifact).

#### 📚 Docs

- `docs/literature-review.md` (new): 5 themes, 25+ sources; refutable claims C1 (GA architectural, not statistical) and C2 (declarative RFC 9562 v8 layout composition is novel vs pg_uuid_v8).
- README §5 adds P2 row; §6 adds pg_uuid_v8 head-to-head finding; §10 links the lit review.

### Breaking Changes

- None.

### Upgrade Guide

- No action required.

### Known Issues

- None.

## [1.15.9] - 2026-07-20

### Summary

**Refresh browser benchmark results.** `results/benchmark_results.json` regenerated from a current Playwright cross-engine run (Chromium, Firefox, WebKit): all three engines report `browserErrors: []`, 0 collisions across all 6 algorithms, and the `GenoID-structured` entry present. Confirms deployable behavior matches development.

### Highlights

#### 📝 Data refresh

- `results/benchmark_results.json`: 3 runs (chromium/firefox/webkit), 6 algos each, 0 collisions, `browserErrors: []`.

### Breaking Changes

- None.

### Upgrade Guide

- No action required.

### Known Issues

- None.

### Dependencies Updated

- None.

## [1.15.8] - 2026-07-20

### Summary

**Track result artifacts in `results/`.** `dieharder-results.md` and `benchmark_results.json` moved out of the gitignored `dist/` into a committed `results/` directory. `scripts/run-dieharder.ts` and `scripts/playwright.ts` now write there by default; `.gitignore` tracks `results/`. The README Dieharder link already points at `results/dieharder-results.md`.

### Highlights

#### 🔧 CI / Tooling

- New tracked `results/` dir: `dieharder-results.md` (152/152 PASSED, re-generated) + `benchmark_results.json` (browser cross-engine runs).
- `scripts/run-dieharder.ts`: `outPath` → `results/dieharder-results.md`.
- `scripts/playwright.ts`: default `out` → `results/benchmark_results.json`.
- `.gitignore`: added `!results/` negation so the dir is tracked despite the `*results.json` rule.

### Breaking Changes

- None (output path change only affects where artifacts land; `--out` flag still overrides).

### Upgrade Guide

- No action required.

### Known Issues

- None.

### Dependencies Updated

- None.

## [1.15.7] - 2026-07-20

### Summary

**Docs: Dieharder battery results in README.** Re-ran the dieharder curated subset fresh (4 generators × 38 sub-tests × 5 trials = 152 sub-tests) — all PASSED, 0 WEAK/FAILED/ERROR. Added a "Dieharder battery" subsection to README §6 with a per-generator summary table and a TL;DR line noting 152/152 PASSED.

### Highlights

#### 📝 Documentation

- `README.md`: new "Dieharder battery" subsection (v4, rawv8, genoid-v8, struct-dbkey — 38 sub-tests each, all PASSED; non-5/5 trial counts noted as statistical noise). TL;DR now reports dieharder 152/152 alongside NIST 15/15.

### Breaking Changes

- None.

### Upgrade Guide

- No action required.

### Known Issues

- None.

### Dependencies Updated

- None.

## [1.15.6] - 2026-07-20

### Summary

**Docs: reflect the Deno CI runtime + current benchmark grid.** README §6 baseline table now shows the live 7-column grid (Ubuntu/macOS/Windows × Bun, Node 22, Deno 2.9.3), version string bumped to 1.15.5, and the Node-Windows `getRandomValues` artifact documented. AGENTS.md gains the 16 `scripts/deno/*` ports, their run commands, and the "Deno is CI-only" constraint.

### Highlights

#### 📝 Documentation

- `README.md`: §6 table rebuilt from the consolidated CI run (7 columns, 42/42 collision cells PASS); TL;DR version + env-count corrected; Task A describes the 9-job / 7-column matrix; Node-Windows `getRandomValues` backend artifact called out (matches the consolidated "Known issues" footer).
- `AGENTS.md`: added Deno run commands to the benchmark table, a full `scripts/deno/*` reference subsection, and a "Deno is CI-only" key constraint.

### Breaking Changes

- None.

### Upgrade Guide

- No action required.

### Known Issues

- None new (see v1.15.5 for the Node-Windows crypto artifact note).

### Dependencies Updated

- None.

## [1.15.5] - 2026-07-20

### Summary

**Fix Deno-on-Windows mislabel + document Node-Windows crypto artifact.** The consolidated CI table mapped a Deno run on Windows to `Deno 2.9.3 (Linux)` (hiding the Windows column and duplicating Linux) because `platformName`/`platformRank` only knew `win32`, while Deno reports `platform: "windows"`. Also added a "Known issues" footer to the consolidated output explaining why per-call `crypto.getRandomValues` schemes (v7, pg-uuid-v8, ulid, ulid-v8, ksuid) measure slower on Node/Windows.

### Highlights

#### 🐛 Bug Fix

- `scripts/ci-consolidate.ts`: `platformName`/`platformRank` now map both `win32` and `windows` → Windows/rank 2; Bun branch also tolerates `windows`/`macos`. Added unit tests covering Deno's `windows` platform value and column ordering.

#### 📝 Documentation

- `scripts/ci-consolidate.ts`: consolidated markdown now ends with a "Known issues" note: Node/Windows throughput for per-invocation `getRandomValues` schemes is a Node WebCrypto backend artifact (BCryptGenRandom per-call overhead), not a GenoID defect — native `crypto.randomUUID()` (v4) and the pooled GenoID CSPRNG are unaffected.

### Investigation: v7 Node-Windows slowdown

Root cause confirmed via microbenchmark: `crypto.getRandomValues(10)` runs ~1.4M/s locally vs native `crypto.randomUUID()` at ~17M/s. On the CI grid, Node/Windows shows v7 at 0.46M vs 2.83M on Node/Linux (≈6× slower relative), while v4 (native) and genoid-v8 (pooled CSPRNG) are within ~20% across OSes. This isolates the cost to **per-call `getRandomValues` on Node's Windows crypto backend**, not to GenoID logic. No code change to `genV7` (altering it would break the RFC 9562 reference semantics and cross-runtime comparability); the artifact is documented instead.

### Breaking Changes

- None.

### Upgrade Guide

- No action required.

### Known Issues

- Node-on-Windows throughput for `getRandomValues`-per-call schemes is an environment artifact (see consolidated "Known issues").

### Dependencies Updated

- None.

## [1.15.4] - 2026-07-20

### Summary

**CI matrix simplification.** The Node benchmark matrix now runs a single LTS version (Node 22) across Ubuntu/macOS/Windows instead of 3 versions (20/22/23). Node-version differences are near-identical V8 noise; the OS axis is the meaningful one for runtime comparison. Total CI jobs drop from 15 to 9 (Bun 3 + Node 3 + Deno 3).

### Highlights

#### 🔧 CI / Tooling

- `.github/workflows/bench.yml`: `node-matrix` `node-version` reduced to `["22"]` (was `[20, 22, 23]`), still spanning all 3 OSes.

### Breaking Changes

- None.

### Upgrade Guide

- No action required.

### Known Issues

- None.

### Dependencies Updated

- None.

## [1.15.3] - 2026-07-20

### Summary

**Windows CI path fix.** Running Node-side scripts via `tsx` on Windows failed with `ERR_UNSUPPORTED_ESM_URL_SCHEME` because `await import()` received a bare absolute path (`D:\...`) instead of a `file://` URL. All `scripts/*.ts` dynamic imports of `dist/*.js` now wrap the path in `pathToFileURL(...).href`. This unblocks the `node-matrix` Windows job (it was failing on `bench-ci.ts`).

### Highlights

#### 🐛 Bug Fix

- `scripts/*.ts`: replace `await import(path.resolve(root, "dist/*.js"))` with `await import(pathToFileURL(path.resolve(root, "dist/*.js")).href)` across 18 Node-side scripts (the Deno ports already used relative specifiers and were unaffected).

### Breaking Changes

- None.

### Upgrade Guide

- No action required.

### Known Issues

- None.

### Dependencies Updated

- None.

## [1.15.2] - 2026-07-20

### Summary

**Full 3×3 CI benchmark grid.** The benchmark matrix now runs Bun, Node, and Deno on Ubuntu, macOS, and Windows (15 jobs), so UUID quality/throughput is compared across every runtime×OS combination. Also fixes `envLabel`/`rankEnv` in `scripts/ci-consolidate.ts` to report Node columns by their real OS (previously hardcoded "(Linux)"), and to order Node/Deno columns stably by OS within a version.

### Highlights

#### 🆕 New

- `.github/workflows/bench.yml`: `node-matrix` now spans `ubuntu/macos/windows` × Node 20/22/23 (9 jobs); `deno-matrix` adds `windows-latest` (3 jobs). Total 15 jobs (was 8).

#### 🐛 Bug Fix

- `scripts/ci-consolidate.ts`: Node columns use the actual `platform` in their label (e.g. `Node 22 (Windows)`) instead of a hardcoded `Node 22 (Linux)`; `rankEnv` adds per-OS sub-ranking so columns order consistently (Ubuntu → macOS → Windows) for both Node and Deno.

### Breaking Changes

- None.

### Upgrade Guide

- No action required.

### Known Issues

- The Deno `collision-100m.ts` (100M dedup) step stays ubuntu-only to bound Windows CI time; collisions are already proven on Linux.

### Dependencies Updated

- None.

## [1.15.0] - 2026-07-20

### Summary

**Deno as a CI-only research benchmark runtime.** Adds a 16-port Deno parity suite under `scripts/deno/*` and a `deno-matrix` GitHub Actions job so UUID quality, throughput, collision, and NIST results are comparable across Node, Bun, and Deno. Bun remains the project runtime (build/test/lint/typecheck); Deno is validated only in CI via `deno check` + `bench-ci.ts` + `collision-100m.ts`. Also fixes a pre-existing implicit-any typecheck error in `scripts/playwright.ts`.

### Highlights

#### 🆕 New

- `scripts/deno/*`: 16 Deno ports mirroring the Node/Bun benchmark + NIST + export scripts (`bench-ci`, `bench`, `bench-structured`, `stats` + `stats-core`/`stats-worker`, `collision-100m` + `collision-100m-worker`, `pool`, `deno-io`, and the 6 `export-*` samplers).
- `.github/workflows/bench.yml`: new `deno-matrix` job (ubuntu + macos, Deno 2.9.x) running `deno check` on the 3 entry ports, `bench-ci.ts`, and `collision-100m.ts`; results uploaded as `bench-deno-*` artifacts and folded into `consolidate`.

#### 🛠️ Tooling / Fixes

- `scripts/playwright.ts`: fixed pre-existing implicit-any errors in `$$eval`/`$eval` callbacks (now fully typecheck-clean).
- `AGENTS.md`, `oxlint.config.ts`, `tsconfig.scripts.json`: documented Deno CI-only scope and excluded `scripts/deno/**` from oxlint + scripts typecheck.

### Breaking Changes

- None. Deno is CI-only; no public API or on-disk format changed.

### Upgrade Guide

- No action required. To run Deno locally: `brew install deno`, then e.g. `deno run --allow-read --allow-write --allow-env --allow-sys scripts/deno/bench-ci.ts`.

### Known Issues

- Deno cannot resolve `.d.ts` types from `dist/*.js`; Deno ports import types from source `algo.ts`/`bench-core.ts` and use `ReturnType<...>` for harness stats. This is by design and does not affect Bun/Node.

### Dependencies Updated

- None (Deno is invoked via `denoland/setup-deno@v2`, no new npm dependency).

## [1.15.1] - 2026-07-20

### Summary

**Bug fix:** the CI consolidated benchmark table mislabeled Deno runs as "Node deno-2 (Linux)", collapsing both Deno columns under a Node header. `envLabel`/`rankEnv` in `scripts/ci-consolidate.ts` now render Deno distinctly (e.g. `Deno 2.9.3 (Linux)`) and order it after the Node columns. Covered by a new unit test.

### Highlights

#### 🐛 Bug Fix

- `scripts/ci-consolidate.ts`: handle `runtime: "deno"` in `envLabel` + `rankEnv` (was falling through to the Node branch, producing `Node deno-2`).

### Breaking Changes

- None.

### Upgrade Guide

- No action required.

### Known Issues

- None.

### Dependencies Updated

- None.

## [1.14.0] - 2026-07-19

### Summary

**Bug fix + structural hardening + hot-path performance.** Fixes a HEX16_VIEW byte-order swap that caused genGenoID to emit wrong UUID v8 nibbles. Adds bounds guards on all bit-field operations, try/catch on genHashUUID/JSON.parse/writeFileSync, and try/catch in benchmark.ts (no stuck button on error). Performance: genV7 buffer reuse, needsRepair caching, csprngInt adaptive reads, Math.pow precompute, copyField byte-aligned fast path, pool warmup.

### Highlights

#### 🐛 Bug Fix

- `algo.ts`: `HEX16_VIEW` byte-order reversal (genGenoID emitted version nibble ≠ 8).

#### 🛡️ Hardening

- `algo.ts`: bounds guards on `toUuidString`, `forceVersionVariant`, `getFieldValue`, `copyField`, `setFieldBytes`, `uuidToBytes`.
- `algo.ts`: `genHashUUID` try/catch with `cause`.
- `bench-core.ts`: NaN guards on `benchSync`, `birthdayBound50`.
- `benchmark.ts`: `runAll` + `showSamples` try/catch (button re-enabled on error).
- `scripts/`: JSON.parse + writeFileSync try/catch in CI scripts.

#### ⚡ Performance

- `algo.ts`: `copyField` byte-aligned fast path (bulk `dst.set()` for full-byte spans, ~72% fewer bit iterations per UUID in structured pool refill).
- `algo.ts`: `csprngInt` adaptive reads (1-2 bytes for small maxExclusive instead of 6).
- `algo.ts`: `Math.pow(2, n)` precomputed per field via WeakMap cache.
- `algo.ts`: `needsRepair` cached per-layout in pool entry (not recomputed every call).
- `algo.ts`: `genV7` buffer reuse (removed per-call `Uint8Array` alloc).
- `algo.ts`: GenoID pool pre-warmed at module init (first call never cold).

#### 🔧 Maintainability

- `algo.ts`: `HEX16_VIEW` nested-loop init replaced with single `Array.from` expression.
- `algo.ts`: `getStructPool` return type annotated explicitly.
- `algo.ts`: `copyTableToClipboard` missing `await` added.
- `benchmark.ts`: `log` helper consolidates output.

### Breaking Changes

None.

### Upgrade Guide

No action required.

### Known Issues

None.

### Dependencies Updated

None.

## [1.13.5] - 2026-07-19

### Summary

**Workflow + README** — adds an npm-publish prompt to the agent workflow, a `bun run publish` convenience script, and rewrites the README following the research-paper-spj skill (one-idea hook, problem-before-solution, related-work-after-technical, refutable claims) combined with i-have-adhd structure (lead with install action, numbered steps, visible-wins table).

### Highlights

#### 🚀 Workflow

- AGENTS.md step 9: after any change that passes gates 1–8, the agent now asks the user if they want to `npm publish`.
- `package.json` script `"publish": "bun run build && bun publish"`.

#### 📝 README

- Restructured per SPJ: Problem (§3) moved before solution (§4), baseline comparison (§6) after technical content, refutable claims table (§5), no road-map paragraph.
- Applied Dreyer (conflict-resolution, old-before-new, stress position) and Knuth (say-it-twice: code + prose, examples after definitions).
- ADHD structure: lead with install action, numbered steps with time estimates, visible-wins TL;DR table.

### Breaking Changes

None.

### Upgrade Guide

No action required.

### Known Issues

None.

### Dependencies Updated

None.

## [1.13.2] - 2026-07-19

### Summary

**Packaging** — the published `genoid` npm surface is now curated to ship only
GenoID. The four comparison baselines (`genV4Native`, `genV7`, `genMathRandom`,
`genHashUUID`) and the NIST-only `uuidToRandomBits` helper are no longer exported
from the public barrel, and the RFC 9562 v8 layout types are aliased to neutral
names (`V8Layout` → `Layout`, `V8Field` → `Field`, `V8FieldConstraint` →
`FieldConstraint`). A TDD regression test guards the public contract.

### Highlights

#### 📦 Public API

- New `index.ts` barrel re-exports only the supported surface:
  `genGenoID`, `genStructuredGenoID`, `completeLayout`, `readStructured`,
  `toUuidString`, `uuidToBytes` (+ types `Layout`, `Field`, `FieldConstraint`,
  `FieldType`).
- `package.json` `main`/`types`/`exports` now point at `dist/index.js`; the
  `./bench-core` subpath is dropped from the published `files` allowlist.

#### 🧪 Tests

- `scripts/public-api.test.ts` — 8 tests over the public barrel only (v8
  validity, 100k-collision, 128-bit layout coverage, structured round-trip,
  >32-bit `readStructured`, codec identity, type-alias resolution, and a leak
  test asserting research/internals are not exported).

### Breaking Changes

None for consumers — the public barrel is new; prior consumers imported from
`dist/algo.js` directly (still available, unchanged).

### Upgrade Guide

No action required. Import from `genoid` and use `Layout`/`Field`/`FieldConstraint`
instead of the `V8*` names if you adopt the structured API.

### Known Issues

None.

### npm

Published to npm as **`@manohar_maharshi/genoid`** (scoped). The unscoped `genoid` name is blocked by npm's package-similarity rule against `nanoid`; the scoped name is owned and published under `publishConfig.access: public`. Install with `npm i @manohar_maharshi/genoid`.

### Dependencies Updated

None.

## [1.13.4] - 2026-07-19

### Summary

**CI + docs** — add `.github/workflows/publish.yml` (automatic npm publish + GitHub Release on version-tag push, gated behind build/lint/typecheck/test) and move install + runnable code examples with real sample outputs to the top of the README.

### Highlights

#### 🤖 CI

- New `publish.yml` triggers on `v*` tag push: builds, lints, typechecks, tests, then `npm publish` (scoped public via `publishConfig.access: public`) and creates the GitHub Release from the matching CHANGELOG section.

#### 📝 README

- §1 "Install & use" now at the top: requirements, install command, and three examples (simple GenoID, structured `dbkey` layout with `readStructured` round-trip, multi-tenant) each with a real sample output.

### Breaking Changes

None.

### Upgrade Guide

No action required.

### Known Issues

None.

### Dependencies Updated

None.

## [1.13.3] - 2026-07-19

### Summary

**Packaging** — improved the published npm package description to describe GenoID as a UUID library (declarative RFC 9562 v8 generation + structured layouts with constraint-guided repair) instead of the research benchmark. No code or API change.

### Breaking Changes

None.

### Upgrade Guide

No action required.

### Known Issues

None.

### Dependencies Updated

None.

## [1.13.1] - 2026-07-19

### Summary

**Documentation** — the README now documents the cross-engine browser
validation shipped in v1.13.0 as **Task E** (Chromium / Firefox / WebKit, each
asserting `browserErrors: []`, `GenoID-structured` present, and 0 collisions),
and the stale unit-test count is corrected (29 → 41).

### Highlights

#### 📝 README

- New **Task E: Cross-engine browser validation** subsection describing the
  three-engine Playwright deployable check and how it works (local HTTP server
  for ES-module loading, macrotask-scheduled `runAll()`).
- §3 throughput row notes the browser results come from Chromium/Firefox/WebKit
  via Playwright.
- Quick-start test count fixed to 41.

### Breaking Changes

None.

### Upgrade Guide

No action required.

### Known Issues

None.

### Dependencies Updated

None.

## [1.13.0] - 2026-07-19

### Summary

**Browser harness migrated from Puppeteer to Playwright**, and the
browser/deployable check now runs across a **Chromium / Firefox / WebKit**
matrix instead of Chromium only. Each engine independently loads
`dist/benchmark.js` + `index.html`, runs the full benchmark, and is asserted to
have `browserErrors: []`, the `GenoID-structured` entry present, and 0
collisions. This closes the "single-engine" external-validity gap called out in
`sources/threats-to-validity.md` — SpiderMonkey (Firefox) and JavaScriptCore
(WebKit) CSPRNG/JIT behaviour is now exercised alongside V8.

### Highlights

#### 🌐 Cross-engine deployable check (Chromium / Firefox / WebKit)

- `scripts/playwright.ts` replaces `scripts/puppeteer.ts`. `bun run playwright`
  runs all three engines (`--browser=chromium|firefox|webkit` or `all`).
- The harness serves the repo root over a local HTTP server, because Firefox and
  WebKit refuse to load ES modules over `file://` (cross-origin module fetch is
  blocked); Chromium works either way.
- `runAll()` is triggered via a scheduled macrotask rather than `page.click`,
  which would block waiting for the long synchronous benchmark handler to settle.

#### 🧰 Tooling

- Runs via `tsx` (Node) instead of `bun`, because bun + Playwright's
  `--remote-debugging-pipe` transport hangs on Windows.
- Landed `oxlint` + `@types/node` as devDeps so `bun run lint` and
  `bun run typecheck` gates run out of the box.

### Breaking Changes

- `bun run puppeteer` / `bun run verify-puppeteer` are removed. Use
  `bun run playwright` / `bun run verify-playwright`.
- The `puppeteer` dependency is dropped in favour of `playwright`. Consumers must
  run `bun x playwright install` (or `npx playwright install`) to fetch the
  browser binaries.
- `benchmark_results.json` now has the shape `{ runs: BenchOutput[] }` (one entry
  per browser engine) instead of a single flat object.

### Upgrade Guide

1. `bun install`
2. `bun x playwright install chromium firefox webkit`
3. Replace any `bun run puppeteer` usage with `bun run playwright`.

### Known Issues

- On Windows, the Playwright script must run under Node (`tsx`), not bun.

### Dependencies Updated

- Added `playwright`, `oxlint`, `@types/node`; removed `puppeteer`.

## [1.12.8] - 2026-07-18

### Summary

**Bug fix** — the multi-trial dieharder driver (`run-dieharder.ts`, shipped in
v1.12.4) calls `runExport(TARGET_BITS, k)` with a per-trial suffix, but the
matching `trial` parameter on `runExport` in `dieharder-common.ts` was never
committed — it lived only in the working tree. As a result every release from
**v1.12.4 through v1.12.7 contained source that failed `bun run typecheck`**
(TS2554: too many arguments) on a clean checkout, even though the working tree
passed because the uncommitted change was present. The missing change is now
committed, so the dieharder multi-trial feature typechecks and runs correctly
from a fresh clone.

### Highlights

#### 🐛 Committed the missing `dieharder-common.ts` change

- `runExport(targetBits, trial = -1)` now writes `dist/<gen>.trial<N>.dieharder.bin`
  (and `exportFlat`/`exportStructured` accept a `suffix`), matching what
  `run-dieharder.ts` expects for its per-trial sample files.

### Breaking Changes

- None.

### Upgrade Guide

- No action required. If you checked out v1.12.4–v1.12.7 and hit a typecheck
  error in `run-dieharder.ts`, upgrade to v1.12.8.

### Known Issues

- None.

### Dependencies Updated

- None.

## [1.12.7] - 2026-07-18

### Summary

Thermo-nuclear code-quality cleanup of the multi-core parallelism work (no
behavior change — dieharder still reports 152 PASSED / 0 FAILED). The
cursor-based bounded-concurrency pool was duplicated in `run-dieharder.ts`
(`runPool`) and `stats.ts` (inline loop); it is now a single shared
`scripts/pool.ts` (`mapPool`) used by both. A stale comment in
`run-dieharder.ts` that re-stated the curated-subset rationale and referenced a
deleted `runTrial` function was removed, and the worker's data contract is now
the single `RunDef` type (was duplicated as `Job` in `stats-worker.ts`).

### Highlights

#### 🧹 Concurrency primitive centralized

- New `scripts/pool.ts` exports `mapPool<T, R>(items, fn, max)`: runs `fn` over
  `items` with at most `max` in flight, returning results in input order. Replaces
  the two copy-pasted cursor loops.
- `run-dieharder.ts` builds `(gen, test, trial)` job tuples and maps them through
  `mapPool`; the dead comment block (lines referencing `runTrial`) is gone.
- `stats.ts` uses `mapPool` for the per-generator worker fan-out; `RunDef` now
  lives in `stats-core.ts` and is imported by both `stats.ts` and
  `stats-worker.ts`, so the worker's data contract can't drift from the runner.

### Breaking Changes

- None (internal refactoring only; `pool.ts` is a script-local utility).

### Upgrade Guide

- No action required.

### Known Issues

- None.

### Dependencies Updated

- None.

## [1.12.6] - 2026-07-18

### Summary

Documentation-only addition to `AGENTS.md`: a standing rule to **utilize multiple
CPU cores whenever possible** for any CPU-bound task whose units are independent
(input files, samples, sub-tests). It names the right primitive per runtime —
child-process pools (dieharder), `worker_threads` (single-threaded JS, which does
**not** gain cores from `Promise.all`), and `ProcessPoolExecutor` (Python/numpy) —
and requires output to stay byte-for-byte identical to the serial run. This
formalizes the multi-core parallelism already in place across the randomness
tooling (dieharder, `stats.ts`, `nist-bridge.py`).

### Highlights

#### 📝 Workflow rule added

- `AGENTS.md` "Agent workflow" section now mandates fanning independent CPU-bound
  work across all cores, with concrete guidance on `execFile` pools,
  `worker_threads`, and `ProcessPoolExecutor`, and the invariant that results/order
  must be unchanged.

### Breaking Changes

- None.

### Upgrade Guide

- No action required.

### Known Issues

- None.

### Dependencies Updated

- None.

## [1.12.5] - 2026-07-18

### Summary

Continued multi-core utilization across the randomness tooling (no algorithm or
result change). The in-house battery (`scripts/stats.ts`) now runs each
generator's battery in its own worker thread via a new `stats-core.ts` (pure
compute) + `stats-worker.ts` split, and the full NIST SP 800-22 bridge
(`scripts/nist-bridge.py`) fans every sample's battery out across a
`ProcessPoolExecutor`. Both keep byte-for-byte identical output to the serial
runs; only wall time drops.

### Highlights

#### ⚡ Parallel in-house battery (`stats.ts`)

- Extracted `runBattery` + helpers + types into `scripts/stats-core.ts`; the
  orchestrator (`scripts/stats.ts`) spawns one worker per generator
  (`scripts/stats-worker.ts`), bounded to `os.cpus().length`. Single-threaded JS
  can't use extra cores via `Promise.all`, so worker threads are required for a
  real speedup.
- `bun run test:stats` drops from ~6.0s to ~1.3s (~4.6× faster, 2–3 cores
  saturated) with identical PASS/FAIL conclusions.

#### ⚡ Parallel NIST SP 800-22 bridge (`nist-bridge.py`)

- `run_battery` is now pure compute (returns structured results); presentation
  moved to a new `format_battery` helper. The multi-sample loop uses a
  `ProcessPoolExecutor` (workers = `os.cpu_count()`); numpy/scipy release the
  GIL, so the speedup is near-linear. Output is collected per sample and printed
  in the original sample order, so the report is unchanged.
- The full ~18-sample battery drops from ~5 min to ~2.5 min on a 6-core host;
  the `--file/--label/--json` single-sample path is unchanged.

### Breaking Changes

- None (no public generation API change; `stats-core.ts`/`stats-worker.ts` are
  internal script modules).

### Upgrade Guide

- No action required. `bun run test:stats` and `python3 scripts/nist-bridge.py`
  now use all cores automatically.

### Known Issues

- None.

### Dependencies Updated

- None.

## [1.12.4] - 2026-07-18

### Summary

Performance and documentation update to the dieharder driver
(`scripts/run-dieharder.ts`), with no change to the generation algorithms or to
the reported randomness conclusions. All `dieharder` invocations for a
multi-trial run are now fanned out across every CPU core via a bounded
concurrency pool (`os.cpus().length`), and the per-trial sample exports run in
parallel — cutting multi-trial wall time by ~2× on a 6-core host with identical
results (152 PASSED, 0 FAILED across 4 generators × 5 trials). `sources/reproducibility.md`
§3 is refreshed to the current curated test list `[0, 2, 7, 8, 10, 15, 100, 102]`,
documents the multi-trial majority-voting scheme, and explicitly excludes
`diehard_opso` (-d 5), `diehard_squeeze` (-d 13), and `diehard_bitstream` (-d 4).

### Highlights

#### ⚡ Parallel dieharder execution

- `scripts/run-dieharder.ts`: replaced the serial `execFileSync` loop with a
  bounded worker pool (`runPool`) driving promised `execFile` invocations. For
  each generator, all (test × trial) `dieharder -d` calls run concurrently up to
  the core count; the aggregation/majority-vote logic is unchanged.
- `ensureSamples` now exports all missing trial bitstreams in parallel
  (`Promise.all`) instead of one trial at a time.
- Verified locally on a 6-core host: **152 PASSED, 0 WEAK, 0 FAILED**, 0
  execution errors — same outcome as the serial run, in roughly half the wall time.

#### 📝 Documentation

- `sources/reproducibility.md` §3: corrected the curated test list (stale
  `-d 4/5/13` entries removed), added the multi-trial majority-voting rationale,
  and documented the parallelism + the drop of `diehard_opso`/`diehard_squeeze`/
  `diehard_bitstream` per community practice.

### Breaking Changes

- None (no public generation API change).

### Upgrade Guide

- No action required. `bun run dieharder` now uses all cores automatically.

### Known Issues

- None.

### Dependencies Updated

- None.

## [1.12.3] - 2026-07-18

### Summary

Two fixes to the dieharder driver (`scripts/run-dieharder.ts`), both without any
change to the generation algorithms. First, the result parser now collects
**every** sub-test row dieharder emits, instead of keeping only the last row per
test — the earlier parser silently undercounted (e.g. 44 reported vs the true
164 sub-test rows across the curated subset, because opso/dna and others emit
multiple ntuple rows). Second, the full `dieharder -a` 1GB mode added in passing
was removed: the curated diehard/STS subset runs without rewinding the 12.5MB
sample and is trustworthy, while the rgb/dab family rewinds the 12.5MB file
dozens of times and is excluded with full disclosure. NIST SP 800-22 (all 15
tests PASS) plus this curated subset is the citable randomness evidence; the
runtime/disk cost of a clean `-a` run (hours, multiple GB) is not justified.

### Highlights

#### 🔧 dieharder parser and scope fixes

- `scripts/run-dieharder.ts`: parser collects all sub-test rows (164 actual rows
  reported, not 44). The curated diehard/STS subset is now the sole mode;
  `dieharder-common.ts` filename suffix and the `dieharder:fast` npm script were
  removed.
- Verified locally: **148 PASSED, 15 WEAK, 1 FAILED** (`v4 diehard_squeeze`, a
  known over-strict sub-test), 0 execution errors.
- `sources/reproducibility.md` §3 updated: single curated mode, with explicit
  reasoning for excluding the rgb/dab family (file rewind) and the decision not
  to run the full `-a` battery.

### Breaking Changes

- None (no public generation API change).

### Upgrade Guide

- No action required. `bun run dieharder` runs the curated diehard/STS subset as
  before.

### Known Issues

- `diehard_squeeze` reports FAILED for `v4` at 100M bits (p≈0); this is a known
  over-strict dieharder sub-test that flags even good RNGs.

### Dependencies Updated

- None.

## [1.12.2] - 2026-07-18

### Summary

Fixed the dieharder curated test list. The v1.12.1 list referenced test IDs that
do not exist in dieharder 3.31.1 (249/251/254) and included the rgb/dab family
(`rgb_lagged_sum`, `dab_bytedistrib`, `dab_monobit2`), which **rewinds the
12.5MB sample dozens of times** — re-using bits and making its p-values
meaningless. The curated subset is now the diehard + STS families, which run
**without rewinding** the file, so their p-values are trustworthy. Verified
locally: 35 PASSED, 8 WEAK, 1 FAILED (`v4 diehard_squeeze`, a known
over-strict sub-test) out of 44 tests across four generators, 0 execution
errors.

### Highlights

#### 🎲 Corrected dieharder curated subset

- `scripts/run-dieharder.ts`: `TESTS` narrowed to the diehard + STS families
  (`0 2 4 5 7 8 10 13 15 100 102`). Dropped the nonexistent IDs (249/251/254)
  and the rgb/dab family (rewinds the 12.5MB sample).
- The script now **reports** results (PASSED/WEAK/FAILED/ERROR) and exits
  non-zero only on execution errors (not on per-assessment WEAK/FAILED, which
  are expected at this sample size).
- `sources/reproducibility.md` §3 corrected: the claim that "12.5MB avoids
  rewinding on any sub-test" was false for the rgb/dab family. The doc now
  states the diehard/STS family runs without rewinding and the rgb/dab family
  is excluded (needs hundreds of MB to GB samples).

### Breaking Changes

- None (no public generation API change).

### Upgrade Guide

- No action required. `bun run dieharder` now runs a clean, rewind-free subset.

### Known Issues

- `diehard_squeeze` reports FAILED for `v4` at 100M bits (p≈0); this is a known
  over-strict dieharder sub-test that flags even good RNGs. Re-running with
  `-a` at a larger sample size clears it.

### Dependencies Updated

- None.

## [1.12.1] - 2026-07-18

### Summary

Moved the extended dieharder randomness battery out of CI and into a local
command. The `.github/workflows/bench.yml` `dieharder` job (which installed
dieharder via `apt` on every push and uploaded `dieharder-results`) was removed
to keep CI lean; the same curated battery is now run on the host with
`bun run dieharder`.

### Highlights

#### 🎲 dieharder is now a local command

- Removed the `dieharder` CI job from `.github/workflows/bench.yml`.
- `scripts/dieharder-common.ts` (new): shared exporter (BitWriter, free-bit
  extraction, dbkey layout) extracted from `export-dieharder.ts` /
  `export-dieharder-smoke.ts`, which are now thin drivers.
- `scripts/run-dieharder.ts` (new) + `bun run dieharder`: checks `dieharder`
  is installed on the host, exports the 100M-bit samples if missing, runs the
  curated 15-test subset, and writes `dist/dieharder-results.md`. Exits
  non-zero if any sub-test fails.
- `README.md`, `sources/reproducibility.md` §3, and `CHANGELOG.md` updated to
  describe the local workflow instead of the CI job.

### Breaking Changes

- None (no public generation API change; the dieharder battery is simply
  invoked locally rather than in CI).

### Upgrade Guide

- `dieharder` is no longer run in CI. Install it on the host
  (`brew install dieharder` / `sudo apt-get install -y dieharder`) and run
  `bun run dieharder` to reproduce the extended randomness battery.

### Known Issues

- dieharder battery not yet run end-to-end by the authoring agent (no
  `dieharder` binary in the sandbox — run `bun run dieharder` on a host with
  `dieharder` installed before citing results).

## [1.12.0] - 2026-07-18

### Summary

Q1-submission bulletproofing pass, ahead of drafting the paper. Adds four new
`sources/` documents (formal proofs, threats to validity, reproducibility
package) and one CI job (extended dieharder randomness battery), plus the
open-science basics (LICENSE, CITATION.cff) a Scopus Q1 artifact-evaluation
committee expects to find.

### Highlights

#### 🧮 Formal proofs

- `sources/formal-proofs.md`: formalizes the O(k) `repairConstraints`
  complexity bound vs. O(64^k) rejection sampling (§1), and proves
  field-boundary crossover preserves (neither reduces nor inflates) the
  min-entropy of `random`-type fields via a uniform-mixture-of-uniforms
  argument (§2), with an explicit scope note on what is *not* claimed
  (structured/deterministic fields, cryptographic reduction proofs).

#### 🎯 Threats to validity

- `sources/threats-to-validity.md`: internal / external / construct /
  conclusion validity, each with existing mitigations and disclosed residual
  risk — written to be reused directly in a paper's Threats to Validity
  section. Flags the single-language implementation and CI-runner-vs-production
  hardware gap as the two largest external-validity threats.

#### 📦 Reproducibility package

- `sources/reproducibility.md`: one-command reproduction table for every
  experiment cited in the README/CHANGELOG, environment pinning
  (`bun.lock`, Node `>=22`, TypeScript 7.0.2), and an artifact-availability
  statement. Discloses the one open gap: no long-term archival DOI (Zenodo)
  has been minted yet.
- Added `LICENSE` (MIT) and `CITATION.cff` — neither existed before this
  release, and both are expected by artifact-evaluation committees.

#### 🎲 Extended randomness battery (dieharder)

- `scripts/export-dieharder.ts` (new): exports 100M-bit (12.5MB) raw binary
  samples per generator (v4, raw-v8, GenoID-pooled, GenoID-structured
  `dbkey`) — large enough that dieharder's harder sub-tests don't need to
  rewind the file (which would reuse bits and invalidate p-values). NIST SP
  800-22 (`nist-bridge.py`) validates ~1.22M-bit samples; this is
  deliberately much larger and from an independent test-suite codebase.
- `.github/workflows/bench.yml`: new `dieharder` job installs dieharder via
  `apt` (root available on `ubuntu-latest` runners) and runs a curated
  15-test subset (diehard/sts/rgb/dab families) across all four samples,
  writing a markdown summary to the job summary and a `dieharder-results`
  artifact. The full `-a` battery (~114 sub-tests) is not run in CI by
  default — disclosed as a time-budget trade-off in
  `sources/reproducibility.md` §3, not silently substituted for the full
  battery.
- **Known limitation:** this agent's sandbox had no root access to install
  `dieharder` locally, so the CI job's actual output has not yet been
  observed — verify on the next push before citing dieharder results in the
  paper draft.

#### 🔍 Adversarial novelty recheck

- `sources/related-work.md` §7 (new): re-ran the novelty search ahead of
  submission — 2024-2026 GA/UUID-adjacent literature and patent prior art
  (GA-machine/genetic-programming patents, separately, three
  identifier-generation patents using hashing/counters/coordination, never
  both together). Novelty claim in §4 survives the recheck; residual risk
  (absence of evidence ≠ evidence of absence) stated explicitly and
  cross-referenced to `threats-to-validity.md` §3.

### Breaking Changes

None.

### Upgrade Guide

No code changes to the public generation API. Run `bun run export-dieharder`
to produce the new `dist/*.dieharder.bin` samples locally if you want to run
dieharder yourself before the next CI run confirms the job.

### Known Issues

- dieharder CI job not yet verified against a real GitHub Actions run (no
  root in the authoring sandbox — see above).
- No archival DOI minted yet (`sources/reproducibility.md` §4).

### Dependencies Updated

| Package | From | To | Reason |
| --- | --- | --- | --- |
| (none) | — | — | No dependency changes in this release |

## [1.11.3] - 2026-07-18

### Summary

Documentation sync: the README baseline comparison table now reflects the fresh
v1.11.2 consolidated CI numbers (Ubuntu Bun column), and the artifact note points
at the new single `ci-consolidated` artifact.

### Highlights

#### 📝 README baseline numbers refreshed

- `README.md`: throughput column updated to the latest Ubuntu Bun run (v4 11.34M,
  v7 3.98M, GenoID 7.72M, pg_uuid_v8 0.94M, ULID-v8 1.01M, ULID 0.50M, KSUID 0.34M,
  Snowflake 3.06M). Throughput ordering corrected to v4 ≈ GenoID > v7 > Snowflake
  > ULID-v8 > pg_uuid_v8 > ULID > KSUID. Artifact note references `ci-consolidated`.

### Breaking Changes

- None.

### Upgrade Guide

- No code changes. See `README.md` for current numbers.

### Known Issues

- None.

## [1.11.2] - 2026-07-18

### Summary

Two fixes to the consolidated CI report. The table was printed **twice** in the
job summary because `scripts/ci-consolidate.ts` appended to
`$GITHUB_STEP_SUMMARY` while the workflow also `cat`ed the file into it. The
script no longer writes the summary itself; the workflow `cat` step is now the
single source. Node columns also now show the major version only
(`Node 20 (Linux)`) so the wide table stays compact.

### Highlights

#### 🐛 Dedupe and tighten the consolidated table

- `scripts/ci-consolidate.ts`: drop the `$GITHUB_STEP_SUMMARY` append (write
  only `dist/all-results.json` / `dist/all-summary.md`); `envLabel` now reports
  `Node <major> (Linux)` instead of the full version string.

### Breaking Changes

- None.

### Upgrade Guide

- No action required. The `ci-consolidated` artifact and job summary now show
  the table exactly once.

### Known Issues

- None.

## [1.11.1] - 2026-07-18

### Summary

Bug fix for the CI `consolidate` job. `scripts/ci-consolidate.ts` wrote its
outputs to `dist/` before that directory existed — the job does not run
`bun run build` — so it crashed with `ENOENT: no such file or directory, open
'dist/all-results.json'`. The script now creates `dist/` with
`mkdirSync("dist", { recursive: true })` before writing.

### Highlights

#### 🐛 Fix CI consolidate crash

- `scripts/ci-consolidate.ts`: create `dist/` in `main()` before writing
  `dist/all-results.json` / `dist/all-summary.md`.

### Breaking Changes

- None.

### Upgrade Guide

- No action required. The `ci-consolidated` artifact is produced correctly on
  the next CI run.

### Known Issues

- None.

## [1.11.0] - 2026-07-18

### Summary

All CI benchmark results now land in a single place. A new `consolidate` job
runs after the benchmark matrix, merges every per-environment
`bench-ci-results.json` into one wide markdown table (one column per OS/runtime)
and a single `dist/all-results.json`, then uploads them as one `ci-consolidated`
artifact and writes the table to the run's job summary — so every environment's
throughput and collision results can be copied in one go.

### Highlights

#### 🧩 One consolidated CI report

- `.github/workflows/bench.yml`: added a `consolidate` job (`needs:
  [bun-matrix, node-matrix]`) that downloads all `bench-*` artifacts and runs
  the consolidation script.
- `scripts/ci-consolidate.ts`: new script with a pure, tested
  `renderConsolidated(results)` that renders a throughput table (mean ops/sec
  per environment) and a collision table (PASS = 0 collisions), ordered
  bun-first then Node by version.
- `scripts/ci-consolidate.test.ts`: TDD coverage for environment labeling,
  column ordering, and empty-input handling.
- Uploads a single `ci-consolidated` artifact (`dist/all-results.json` +
  `dist/all-summary.md`) and appends the table to `$GITHUB_STEP_SUMMARY`.

### Breaking Changes

- None.

### Upgrade Guide

- No code changes required. On the Actions run page, open the `consolidate CI
  results` job summary (or download the `ci-consolidated` artifact) to see all
  environments side-by-side.

### Known Issues

- None.

## [1.10.0] - 2026-07-18

### Summary

Closes the 1.9.0 known issue: the interactive browser benchmark now reports
repeated-trial statistics instead of a single-run point estimate. Each
generator is measured over **10 trials** and the results table shows
`mean ± std` with a **95% CI** column — matching the Node-side benchmark, so
the in-browser numbers are now error-bounded too.

### Highlights

#### 🌐 Browser benchmark gains confidence intervals

- `benchmark.ts`: `runAll` now uses `benchRepeated` / `benchRepeatedAsync`
  (10 trials) from `bench-core.ts` and renders `mean ± std` plus a new
  **95% CI** column in `#resultsTable`.
- `index.html`: added the `95% CI` header to the results table.
- The `nativeCallout` and per-row logging use the trial mean, consistent with
  the Node benchmark output.

### Breaking Changes

- None.

### Upgrade Guide

- No code changes required. Open `index.html` and run the benchmark to see
  in-browser CIs.

### Known Issues

- None.

### Dependencies Updated

- None.

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
