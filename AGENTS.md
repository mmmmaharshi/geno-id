# GenoID

Novel GA-inspired UUIDv8 algorithm benchmark against v4, v7, SHA-256 hash-derived, and Math.random baselines.

## Source files

| File | Responsibility |
|---|---|
| `algo.ts` | Pure algorithm implementations (authoritative). No DOM or I/O. |
| `bench-core.ts` | Shared benchmark harness: `benchSync`, `benchAsyncBatched`, `birthdayBound50`, `collisionTest`, `collisionTestAsync`. No DOM, no I/O. |
| `benchmark.ts` | Browser benchmark runner. Imports from `algo.ts` and `bench-core.ts`. Exports `init(host?)` (call to wire up DOM + window hooks) and `runAll`, `copyToClipboard`, `copyTableToClipboard`. No module-level side effects. |
| `index.html` | Loads `dist/benchmark.js` via `<script type="module">` and calls `init()`. |
| `scripts/bench.ts` | Node.js benchmark + GenoID experimental variants (Fast v1–v3). Imports from `dist/bench-core.js` and `dist/algo.js`. |
| `scripts/stats.ts` | NIST SP 800-22 monobit, runs, chi-square, pairwise correlation. Imports from `dist/algo.js`. |
| `scripts/puppeteer.ts` | Puppeteer automation (launches Chrome, runs benchmark, scrapes results). Exports `runBenchmark` with injectable `launch` factory. |
| `scripts/puppeteer-test.ts` | Dry-run test with JSDOM mock. Calls `init()` after import (no global patching needed). |

## Running benchmarks

| Command | What | Requires |
|---|---|---|
| `bun run build` | Compile TypeScript to `dist/` | `bun install` |
| `bun run lint` | Check all `.ts` files with oxlint | `bun install` |
| `bun run lint:fix` | Auto-fix lint issues | `bun install` |
| `bun run bench` | Full Node.js benchmark + uniformity tests | `bun install` |
| `bun run test:stats` | NIST SP 800-22 monobit, runs, chi-square, pairwise correlation | `bun install` |
| `bun run puppeteer` | Automated browser benchmark via Puppeteer (see `--help`) | `bun install` |
| `bun run verify-puppeteer` | Dry-run test of Puppeteer script with jsdom | `bun install` |
| `bun run typecheck` | Typecheck all `.ts` files (root + scripts) | `bun install` |
| `open index.html` | Interactive browser benchmark | Any browser |

## Architecture

5 algorithms benchmarked in `algo.ts`:
- `v4` — `crypto.randomUUID()` (native baseline)
- `v7` — RFC 9562 UUIDv7 (48-bit timestamp + 74 random bits)
- `hash` — SHA-256 hash-derived (v5-style, async via SubtleCrypto)
- `mr` — Math.random (Xorshift128+, insecure baseline)
- `geno` — GenoID (proposed: pooled CSPRNG + byte-level GA crossover/mutation, RFC 9562 v8)

`scripts/bench.ts` contains additional GenoID variants (Fast v1–v3, pooled, buffer-reuse) used during development — the browser version only ships the final `genGenoID` implementation.

`bench-core.ts` holds the shared benchmark harness consumed by both `benchmark.ts` (browser) and `scripts/bench.ts` (Node.js).

## Agent workflow

