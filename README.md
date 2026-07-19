# GenoID

[![CI bench](https://github.com/mmmmaharshi/geno-id/actions/workflows/bench.yml/badge.svg)](https://github.com/mmmmaharshi/geno-id/actions/workflows/bench.yml)
[![Release](https://img.shields.io/github/v/release/mmmmaharshi/geno-id)](https://github.com/mmmmaharshi/geno-id/releases)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

Declarative RFC 9562 v8 UUID composition framework — embed structure (shard, tenant, counter, timestamp) in an ID without rejection sampling.

**One idea:** Standard UUID generators (v4, v7, hash) cannot embed application structure. Forcing it via rejection costs 64^k trials. GenoID replaces rejection with GA-inspired crossover + constraint-guided repair: **O(k·8) per ID** — 1.5M structured-field checks → 0 mismatches, 0 violations.

## TL;DR

| Fact | Value |
|---|---|
| Published | `@manohar_maharshi/genoid@1.13.4` on npm |
| Collisions | 0 at 100M (v4, GenoID, v7, ULID-v8) |
| NIST SP 800-22 | 15/15 PASS (dbkey, multitenant, eventsourcing) |
| Throughput | GenoID-pooled 5.72–15.47M/s (6‑env CI); structured ~0.5M/s |

## 1. Install

Node ≥ 22, ESM-only, zero runtime deps.

```bash
npm i @manohar_maharshi/genoid
```


## 2. Quick start

### Simple GenoID (v8 UUID)

```ts
import { genGenoID } from "@manohar_maharshi/genoid"
console.log(genGenoID())
// → c550c9b2-e2b0-8d8c-93b9-58c2b9379970
```

The `8` in `-8d8c-` is the RFC 9562 v8 version nibble.

### Structured dbkey layout

```ts
import { genStructuredGenoID, completeLayout, readStructured, type Layout } from "@manohar_maharshi/genoid"

const dbkey: Layout = completeLayout("dbkey", [
  { name: "timestamp", start: 0, length: 48, type: "timestamp-ms" },
  { name: "shard", start: 52, length: 8, type: "shard", constraint: { allowed: [1, 2, 3, 4, 5] } },
  { name: "counter", start: 66, length: 16, type: "counter", constraint: { monotonic: true } },
])

const uuid = genStructuredGenoID(dbkey)
console.log(uuid)

console.log(readStructured(uuid, dbkey))
```

```
019f7aaf-3299-8017-8000-6a76e5d8a0f2
{ "timestamp": 1784469729945, "shard": 1, "counter": 1, "rand_60": 7, "rand_82": 46690150686962 }
```

`shard ∈ {1..5}`, `counter` monotonic — guaranteed by repair, not rejection.

### Multi-tenant variant

```ts
const multitenant = completeLayout("multitenant", [
  { name: "tenant", start: 0, length: 12, type: "shard", constraint: { allowed: [1, 2, 3, 4, 5, 6, 7, 8] } },
  { name: "region", start: 52, length: 8, type: "shard", constraint: { allowed: [1, 2, 3, 4] } },
])
console.log(genStructuredGenoID(multitenant))
// → 0024c64c-bcd1-8045-82a2-815be75fbefa
```

## 3. Problem

Standard generators give no composition:

- **v4** — fully random, opaque.
- **v7** — one fixed timestamp layout.
- **hash-derived** — order-dependent, slow.

Naive solution: rejection-sample until a field lands in the allowed set. Cost: **64^k trials** (k=6 → 6.9×10¹⁰). Exponential and impractical.

## 4. How it works

Declare a layout — which bits are timestamp, shard from allowed set, monotonic counter, tenant, or CSPRNG filler.

1. **Generate two pooled parent UUIDs** — every structured field independently populated in both.
2. **Field-boundary crossover** — each child field inherited from one parent.
3. **Constraint-guided mutation** (`repairConstraints`) — fix any violating field in **O(field length)**. No rejection.

Output: valid v8 UUID carrying your structure, CSPRNG randomness in remaining bits.

## 5. Proof it works

| Experiment | Result | Win |
|---|---|---|
| Composition correctness (E1) | 1.5M field checks | 0 mismatches, 0 violations |
| Repair vs rejection (E2) | GA repairs/UUID ≈ k | O(k·8) vs 64^k |
| Collision + uniformity (E3–E5) | 2M UUIDs | 0 collisions; max dev 0.0053 |
| NIST SP 800-22 (E3–E5) | 3 structured layouts | all 15 tests PASS |
| Throughput (E6) | structured 0.53M/s | ~3× slower than native in-browser; base pool 7.5× faster |

Run: `bun run bench` → ±std, 95% CI, Welch t-test with Cohen's d.

## 6. Baseline comparison

Related work placed after technical content (per SPJ). Compared against pg_uuid_v8 (closest prior art), ULID / KSUID / Snowflake, and native v4 / v7. Each baseline verified by known-answer tests + NIST + collisions.

All numbers = ops/sec, mean of 10 trials (95% CI within ±5%), run on GitHub Actions CI (ubuntu-24.04, macOS-14, windows-2025). Run `bun run bench` for your machine.

| Generator | Ubuntu Bun | macOS Bun | Win Bun | Node 20 | Node 22 | Node 23 | Coll. 2M | NIST |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
| v4-native | 15.53M | 16.33M | 12.62M | 13.59M | 14.93M | 13.57M | 0 | — |
| v7-custom | 4.91M | 4.41M | 3.29M | 0.41M | 0.51M | 0.39M | 0 | — |
| genoid-v8 | 8.80M | 15.47M | 6.62M | 6.20M | 5.72M | 6.49M | 0 | — |
| mathrandom | 0.66M | 0.72M | 0.45M | 0.50M | 0.48M | 0.51M | 0 | — |
| pg-uuid-v8 | 1.15M | 1.38M | 0.90M | 0.22M | 0.23M | 0.22M | 0 | 15/15 |
| ulid | 0.61M | 0.77M | 0.44M | 0.21M | 0.21M | 0.20M | — | — |
| ulid-v8 | 1.29M | 1.60M | 0.98M | 0.23M | 0.23M | 0.22M | 0 | 15/15 |
| ksuid | 0.42M | 0.47M | 0.30M | 0.15M | 0.16M | 0.15M | — | — |
| snowflake | 3.61M | 4.49M | 2.55M | 5.52M | 5.74M | 5.35M | — | — |

Key findings:
- **0 collisions at scale** — all six generators tested for collisions at 1M × 6 environments = 36/36 PASS.
- **Runtime gap ≥ 10× on CSPRNG-heavy generators** — Node's `crypto.getRandomValues` per-call overhead is far higher than Bun's. Generators calling it once per UUID (v7, ulid, pg_uuid_v8, ulid-v8) are 3–13× slower on Node vs Bun on the same hardware. Pooled genoid-v8 (0.0039 calls/UUID) stays within 1.5×. See [`sources/runtime-gap.md`](sources/runtime-gap.md).
- **Statistical quality preserved** — random payload bits of pg_uuid_v8 and ULID-v8 pass all 15 NIST tests.

## 7. Validated claims

### Task A: Multi-environment
GitHub Actions matrix: ubuntu, macos, windows × Bun 1.3 + Node 20/22/23. All 36 collision cells PASS (6 envs × 6 algorithms). The consolidated CI table in §6 reveals a 3–13× Bun/Node gap on generators that call `crypto.getRandomValues` per UUID — see [`sources/runtime-gap.md`](sources/runtime-gap.md). Local: `bun run bench-ci`.

### Task B: Concurrent generation
`worker_threads` fan-out: 0 cross-worker collisions (plain GenoID, 3×50k); 0 collisions + 0 violations (structured, 4×50k). Run: `bun run bench-concurrent`.

### Task C: B-tree index
100k IDs into SQLite. All types clean B-tree (`freelist_count = 0`). Sortable IDs match/exceed random insert throughput. Run: `bun run bench-sqlite`.

### Task D: 100M collisions
Open-addressing 128-bit hash set (~2.3 GB vs ~10 GB), fanned across all cores. All generators 0 collisions — far below 122-bit birthday bound ~2.7×10¹⁸. Run: `bun run collision-100m`.

### Task E: Cross-engine browser
Playwright across Chromium, Firefox, WebKit — all three: `browserErrors: []`, structured entry present, 0 collisions. Run: `bun run playwright` (`bun x playwright install` first).

## 8. Applications

1. **Sharded DB** — embed shard ID in PK; router locates node direct, no lookup.
2. **Multi-tenant** — carry tenant ID for prefix isolation + row-level security.
3. **Event sourcing** — monotonic counter + timestamp → globally ordered, collision-free event IDs.
4. **Sortable time-series** — timestamp bits give chronological order + composable fields.
5. **Debuggability** — declared fields readable from hex; operators read shard/tenant/sequence.

## 9. Security analysis

GenoID v8 rests on OS CSPRNG — every pool refill calls `crypto.getRandomValues`; 122-bit min-entropy matches v4. Pool forward-secrecy caveat: refills every 256 UUIDs; process-memory adversary predicts at most 256 future UUIDs. Structured layouts leak metadata by design (timestamp, shard, counter, tenant) — consistent with RFC 9562 §8.2 warning.

Full analysis: [`sources/security-analysis.md`](sources/security-analysis.md).

## 10. Literature & formal docs

- [`sources/related-work.md`](sources/related-work.md) — no prior work applies GA-style operators to UUID generation.
- [`sources/formal-proofs.md`](sources/formal-proofs.md) — O(k) repair bound vs O(64^k) rejection; entropy-preservation proof.
- [`sources/threats-to-validity.md`](sources/threats-to-validity.md) — internal/external/construct/conclusion validity.
- [`sources/reproducibility.md`](sources/reproducibility.md) — one-command reproduction table, env pinning.

Extended randomness battery: `bun run dieharder`.
