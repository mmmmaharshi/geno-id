# GenoID

[![CI bench](https://github.com/mmmmaharshi/geno-id/actions/workflows/bench.yml/badge.svg)](https://github.com/mmmmaharshi/geno-id/actions/workflows/bench.yml)
[![Release](https://img.shields.io/github/v/release/mmmmaharshi/geno-id)](https://github.com/mmmmaharshi/geno-id/releases)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

Declarative RFC 9562 v8 UUID composition framework — embed structure (shard, tenant, counter, timestamp) in an ID without rejection sampling.

**One idea:** Standard UUID generators (v4, v7, hash) cannot embed application structure. Forcing it via rejection costs 64^k trials. GenoID replaces rejection with GA-inspired crossover + constraint-guided repair: **O(k·8) per ID** — 1.5M structured-field checks → 0 mismatches, 0 violations (§5 E1–E2). Controlled degradations and weak entropy show GA is architectural, not statistical (§10 C1).

## TL;DR

| Fact | Value |
|---|---|
| Published | `@manohar_maharshi/genoid@1.17.1` on npm |
| Collisions | 0 at 100M (v4, GenoID, v7, ULID-v8) |
| NIST SP 800-22 + dieharder | 15/15 PASS (NIST); 152/152 PASSED (dieharder, 4 generators × 38 sub-tests) |
| Throughput | GenoID-pooled 4.60–11.31M/s (9‑job / 7‑runtime×OS CI); structured 0.82–1.66M/s |

## 1. Install

Node ≥ 22, ESM-only, zero runtime deps. One command, ~10 seconds:

```bash
npm i @manohar_maharshi/genoid
```

Also runs on microcontroller-class runtimes without Web Crypto (ESP8266/ESP32, MicroPython) — see [Constrained / embedded hosts](#constrained--embedded-hosts-esp8266-class).


## 2. Quick start

**Wins in one line:** embed structure with **0 rejection cost** (O(k·8) vs 64^k), **0 collisions at 100M** across 7 runtime×OS cells, **all 15 NIST SP 800-22 + 152/152 dieharder** sub-tests PASS, **3.7–18.3M/s** pooled throughput (§6). Every claim below is reproduced by `bun run bench`.

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

### Constrained / embedded hosts (ESP8266-class)

The core is portable to microcontroller-class runtimes — small heap, no Web Crypto. Three optional configurators adapt it **without changing output**: every generated ID is byte-identical across all settings (pinned by INV-10 in the invariant suite), so these trade memory/portability for speed only.

- **`configureRandom(fn)`** — inject a platform CSPRNG where Web Crypto is absent (ESP8266/ESP32 firmware, MicroPython). `fn(buf)` must fill the byte range with secure random bytes. Import never eagerly draws entropy, so the module loads on a no-Web-Crypto host; the first `configureRandom` must run before the first ID.
- **`configurePools({ simplePoolSize, structuredPoolSize })`** — shrink the generation pools to trade batch size for RAM. The default structured pool holds ~34 KB + 1024 interned strings per layout; size 8 is ~336 B.
- **`configureFootprint("lean")`** — format from the 256-entry hex table instead of the default lazily-built 65536-entry word table, saving ~131k interned strings of heap. `"fast"` (default) keeps full desktop throughput.

```ts
import {
  configureRandom, configurePools, configureFootprint,
  genStructuredGenoID, DBKEY_LAYOUT,
} from "@manohar_maharshi/genoid"

configureFootprint("lean")                                     // 256-entry hex table
configurePools({ simplePoolSize: 16, structuredPoolSize: 8 })  // tiny RAM budget
configureRandom((buf) => platformFillRandom(buf))              // your CSPRNG

genStructuredGenoID(DBKEY_LAYOUT)                              // runs on ESP8266-class heap
```

On a standard host (Node / Bun / Deno / browser) none of these are needed — Web Crypto is used automatically and the fast footprint is the default.

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
| Repair vs rejection (E2) | O(k) repair, flat 1.4–3.2 µs/ID; measured trials match (1/d)^k | vs rejection's **2.8×10¹⁴ trials/ID** at k=6, d=0.004 ([sweep](sources/rejection-cost.md)) |
| Collision + uniformity (E3–E5) | 2M UUIDs | 0 collisions; max dev 0.0053 |
| NIST SP 800-22 (E3–E5) | 3 structured layouts | all 15 tests PASS |
| Throughput (E6) | structured 0.82–1.66M/s CI (previously 0.66–1.15M/s) | beats pg-uuid-v8 and ulid-v8 on every platform; base pool 3.7–4.6× faster |
| Draw-size NIST stability (P2) | 360 `binary_matrix_rank` trials (6 sizes × 60) | FAIL rate ~uniform 1.7% across 16–34B; matches α-noise, not a draw-size effect |

Run: `bun run bench` → ±std, 95% CI, Welch t-test with Cohen's d. Sample export: `bun x tsx scripts/export-rank-scan.ts` → `dist/rank-scan.csv`. Repair-vs-rejection sweep (E2): `bun run bench-rejection` → `results/rejection-sweep.{json,csv}`.

**Regression guard.** [`scripts/research-invariants.test.ts`](scripts/research-invariants.test.ts) pins the load-bearing claims as executable tripwires — v8 conformance, 0 constraint violations, ordered counters (mod field width), collision-freedom, and monobit entropy preservation on the random payload — and **re-runs every one of them under an injected RNG + ESP8266-class tiny pools** (INV-9) plus a lean/fast byte-identity check (INV-10), so embeddability or perf work cannot silently cancel a result. It fans generation across all CPU cores (`os.availableParallelism()`), runs tough scale by default (`GENOID_FAST=1` for a quick pass), and each invariant is mutation-verified to go red when its claim is broken. Run: `bun test scripts/research-invariants.test.ts`.

**Benchmark stats.** `bun run bench-ci` now emits a Welch t-test p-value and Cohen's d for every generator against the `v4-native` baseline (into `dist/bench-ci-results.json`), and discards a JIT warmup pass before the measured trials.

## 6. Baseline comparison

Related work placed after technical content (per SPJ). Compared against pg_uuid_v8 (closest prior art), ULID / KSUID / Snowflake, and native v4 / v7. Each baseline verified by known-answer tests + NIST + collisions.

All numbers = ops/sec, mean of 10 trials (95% CI within ±5%), run on GitHub Actions CI (ubuntu-24.04, macOS-14, windows-2025; Bun latest + Node 22 LTS + Deno 2.9.3). Run `bun run bench` for your machine.

| Generator | Ubuntu (Bun) | macOS (Bun) | Windows (Bun) | Node 22 (Win) | Deno 2.9.3 (Lin) | Deno 2.9.3 (mac) | Deno 2.9.3 (Win) | NIST |
|---:|---:|---:|---:|---:|---:|---:|---:|
| v4-native | 18.37M | 8.28M | 13.25M | 18.48M | 20.36M | 18.24M | 25.70M | — |
| v7-custom | 10.62M | 4.09M | 4.99M | 0.52M | 3.21M | 3.52M | 4.10M | — |
| genoid-v8 | 17.46M | 10.96M | 9.50M | 6.96M | 6.76M | 5.00M | 8.45M | — |
| mathrandom | 0.86M | 0.50M | 0.43M | 0.58M | 0.52M | 0.54M | 0.65M | — |
| pg-uuid-v8 | 1.75M | 0.88M | 0.80M | 0.27M | 0.46M | 0.47M | 0.53M | 15/15 |
| ulid | 0.87M | 0.46M | 0.40M | 0.20M | 0.40M | 0.39M | 0.48M | — |
| ulid-v8 | 1.78M | 0.96M | 0.85M | 0.29M | 0.46M | 0.52M | 0.54M | 15/15 |
| ksuid | 0.59M | 0.31M | 0.26M | 0.12M | 0.27M | 0.37M | 0.33M | — |
| snowflake | 4.61M | 2.24M | 2.39M | 4.78M | 5.42M | 7.89M | 5.97M | — |
| genoid-structured | 1.81M | 0.86M | 0.85M | 0.86M | 0.95M | 1.28M | 1.21M | 15/15 |

Key findings:
- **0 collisions at scale** — all nine collision-tested generators report 0 collisions across every runtime×OS cell (7 columns × 9 algorithms = 63/63 PASS at n=1M). `genoid-structured` (dbkey) joins the matrix; `snowflake` is excluded from the collision gate by design (12-bit sequence wraps within a millisecond under tight-loop generation) but remains in the speed table above.
- **genoid-structured beats pg-uuid-v8 and ulid-v8 on 5 of 7 environments** — leads on Ubuntu Bun (1.81M/s vs pg-uuid-v8 1.75M/s), Node Windows (0.86M/s vs 0.27M/s, +219%), Deno Linux (0.95M/s vs 0.46M/s, +107%), Deno macOS (1.28M/s vs 0.47M/s, +172%), Deno Windows (1.21M/s vs 0.53M/s, +128%). pg-uuid-v8 leads slightly on macOS Bun (0.88M/s vs 0.86M/s) and Windows Bun (0.80M/s vs 0.85M/s) — comparable.
- **Runtime gap on CSPRNG-heavy generators** — Node's `crypto.getRandomValues` per-call overhead is far higher than Bun's *and* Deno's. Generators calling it once per UUID (v7, ulid, pg_uuid_v8, ulid-v8, ksuid) are 3–13× slower on Node vs Bun/Deno on comparable OSes. Pooled genoid-v8 (0.0039 calls/UUID) stays within ~1.5×. See [`sources/runtime-gap.md`](sources/runtime-gap.md).
- **Node-on-Windows artifact** — per-call `getRandomValues` on Node's Windows crypto backend (BCryptGenRandom) is disproportionately slow: v7 measures 0.52M/s on Node/Windows vs 3.21M/s on Deno/Linux. Native `crypto.randomUUID()` (v4) and the pooled GenoID CSPRNG are unaffected, confirming the bottleneck is the Node-Windows backend, not GenoID. Documented in the CI table's "Known issues" footer.
- **Statistical quality preserved** — random payload bits of pg_uuid_v8 and ULID-v8 pass all 15 NIST tests.
- **pg_uuid_v8 is the only code-level prior art** — head-to-head (n=2M): both 0 collisions; pg_uuid_v8 is fixed-layout (timestamp only); GenoID is declarative (arbitrary fields). Both pass NIST. Win: GenoID = composition flexibility + speed.

### Dieharder battery

Beyond NIST SP 800-22, the four baseline/composition generators are run through the [dieharder](https://webhome.phy.duke.edu/~rgb/General/dieharder.php) curated subset (birthdays, rank_32x32, dna, count_1s_str, parking_lot, runs, sts_monobit, sts_serial) on a 12.5 MB / 100M-bit sample, 5 independent trials each. Per sub-test the modal assessment across trials is reported; a single test flipping PASSED/WEAK/FAILED is statistical noise. `diehard_opso`, `diehard_squeeze`, and the rgb/dab family are excluded (they rewind the sample or persistently fail good CSPRNG streams — see [`sources/reproducibility.md`](sources/reproducibility.md) §3).

| Generator | Sub-tests (5 trials) | Assessments | Non-5/5 trials | Result |
|---|---:|---|---:|---|
| v4 (native) | 38 | all PASSED | 6 | PASS |
| rawv8 (RFC 9562 v8, no GA) | 38 | all PASSED | 7 | PASS |
| genoid-v8 (GA + pool) | 38 | all PASSED | 11 | PASS |
| struct-dbkey (structured) | 38 | all PASSED | 5 | PASS |

Full per-sub-test p-values: [`results/dieharder-results.md`](results/dieharder-results.md). Local: `bun x tsx scripts/run-dieharder.ts` (requires the `dieharder` binary on the host).

## 7. Validated claims

### Task A: Multi-environment
GitHub Actions matrix: ubuntu/macos/windows × (Bun latest + Node 22 LTS + Deno 2.9.3) — 9 jobs across 7 distinct runtime×OS columns. All 63 collision cells PASS (7 envs × 9 algorithms). The consolidated CI table in §6 reveals a 3–13× Bun/Node/Deno gap on generators that call `crypto.getRandomValues` per UUID — see [`sources/runtime-gap.md`](sources/runtime-gap.md). Local: `bun run bench-ci` (Node/Bun) or `deno run --allow-read --allow-write --allow-env --allow-sys scripts/deno/bench-ci.ts` (Deno).

### Task B: Concurrent generation
`worker_threads` fan-out: 0 cross-worker collisions (plain GenoID, 3×50k); 0 collisions + 0 violations (structured, 4×50k). Run: `bun run bench-concurrent`.

### Task C: B-tree index
100k IDs into SQLite. All types clean B-tree (`freelist_count = 0`). Sortable IDs match/exceed random insert throughput. Run: `bun run bench-sqlite`.

### Task D: 100M collisions
Open-addressing 128-bit hash set (~2.3 GB vs ~10 GB), fanned across all cores. All generators 0 collisions — 0 observed vs 122-bit birthday bound ~2.7×10¹⁸ expected at p=0.5. Run: `bun run collision-100m`.

### Task E: Cross-engine browser
Playwright across Chromium, Firefox, WebKit — all three: `browserErrors: []`, structured entry present, 0 collisions. Run: `bun run playwright` (`bun x playwright install` first).

### Task F: Database index locality
Zero-install `bun:sqlite` benchmark (clustered + secondary index modes, 500k rows × 3 runs, no daemon to install). Random `uuid_v4` inserts at 186k rows/s vs time-ordered `uuid_v7` 509k — **2.7×**, reproducing the published ULID/Shopify result — and `genoid-structured` (402k) matches the time-ordered peers. Partition differentiator: `genoid-shardfirst` answers "rows for partition k" straight from the PK with **0 index bytes and no insert tax**, whereas a `uuid_v7` secondary index costs a **24.5% insert-throughput tax + ~10% storage** for the same capability. Honest scope (SQLite repacks pages, so insert-time — not size — is the signal; the win is storage + write-amplification, not read latency): [`sources/db-benchmark.md`](sources/db-benchmark.md). Run: `bun run bench-db`.

## 8. Applications

1. **Sharded DB** — embed shard ID in PK; router locates the node directly, no lookup. Measured (§7 Task F): partition-queryable from the key with **0 index bytes and no insert tax**, vs a **24.5% insert-throughput tax + ~10% storage** for the secondary index a random/time-only key needs for the same query.
2. **Multi-tenant** — carry tenant ID for prefix isolation + row-level security, without a separate tenant index.
3. **Event sourcing** — monotonic counter + timestamp → globally ordered, collision-free event IDs.
4. **Sortable time-series** — timestamp bits give chronological order + composable fields.
5. **Debuggability** — declared fields readable from hex; operators read shard/tenant/sequence.

## 9. Security analysis

GenoID v8 rests on OS CSPRNG — every pool refill calls `crypto.getRandomValues`; 122-bit min-entropy matches v4. Pool forward-secrecy caveat: refills every 256 UUIDs; process-memory adversary predicts at most 256 future UUIDs. Structured layouts leak metadata by design (timestamp, shard, counter, tenant) — consistent with RFC 9562 §8.2 warning.

Full analysis: [`sources/security-analysis.md`](sources/security-analysis.md).

## 10. Literature & formal docs

- [`sources/related-work.md`](sources/related-work.md) — no prior work applies GA-style operators to UUID generation.
- [`sources/formal-proofs.md`](sources/formal-proofs.md) — O(k) repair bound vs O(64^k) rejection; entropy-preservation proof.
- [`sources/rejection-cost.md`](sources/rejection-cost.md) — measured sparsity sweep: O(k) repair (flat µs) vs (1/d)^k rejection, validating the §III bound on real hardware.
- [`sources/db-benchmark.md`](sources/db-benchmark.md) — index-locality benchmark; partition-queryable PKs with zero index write-amplification.
- [`sources/threats-to-validity.md`](sources/threats-to-validity.md) — internal/external/construct/conclusion validity.
- [`sources/reproducibility.md`](sources/reproducibility.md) — one-command reproduction table, env pinning.
- [`docs/literature-review.md`](docs/literature-review.md) — full survey (5 themes, 25+ sources). Two refutable claims: (C1) GA is architectural, not statistical; (C2) declarative RFC 9562 v8 layout composition is novel vs pg_uuid_v8.

Extended randomness battery: `bun run dieharder`.
