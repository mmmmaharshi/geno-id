# GenoID

[![CI bench](https://github.com/mmmaharhi/geno-id/actions/workflows/bench.yml/badge.svg)](https://github.com/mmmaharhi/geno-id/actions/workflows/bench.yml)

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

## Quick Start

```bash
bun install
bun run build          # compile TS to dist/
bun run bench          # full Node.js benchmark + uniformity tests
bun run bench-ci       # condensed, JSON-emitting CI-style benchmark
bun run test           # unit + verification tests (22 tests)
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