Always follow the [`mattpocock/skills@tdd`](https://skills.sh/mattpocock/skills/tdd) discipline: any new behavior or test is written **red → green** — write the failing test first, then only enough implementation to pass it. Confirm the public seam(s) under test before writing tests; tests verify behavior through public interfaces, never implementation details.

After every change to any `.ts` file:
1. Run `/thermo-nuclear-code-quality-review` (ambitious structural simplification: kill duplication, spaghetti, oversized files, redundant layers)
2. Run `bun run lint` (check all `.ts` files with oxlint)
3. Run `bun run typecheck` (typecheck both root + scripts tsconfigs)
4. Run `bun run build` (compiles to dist/)
5. Run `bun run puppeteer` (browser/deployable check: confirm `dist/benchmark.js` + `index.html` run with `browserErrors: []`, the `GenoID-structured` entry present, and 0 collisions — i.e. deployable matches development behavior)
6. Fix any errors from the above before continuing

## Research findings

| Finding | Detail |
|---|---|
| GA is cosmetic on CSPRNG | All ablation variants (raw-v8, full, xonly, monly) pass NIST. CSPRNG is sole source of quality. |
| GA cannot be assessed on weak entropy at 1.2M bits | Math.random (Xorshift128+) passes all 15 NIST tests at 1.22M bits — no failures to "rescue". 100M+ bits needed to see Xorshift128+ weaknesses. |
| GA cannot rescue controlled degradations | Across 5 degraded sources (biased, correlation, range-restricted, periodic, LCG), GA failed to fix any core structural failures. In 2 cases, GA worsened quality. |
| GA is architectural, not statistical | The GA framework's value is in v8 UUID composition (pooling, parallelism, structured data embedding). It does not improve, and occasionally degrades, statistical randomness. |
| 34B > 16B for CSPRNG samples | raw-v8 (16B CSPRNG) occasionally shows false-positive NIST failures (1 binary_matrix_rank FAIL at p=0.001). GenoID (34B, with GA) showed none. Likely statistical, but 34B draws avoid the low end of the rank distribution. |

## Structured (declarative v8 layout) framework — GenoID v2 direction

GA genuinely helps UUIDs only through *composition*, not randomness. Implemented in `algo.ts`
(`V8Layout`/`V8Field` types, `genStructuredGenoID`, `composeStructured`, `repairConstraints`,
`copyField`, `getFieldValue`, `forceVersionVariant`) and validated in `scripts/bench-structured.ts`
(E1–E6) + `scripts/export-structured.ts` + `scripts/nist-bridge.py`.

| RQ | Experiment | Result |
|---|---|---|
| RQ1 composition correctness | E1: 1.5M structured-field checks | 0 mismatches, 0 constraint violations |
| RQ2 GA repair vs rejection | E2: constrained fields k=1..6 | GA repairs/UUID ≈ k (O(k·8)); rejection = 64^k trials (k=6 → 6.9e10) |
| RQ3 statistical quality | E3/E4/E5: dbkey, 2M UUIDs | 0 collisions (p=0.5 at n=2.71e18); uniformity max dev 0.0053 |
| RQ3 NIST | struct-dbkey / multitenant / eventsourcing | all 15 SP 800-22 tests PASS |
| RQ4 throughput | E6 + browser | Node: v4 7.3M/s, GenoID-structured 0.4M/s (≈19× slower). Browser (Chrome V8, Puppeteer): v4 1.65M/s, GenoID-structured 0.52M/s (≈3× slower vs v4 in-browser; ≈24× slower vs base GenoID pool). Native `crypto.randomUUID` is far slower in-browser, narrowing the gap; base GenoID pool stays fastest. |

**Two critical bugs found and fixed during implementation:**
1. *32-bit truncation* — `getFieldValue`/`setFieldBytes` used 32-bit integer math, so any field
   >32 bits (all random fillers: `rand_66`=62, `rand_82`=46) lost its high bits → catastrophic
   NIST bias (multitenant hit 19.6% ones). Fixed with bit-by-bit `Number` arithmetic
   (`copyField`, rewritten `setFieldBytes`/`structuredValue`); `getFieldValue` kept BigInt for
   benchmark correctness.
2. *Single-parent population* — structured fields were written to only one pooled parent while
   `fieldSelect` could pick either parent, so ~50% of children inherited unpopulated CSPRNG garbage
   (e.g. `tenant`=3239 instead of ≤8). Fixed by populating every structured field in **both**
   parents (each independently generated) so field-boundary crossover always yields a valid value.

**Prior art:** no academic GA-for-UUID paper exists; `pg_uuid_v8` (May 2026, steganographic
timestamps via XOR/AES, code-only, no framework) is the closest. Contribution = declarative
RFC 9562 v8 layout composition + constraint-guided mutation as repair.

## Scripts reference

| Script | Purpose |
|---|---|
| `scripts/export-samples.ts` | Export CSPRNG sample files (v4, rawv8, genoid) for NIST |
| `scripts/export-ablation.ts` | Export CSPRNG ablation variants (rawv8, full, xonly, monly) |
| `scripts/export-weak-entropy.ts` | Export Math.random variants (mr-raw, mr-genoid, mr-xonly, mr-monly) |
| `scripts/export-degraded.ts` | Export 5 controlled-entropy degraded sources × (raw + GA) for NIST rescue testing |
| `scripts/export-structured.ts` | Export structured-layout samples (dbkey, multitenant, eventsourcing) for NIST |
| `scripts/bench-structured.ts` | E1–E6: composition, repair-vs-rejection, collision/uniformity, throughput |
| `scripts/nist-bridge.py` | Run full 15-test NIST SP 800-22 battery on all sample files |
| `scripts/test-crypto-v8.ts` | Node.js crypto test suite adapted for v8 (4 tests) |
| `scripts/stats.ts` | In-house monobit, runs, chi-square, pairwise correlation, entropy |
| `scripts/bench.ts` | Speed benchmark, collision test, uniformity validation |

## Key constraints

- Node 22+ required (`crypto.randomUUID()` and `crypto.subtle`).
- GenoID version nibble is `0x8` (RFC 9562 custom/experimental), not `0x4`.
- `scripts/*.ts` dynamically imports the compiled `dist/algo.js` directly — no shim needed.
- `dist/` is gitignored; run `bun run build` after changing `algo.ts`, `benchmark.ts`, or `bench-core.ts`.
- `benchmark.ts` has no module-level side effects — call `init(host?)` to wire up DOM and window hooks.
- `index.html` loads `dist/benchmark.js` via `<script type="module">` and calls `init()`.
- `tsconfig.json` extends `tsconfig.base.json`. `tsconfig.scripts.json` extends the same base for script typechecking.
