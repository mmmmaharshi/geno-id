# GenoID

[![CI bench](https://github.com/mmmmaharshi/geno-id/actions/workflows/bench.yml/badge.svg)](https://github.com/mmmmaharshi/geno-id/actions/workflows/bench.yml)
[![Release](https://img.shields.io/github/v/release/mmmmaharshi/geno-id)](https://github.com/mmmmaharshi/geno-id/releases)

## Problem Statement
UUIDs are opaque random blobs. Applications often need structure embedded in an
ID — a shard, a tenant, a monotonic counter, a timestamp — but standard
generators give no composition mechanism: v4 is fully random, v7 bakes in one
fixed timestamp layout, and hash-derived UUIDs are order-dependent and slow.
Worse, forcing structure the naive way (rejection sampling until a field lands
in an allowed set) becomes exponentially expensive as constraints accumulate.

## Proposed Approach
GenoID is a declarative RFC 9562 v8 UUID composition framework. You declare a
layout (`V8Layout` / `V8Field`): which bits are a timestamp, a shard from an
allowed set, a monotonic counter, a tenant, or random CSPRNG. GenoID then:
- generates two pooled parent UUIDs, each with every structured field
  independently populated;
- combines them with **field-boundary crossover** (each child field inherited
  from one parent);
- applies **constraint-guided mutation** (`repairConstraints`) to fix any field
  that violates its allowed / min / max / monotonic rule in O(field length) —
  no rejection sampling.

The output is a valid v8 UUID that carries your structure while keeping
CSPRNG-grade randomness in the remaining bits.

## Evaluation

### GenoID structured framework

| Experiment | Result |
|---|---|
| Composition correctness (E1) | 1.5M structured-field checks → 0 mismatches, 0 constraint violations |
| Repair beats rejection (E2) | GA repairs/UUID ≈ k (linear, O(k·8) ops); naive rejection needs 64^k trials (k=6 → 6.9×10¹⁰) |
| Collision + uniformity safety (E3–E5) | 0 collisions in 2M UUIDs (50%-collision n ≈ 2.7×10¹⁸); uniformity max deviation 0.0053 |
| Statistical quality (NIST SP 800-22) | all 15 tests PASS for the dbkey, multitenant, and eventsourcing layouts |
| Practical throughput (E6 + browser) | ≈0.53M structured UUIDs/s; ~3× slower than native `crypto.randomUUID` in-browser (base GenoID pool 7.5× faster than native v4) |

### Phase A — baseline comparison

GenoID is compared against four structured-ID baselines (pg_uuid_v8 is the
closest prior art; ULID / KSUID / Snowflake are the broader landscape) and the
native v4 / v7 generators. Every baseline is verified by known-answer and
structural tests (`scripts/baselines-verify.test.ts`) in addition to NIST and
collision checks.

Representative throughput below is from a Linux x64 CI run; absolute values
vary by machine and runtime (see CI artifacts for per-environment numbers).

| Generator | Type | Throughput (ops/s) | 2M collisions | 10M collisions | NIST (payload) |
|---|---|---:|---:|---:|---|
| v4 (`crypto.randomUUID`) | Random (baseline) | 7.9M | 0 | 0 | — |
| v7 (custom) | RFC 9562 timestamp | 2.6M | 0 | — | — |
| GenoID (pooled v8) | GA-inspired v8 | 6.5M | 0 | 0 | — |
| GenoID-structured (dbkey) | Declarative v8 layout | 0.7M | 0 | — | 15/15 PASS |
| pg_uuid_v8 | Steganographic v4 (closest prior art) | 0.8M | 0 | 0 | 15/15 PASS |
| ULID-v8 | Timestamped v8 (UUID-mapped) | 1.0M | 0 | 0 | 15/15 PASS |
| ULID | 26-char Crockford base32 | 0.4M | 0 | — | — |
| KSUID | 27-char base62 | 0.3M | 0 | — | — |
| Snowflake | 64-bit integer | 2.6M | 0 | — | — |

Key findings:
- **Collision safety holds at scale** — v4, GenoID, pg_uuid_v8, and ULID-v8
  all report 0 collisions in 10M UUIDs (exact BigInt check).
- **Statistical quality is preserved** — the random payload bits of pg_uuid_v8
  and ULID-v8 pass all 15 NIST SP 800-22 tests (whole-UUID histograms are
  invalid for timestamped IDs, so payload-only monobit is used).
- **Throughput ordering** — v4 ≈ GenoID (pooled) > Snowflake ≈ v7 > ULID-v8 >
  pg_uuid_v8 > ULID > KSUID; GenoID-structured is slower due to per-field
  composition but still production-viable.

### Multi-environment validation

To address single-machine validation concerns, the full benchmark runs on
every push via a GitHub Actions matrix:

- **Operating systems:** ubuntu, macos, windows
- **Runtimes:** Bun (all OSes) + Node 20 / 22 / 23 (Linux)
- Each job emits environment metadata (CPU, arch, runtime, memory), an ops/sec
  table, and a collision PASS/FAIL result.

Results are uploaded per job as downloadable artifacts (`bench-ci-results.json`
+ a rendered `ci-summary.md`). All environments report 0 collisions. Open the
**Actions** tab → a run → **Artifacts** to inspect per-environment numbers.

### Concurrent generation (Task B)

GenoID is a pure, stateless function over the process-global CSPRNG pool, so it is
safe to fan out across threads without coordination. `scripts/bench-concurrent.ts`
spawns N `worker_threads`, each generating M UUIDs, then verifies globally:

- **0 cross-worker collisions** (plain GenoID, 3×50k across workers)
- **0 collisions and 0 structured-field constraint violations** (structured
  `concurrent-dbkey` layout, 4×50k across workers) — the `tenant` enum
  (allowed `0..7`) survives fan-out, confirming constraint repair is thread-safe.

Run it with `bun run bench-concurrent` (override `CONCURRENT_WORKERS`,
`CONCURRENT_PER_WORKER`, `CONCURRENT_MODE`).

### B-tree index benchmark (Task C)

Structured, sortable IDs keep the primary-key B-tree index-friendly. `scripts/bench-sqlite.ts`
bulk-inserts 100k IDs of each kind (v4, GenoID v8, v7, GenoID-structured `dbkey`,
ULID-v8) into a fresh in-memory SQLite table (`TEXT PRIMARY KEY`) and reports insert
throughput plus B-tree compactness (`page_count`, `freelist_count`, `bytes/row`):

- **All ID types produce a clean, unfragmented B-tree** (`integrity_check = ok`,
  `freelist_count = 0`).
- **Page count is order-independent** — SQLite packs leaf pages to the same density
  regardless of whether keys are random or time-sorted, so B-tree depth depends on N
  and key size, not insertion order. Sortable IDs (v7, ULID-v8) match or exceed random
  IDs on insert throughput **while preserving insertion-time order** for efficient
  time/tenant/shard range scans.

Run it with `bun run bench-sqlite` (override `SQLITE_N`).

### Collision at scale (Task D)

The shared `collisionTest` keeps every ID in a `Set<string>`, which cannot hold
100M entries in memory. `scripts/collision-100m.ts` replaces it with an exact dedup
built on a compact open-addressing **128-bit hash set** (each UUID stored as two
64-bit slots in a `BigUint64Array` — ~2.3 GB for 100M IDs instead of ~10 GB), and
fans the work out across **every CPU core** with `worker_threads` so the 100M run
stays fast:

- **All generators report 0 collisions** at 100M (v4, GenoID v8, v7, GenoID-structured,
  ULID-v8) — far below the 122-bit birthday bound of ~2.7×10¹⁸ IDs.
- **All cores used** — each worker dedups its own partition; cross-worker uniqueness
  follows from independent per-worker CSPRNG pools (proven in Task B).
- Memory is split per worker (≈ 68 MB/worker at 10M on a 6-core machine vs 272 MB
  single-threaded), and throughput scales with core count.

Run it with `bun run collision-100m` (override `COLLISION_N`; `COLLISION_SYNC=1`
for the single-threaded path).

## Literature & related work

A full literature review and novelty assessment — UUID standards, sortable/structured
IDs, steganographic v8, genetic/evolutionary computation, and CSPRNG pooling — is in
[`sources/related-work.md`](sources/related-work.md). It confirms the gap GenoID
fills: **no prior work applies GA-style operators to UUID/identifier generation**.

## Quick Start

```bash
bun install
bun run build          # compile TS to dist/
bun run bench          # full Node.js benchmark + uniformity tests
bun run bench-ci       # condensed, JSON-emitting CI-style benchmark
bun run bench-concurrent  # Task B: concurrent generation across worker_threads
bun run bench-sqlite    # Task C: SQLite B-tree index benchmark
bun run collision-100m  # Task D: 100M-scale batched collision (all cores)
bun run test           # unit + verification tests (29 tests)
bun run test:stats     # NIST SP 800-22 monobit / runs / chi-square
bun run puppeteer      # headless-browser benchmark (requires Chrome)
```

The browser UI is served by opening `index.html` (it loads `dist/benchmark.js`).

## Applications
The framework targets systems that need IDs to be both unique *and*
self-describing:
- **Sharded databases / partition keys** — embed the shard ID in the primary
  key so a router can locate the node directly from the ID, with no lookup
  table.
- **Multi-tenant systems** — carry the tenant ID in the UUID for prefix-based
  isolation and row-level security without an extra indexed column.
- **Event sourcing / audit logs** — a monotonic counter plus timestamp yields
  globally ordered, collision-free event IDs with no central sequencer.
- **Sortable time-series IDs** — timestamp bits give natural chronological
  ordering (like v7) while remaining composable with shard/tenant/counter fields.
- **Debuggability** — because fields are declared, an ID is self-describing:
  operators can read shard, tenant, and sequence straight from the bits instead
  of treating it as an opaque random string.
