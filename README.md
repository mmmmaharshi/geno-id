# GenoID

[![CI bench](https://github.com/mmmmaharshi/geno-id/actions/workflows/bench.yml/badge.svg)](https://github.com/mmmmaharshi/geno-id/actions/workflows/bench.yml)
[![Release](https://img.shields.io/github/v/release/mmmmaharshi/geno-id)](https://github.com/mmmmaharshi/geno-id/releases)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

Declarative RFC 9562 v8 UUID composition framework. Embed structure (shard, tenant, counter, timestamp) in an ID without rejection sampling.

## 1. Problem

Standard generators give no composition mechanism:
- v4 — fully random, opaque.
- v7 — one fixed timestamp layout.
- hash-derived — order-dependent, slow.

Forcing structure naively (rejection sample until field lands in allowed set) costs **64^k trials** (k=6 → 6.9×10¹⁰). Exponential. Unusable.

## 2. Build a GenoID (how it works)

Declare a layout (`V8Layout` / `V8Field`): which bits are timestamp, shard from allowed set, monotonic counter, tenant, or random CSPRNG. Then:

1. Generate **two pooled parent UUIDs** — every structured field independently populated in both.
2. Combine via **field-boundary crossover** — each child field inherited from one parent.
3. Apply **constraint-guided mutation** (`repairConstraints`) — fix any field violating allowed/min/max/monotonic in **O(field length)**. No rejection.

Output: valid v8 UUID carrying your structure, CSPRNG-grade randomness in remaining bits.

Win: repair is **linear (≈k·8 ops)** vs naive **64^k rejection**. 1.5M structured-field checks → **0 mismatches, 0 constraint violations**.

## 3. Proof it works

| Experiment | Result | Win |
|---|---|---|
| Composition correctness (E1) | 1.5M field checks | 0 mismatches, 0 violations |
| Repair beats rejection (E2) | GA repairs/UUID ≈ k | linear O(k·8) vs 64^k trials |
| Collision + uniformity (E3–E5) | 2M UUIDs | 0 collisions (50%-bound n ≈ 2.7×10¹⁸); max dev 0.0053 |
| NIST SP 800-22 | dbkey, multitenant, eventsourcing | all 15 tests PASS |
| Throughput (E6 + browser) | structured ≈0.53M/s | ~3× slower than native `crypto.randomUUID` in-browser; base GenoID pool 7.5× faster than native v4 (browser: Chromium/Firefox/WebKit via Playwright, see Task E) |

## 4. Baseline comparison

Compared against pg_uuid_v8 (closest prior art), ULID / KSUID / Snowflake (broader landscape), and native v4 / v7. Every baseline verified by known-answer + structural tests (`scripts/baselines-verify.test.ts`) plus NIST + collision checks.

Throughput = **mean of 10 trials** with sample std dev and **95% CI** (`benchRepeated` in `bench-core.ts`). CI table below = Linux x64 mean; run locally for your machine's numbers.

| Generator | Type | Throughput (ops/s) | 2M collisions | 10M collisions | NIST (payload) |
|---|---|---:|---:|---:|---|
| v4 (`crypto.randomUUID`) | Random (baseline) | 11.34M | 0 | 0 | — |
| v7 (custom) | RFC 9562 timestamp | 3.98M | 0 | 0 | — |
| GenoID (pooled v8) | GA-inspired v8 | 7.72M | 0 | 0 | — |
| GenoID-structured (dbkey) | Declarative v8 layout | 0.7M | 0 | 0 | 15/15 PASS |
| pg_uuid_v8 | Steganographic v4 (closest prior art) | 0.94M | 0 | 0 | 15/15 PASS |
| ULID-v8 | Timestamped v8 (UUID-mapped) | 1.01M | 0 | 0 | 15/15 PASS |
| ULID | 26-char Crockford base32 | 0.50M | 0 | n/a | n/a |
| KSUID | 27-char base62 | 0.34M | 0 | n/a | n/a |
| Snowflake | 64-bit integer | 3.06M | 0 | n/a | n/a |

`n/a` = not applicable / not measured: ULID, KSUID, Snowflake are non-UUID-shaped (base32/base62 string, 64-bit int) so a whole-UUID NIST payload test is invalid and a 10M hex-BigInt collision pass does not apply; their 2M collision is exact (string Set). NIST payload (15/15) was run only on the UUID-shaped structured baselines (pg_uuid_v8, ULID-v8, GenoID-structured); v4/v7/GenoID-pooled are fully/partially random or timestamped where payload-only monobit is the relevant check (see §4).

Key findings:
- **Collision safety holds at scale** — v4, GenoID, pg_uuid_v8, ULID-v8 all 0 collisions in 10M (exact BigInt check).
- **Statistical quality preserved** — random payload bits of pg_uuid_v8 and ULID-v8 pass all 15 NIST SP 800-22 (payload-only monobit; whole-UUID histograms invalid for timestamped IDs).
- **Throughput order** — v4 ≈ GenoID (pooled) > v7 > Snowflake > ULID-v8 > pg_uuid_v8 > ULID > KSUID. GenoID-structured slower (per-field composition) but production-viable.

Reproduce: run `bun run bench` → full ±std, 95% CI, Welch t-test (`compareBench`) with Cohen's d. Difference stated significant or not — not from single-run point estimate.

## 5. Tasks (validated claims)

### Task A: Multi-environment validation
Single-machine doubt? Full benchmark runs every push via GitHub Actions matrix:
- **OS:** ubuntu, macos, windows.
- **Runtimes:** Bun (all OS) + Node 20/22/23 (Linux).
- Each job emits env metadata (CPU, arch, runtime, memory), ops/sec table, collision PASS/FAIL.

Do: open **Actions** tab → a run → **Artifacts**. Inspect `ci-consolidated` (one wide table, all envs side-by-side + `dist/all-results.json`) or per-job (`bench-ci-results.json` + `ci-summary.md`). All envs report 0 collisions.

Local mirror (same logic CI runs per environment): `bun run bench-ci` produces `dist/bench-ci-results.json` and `dist/ci-summary.md` on your machine — run it before pushing to confirm 0 collisions without waiting on the matrix. The CI matrix still adds OS/Node-version breadth that a single local run cannot replicate.

### Task B: Concurrent generation
GenoID is pure, stateless over process-global CSPRNG pool — safe to fan out across threads, no coordination. `scripts/bench-concurrent.ts` spawns N `worker_threads`, each M UUIDs, verifies globally:
- **0 cross-worker collisions** (plain GenoID, 3×50k).
- **0 collisions + 0 constraint violations** (structured `concurrent-dbkey`, 4×50k) — `tenant` enum (0..7) survives fan-out; repair thread-safe.

Do: `bun run bench-concurrent` (override `CONCURRENT_WORKERS`, `CONCURRENT_PER_WORKER`, `CONCURRENT_MODE`).

### Task C: B-tree index benchmark
Sortable IDs keep PK B-tree friendly. `scripts/bench-sqlite.ts` bulk-inserts 100k IDs each (v4, GenoID v8, v7, GenoID-structured `dbkey`, ULID-v8) into fresh in-memory SQLite (`TEXT PRIMARY KEY`); reports insert throughput + B-tree compactness (`page_count`, `freelist_count`, `bytes/row`):
- **All types clean B-tree** (`integrity_check = ok`, `freelist_count = 0`).
- **Page count order-independent** — SQLite packs leaf pages same density random or time-sorted; depth depends on N + key size, not insertion order. Sortable (v7, ULID-v8) match/exceed random insert throughput **while preserving insertion-time order** for range scans.

Do: `bun run bench-sqlite` (override `SQLITE_N`).

### Task D: 100M collision test
`collisionTest` keeps every ID in `Set<string>` — cannot hold 100M. `scripts/collision-100m.ts` replaces with exact dedup on compact open-addressing **128-bit hash set** (two 64-bit slots in `BigUint64Array` — ~2.3 GB for 100M vs ~10 GB), fanned across **every CPU core** via `worker_threads`:
- **All generators 0 collisions** at 100M (v4, GenoID v8, v7, GenoID-structured, ULID-v8) — far below 122-bit birthday bound ~2.7×10¹⁸.
- **All cores used** — per-worker dedup; cross-worker uniqueness from independent per-worker CSPRNG pools (proven Task B).
- Memory split per worker (~68 MB/worker at 10M on 6-core vs 272 MB single-threaded); throughput scales with cores.

Do: `bun run collision-100m` (override `COLLISION_N`; `COLLISION_SYNC=1` for single-threaded).

### Task E: Cross-engine browser validation
`scripts/playwright.ts` runs the in-browser benchmark across **all three engines** — Chromium (V8), Firefox (SpiderMonkey), WebKit (JavaScriptCore) — so deployable behaviour is checked beyond a single JS engine:
- **Each engine asserts** `browserErrors: []`, the `GenoID-structured` entry present, and **0 collisions** — all three PASS.
- Repo is served over local HTTP (Firefox/WebKit block ES-module loading over `file://`); `runAll()` is triggered via a scheduled macrotask so the synchronous benchmark loop does not stall the automation.

Do: `bun run playwright` (all engines) or `bun run playwright --browser=firefox`; `bun x playwright install` first.

## 6. Security analysis

"Security class" labels backed by formal argument in [`sources/security-analysis.md`](sources/security-analysis.md): per-field entropy accounting (random bits only count; timestamp/counter/shard observable), explicit adversarial model (passive observer, state compromise, structure inference), comparison vs RFC 9562 §8.

Verified facts:
1. **GenoID v8 rests on OS CSPRNG** — every pool refill calls `crypto.getRandomValues`; 122-bit min-entropy matches v4.
2. **Pool forward-secrecy caveat** — pool refills every **256** UUIDs; process-memory adversary predicts at most 256 future UUIDs per refill.
3. **Structured layouts leak metadata by design** (timestamp ±1 ms, shard, counter, tenant) — distinguishable from random, not a confidentiality primitive. Consistent with RFC 9562 §8.2 warning on v7-style timestamps.

## 7. Literature & formal docs

Read for depth:
- [`sources/related-work.md`](sources/related-work.md) — literature review + novelty: **no prior work applies GA-style operators to UUID/identifier generation** (re-verified 2024–2026 + patent prior art, July 2026 adversarial recheck §7).
- [`sources/formal-proofs.md`](sources/formal-proofs.md) — O(k) repair bound vs O(64^k) rejection; entropy-preservation proof for crossover on `random`-type fields.
- [`sources/threats-to-validity.md`](sources/threats-to-validity.md) — internal/external/construct/conclusion validity + mitigations + residual risk.
- [`sources/reproducibility.md`](sources/reproducibility.md) — one-command reproduction table, env pinning, artifact statement (open item: archival DOI not yet minted).

Extended randomness battery (dieharder, 100M-bit samples/generator): `bun run dieharder`. Rationale in `sources/reproducibility.md` §3.

## 8. Install & use

Published on npm as **`@maharshi/genoid`** (scoped; the unscoped `genoid` name is blocked by npm's similarity rule against `nanoid`).

**Requirements:** Node ≥ 22, ESM `import` (the package is ESM-only, no `require` build). No runtime dependencies — everything uses the built-in `crypto`. Types are bundled.

```bash
npm i @maharshi/genoid        # or: bun add / pnpm add / yarn add
```

```ts
import {
  genGenoID,
  genStructuredGenoID,
  completeLayout,
  type Layout,
} from "@maharshi/genoid"

// Simple GenoID (v8 UUID)
console.log(genGenoID())

// Declarative structured v8 layout
const dbkey: Layout = completeLayout("dbkey", [
  { name: "timestamp", start: 0, length: 48, type: "timestamp-ms" },
  { name: "shard", start: 52, length: 8, type: "shard", constraint: { allowed: [1, 2, 3, 4, 5] } },
  { name: "counter", start: 66, length: 16, type: "counter", constraint: { monotonic: true } },
])
console.log(genStructuredGenoID(dbkey))
```

`genHashUUID()` is async (uses `crypto.subtle`); all other exports are sync.

## 9. Quick start

1. `bun install` — deps (~10s).
2. `bun run build` — compile TS to dist/ (~2s).
3. `bun run bench` — full Node.js benchmark + uniformity (~30s).
4. `bun run bench-ci` — condensed JSON-emitting CI-style benchmark.
5. `bun run bench-concurrent` — Task B concurrent generation.
6. `bun run bench-sqlite` — Task C SQLite B-tree benchmark.
7. `bun run collision-100m` — Task D 100M batched collision (all cores).
8. `bun run test` — unit + verification tests (41 tests).
9. `bun run test:stats` — NIST SP 800-22 monobit / runs / chi-square.
10. `bun run playwright` — headless-browser benchmark across Chromium/Firefox/WebKit (`bun x playwright install` first).

Browser UI: open `index.html` (loads `dist/benchmark.js`).

## 9. Applications

IDs both unique *and* self-describing. Use for:
1. **Sharded DB / partition keys** — embed shard ID in PK; router locates node direct, no lookup table.
2. **Multi-tenant systems** — carry tenant ID for prefix isolation + row-level security, no extra indexed column.
3. **Event sourcing / audit logs** — monotonic counter + timestamp → globally ordered, collision-free event IDs, no central sequencer.
4. **Sortable time-series IDs** — timestamp bits give chronological order (like v7) + composable with shard/tenant/counter.
5. **Debuggability** — declared fields readable from bits; operators read shard/tenant/sequence instead of opaque random string.
