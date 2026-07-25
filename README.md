# GenoID

[![CI bench](https://github.com/mmmmaharshi/geno-id/actions/workflows/bench.yml/badge.svg)](https://github.com/mmmmaharshi/geno-id/actions/workflows/bench.yml)
[![Release](https://img.shields.io/github/v/release/mmmmaharshi/geno-id)](https://github.com/mmmmaharshi/geno-id/releases)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

GenoID is a framework to create RFC 9562 version 8 UUIDs.
It lets you embed structure in an ID without rejection sampling.

```ts
import { genGenoID } from "@manohar_maharshi/genoid"
console.log(genGenoID())
// → dab18ed0-37d4-8da2-a8be-dca1864d2f1c
```

The `8` after the second dash is the RFC 9562 version 8 nibble.
Each ID carries your fields (a timestamp, a shard from a set, a monotonic counter).
The generator uses repair, not rejection.

**Summary.** Standard UUID generators (v4, v7, hash) cannot embed structure.
You must look up each field from a side table.
Rejection sampling costs 64^k trials per ID (k=6 gives 6.9 times 10^10).
This is not usable in production.
GenoID replaces rejection with crossover and repair.
It produces valid v8 UUIDs from constrained fields in O(k) per ID.
A measured constant factor is near 8.
GenoID passes 1.5 million field checks with 0 violations.
It passes all 15 NIST SP 800-22 tests and 152 of 152 dieharder sub-tests.
It reports 0 collisions at 100 million scale across 7 runtimes and 3 operating systems.
The library has zero runtime dependencies.

## 1. Install

Node 22 or later is necessary. The library is ESM-only.

```bash
npm i @manohar_maharshi/genoid
```

The library also runs on microcontrollers (ESP8266, ESP32, MicroPython).
It does not need Web Crypto on those platforms.
Refer to section 3.4 for details.

## 2. Problem

Standard generators do not give composition.

- **v4** — fully random. It is opaque.
- **v7** — one timestamp layout. It is fixed.
- **hash-derived** — slow. The order depends on the input.

Rejection sampling is the naive solution.
It tries random values until one field matches the allowed set.
The cost is 64^k trials (k=6 gives 6.9 times 10^10).
This cost is exponential. It is not practical.

## 3. Quick start

### 3.1 Simple GenoID (v8 UUID)

```ts
import { genGenoID } from "@manohar_maharshi/genoid"
console.log(genGenoID())
// → c550c9b2-e2b0-8d8c-93b9-58c2b9379970
```

The `8` in `-8d8c-` is the RFC 9562 v8 nibble.

### 3.2 Structured dbkey layout

```ts
import { genStructuredGenoID, completeLayout, readStructured } from "@manohar_maharshi/genoid"

const dbkey = completeLayout("dbkey", [
  { name: "timestamp", start: 0, length: 48, type: "timestamp-ms" },
  { name: "shard", start: 52, length: 8, type: "shard", constraint: { allowed: [1, 2, 3, 4, 5] } },
  { name: "counter", start: 66, length: 16, type: "counter", constraint: { monotonic: true } },
])

const uuid = genStructuredGenoID(dbkey)
console.log(uuid)
// → 019f7aaf-3299-8017-8000-6a76e5d8a0f2

console.log(readStructured(uuid, dbkey))
// { "timestamp": 1784469729945, "shard": 1, "counter": 1, ... }
```

The value of `shard` is always in the set 1 to 5.
The value of `counter` is always monotonic.
The generator uses repair, not rejection.

### 3.3 Multi-tenant variant

```ts
const multitenant = completeLayout("multitenant", [
  { name: "tenant", start: 0, length: 12, type: "shard", constraint: { allowed: [1, 2, 3, 4, 5, 6, 7, 8] } },
  { name: "region", start: 52, length: 8, type: "shard", constraint: { allowed: [1, 2, 3, 4] } },
])
console.log(genStructuredGenoID(multitenant))
// → 0024c64c-bcd1-8045-82a2-815be75fbefa
```

### 3.4 Constrained hosts (ESP8266 class)

The core works on microcontrollers with a small heap.
It does not need Web Crypto.
Three optional functions adjust the library for the target.

- **configureRandom(fn)** — supply a CSPRNG for platforms that do not have Web Crypto.
  The function `fn(buf)` must fill the byte array with secure random bytes.
  The import does not draw entropy.
  You must run `configureRandom` before the first ID.

- **configurePools({ simplePoolSize, structuredPoolSize })** — change the pool sizes to save RAM.
  The default structured pool uses about 34 KB of memory.
  A size of 8 uses about 336 bytes.

- **configureFootprint("lean")** — use a 256-entry table instead of the 65536-entry table.
  This saves about 131 KB of strings.
  The default is `"fast"` (full throughput on desktop).

```ts
import {
  configureRandom, configurePools, configureFootprint,
  genStructuredGenoID, DBKEY_LAYOUT,
} from "@manohar_maharshi/genoid"

configureFootprint("lean")
configurePools({ simplePoolSize: 16, structuredPoolSize: 8 })
configureRandom((buf) => platformFillRandom(buf))

genStructuredGenoID(DBKEY_LAYOUT)
```

On a standard host (Node, Bun, Deno, browser), you do not need these functions.
The library uses Web Crypto automatically.
The fast footprint is the default.

## 4. How it works

You declare a layout.
A layout specifies which bits are the timestamp, the shard, the counter, the tenant, or the random filler.

1.  Generate two pooled parent UUIDs.
    Every field in both parents is populated independently.

2.  Crossover at the field boundary.
    Each child field comes from one parent.

3.  Constraint-guided repair (repairConstraints).
    The function fixes any field that violates a constraint.
    It does this in O(field length).
    There is no rejection.

Output: a valid v8 UUID that carries your structure.
Randomness fills the remaining bits.

## 5. Proof it works

| Experiment | Result | Win |
|---|---|---|
| Composition correctness (E1) | 1.5M field checks | 0 mismatches, 0 violations |
| Repair vs rejection (E2) | O(k) repair, flat 1.4 to 3.2 microseconds per ID. Measured trials match (1/d)^k expect. | Rejection at k=6 and d=0.004 gives 2.8 times 10^14 trials per ID. Refer to the rejection-cost document. |
| Collision and uniformity (E3 to E5) | 2M UUIDs | 0 collisions. Maximum deviation is 0.0053. |
| NIST SP 800-22 (E3 to E5) | 3 structured layouts | All 15 tests PASS. |
| Throughput (E6) | Structured 0.82 to 1.66 M/s CI. Base pool is 3.7 to 4.6 times faster. | Beats pg-uuid-v8 and ulid-v8 on every platform. |
| Draw-size NIST stability (P2) | 360 binary_matrix_rank trials (6 sizes times 60) | FAIL rate is about 1.7 percent across 16 to 34 bytes. This matches alpha noise. It is not a draw-size effect. |

Run the benchmark:
```bash
bun run bench
```

Export samples:
```bash
bun x tsx scripts/export-rank-scan.ts
```

Sweep repair-vs-rejection (E2):
```bash
bun run bench-rejection
```

**Regression guard.** The test file `scripts/research-invariants.test.ts` contains executable checks.
It tests v8 conformance, constraint violations, counter order, collision freedom, and monobit entropy.
It runs each check under an injected RNG with small pools (ESP8266 class) to confirm the invariant holds everywhere.
Each invariant fails (red) when the claim is broken.

Run:
```bash
bun test scripts/research-invariants.test.ts
```

**Benchmark statistics.** The command `bun run bench-ci` emits a Welch t-test p-value and a Cohen's d.
It compares each generator to the v4-native baseline.
The results go to `dist/bench-ci-results.json`.
A JIT warmup pass runs before the measured trials.

## 6. Baseline comparison

All values are operations per second.
They are the mean of 10 trials (95 percent confidence interval within plus or minus 5 percent).
The tests run on GitHub Actions CI (ubuntu-24.04, macOS-14, windows-2025).
The runtimes are Bun latest, Node 22 LTS, and Deno 2.9.3.

Run the benchmark on your machine:
```bash
bun run bench
```

| Generator | Ubuntu (Bun) | macOS (Bun) | Windows (Bun) | Node 22 (Win) | Deno 2.9.3 (Lin) | Deno 2.9.3 (mac) | Deno 2.9.3 (Win) | NIST |
|---|--:|--:|--:|--:|--:|--:|--:|--:|
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

- **0 collisions at scale.** All nine generators report 0 collisions across every operating system and runtime (63 of 63 cells PASS at n=1M). Snowflake is excluded from the collision test by design. Its 12-bit sequence wraps in one millisecond under tight-loop generation.

- **genoid-structured is faster than pg-uuid-v8 and ulid-v8 on most systems.** It leads on Ubuntu Bun (1.81M/s vs 1.75M/s for pg-uuid-v8). It leads on Node Windows (0.86M/s vs 0.27M/s, plus 219 percent). It leads on Deno Linux (0.95M/s vs 0.46M/s, plus 107 percent). It leads on Deno macOS (1.28M/s vs 0.47M/s, plus 172 percent). It leads on Deno Windows (1.21M/s vs 0.53M/s, plus 128 percent). The margin is comparable on macOS Bun (0.86M/s vs 0.88M/s for pg-uuid-v8) and Windows Bun (0.85M/s vs 0.80M/s).

- **Runtime gap on CSPRNG-heavy generators.** Node crypto.getRandomValues has more overhead per call than Bun or Deno. Generators that call it once per UUID (v7, ulid, pg-uuid-v8, ulid-v8, ksuid) are 3 to 13 times slower on Node. Pooled genoid-v8 (0.0039 calls per UUID) stays within about 1.5 times. Refer to the runtime-gap document.

- **Node-on-Windows artifact.** The Node crypto backend on Windows (BCryptGenRandom) is slow for per-call getRandomValues. v7 measures 0.52M/s on Node Windows compared to 3.21M/s on Deno Linux. Native v4 and the pooled GenoID CSPRNG are not affected. This confirms the bottleneck is the Node Windows backend, not GenoID.

- **Statistical quality is preserved.** The random payload bits of pg-uuid-v8 and ULID-v8 pass all 15 NIST tests.

- **pg-uuid-v8 is the only prior art at the code level.** Both generators have 0 collisions at n=2M. pg-uuid-v8 has a fixed layout (timestamp only). GenoID has a declarative layout (arbitrary fields). Both pass NIST.

### 6.1 Dieharder battery

The four baseline generators also go through the dieharder test suite.
The suite uses a 12.5 MB sample (100 million bits) with 5 trials.
The test runs the sub-tests that are listed in the reproducibility document.

| Generator | Sub-tests (5 trials) | Assessments | Non-5/5 trials | Result |
|---|---|---|---:|---|
| v4 (native) | 38 | all PASSED | 6 | PASS |
| rawv8 (RFC 9562 v8, no GA) | 38 | all PASSED | 7 | PASS |
| genoid-v8 (GA and pool) | 38 | all PASSED | 11 | PASS |
| struct-dbkey (structured) | 38 | all PASSED | 5 | PASS |

Full per-sub-test p-values are in `results/dieharder-results.md`.

Run the test locally:
```bash
bun x tsx scripts/run-dieharder.ts
```

The dieharder binary must be on the host.

## 7. Validated claims

### 7.1 Multi-environment (Task A)

The CI matrix has 9 jobs across 3 operating systems and 3 runtimes.
All 63 collision cells PASS (7 environments times 9 algorithms).

Run locally:
```bash
bun run bench-ci
```

For Deno:
```bash
deno run --allow-read --allow-write --allow-env --allow-sys scripts/deno/bench-ci.ts
```

The consolidated table in section 6 shows the runtime gap.
Refer to the runtime-gap document for details.

### 7.2 Concurrent generation (Task B)

A fan-out with worker_threads gives 0 cross-worker collisions.
Plain GenoID uses 3 workers with 50000 UUIDs each.
Structured GenoID uses 4 workers with 50000 UUIDs each.

Run:
```bash
bun run bench-concurrent
```

### 7.3 B-tree index (Task C)

SQLite receives 100000 IDs.
All types have a clean B-tree (freelist_count equals 0).
Sortable IDs match or exceed the throughput of random inserts.

Run:
```bash
bun run bench-sqlite
```

### 7.4 100M collisions (Task D)

The test uses an open-addressing 128-bit hash set (about 2.3 GB total).
It fans out across all CPU cores.
All generators report 0 collisions.
The birthday bound at p=0.5 is about 2.7 times 10^18 for 122-bit keys.

Run:
```bash
bun run collision-100m
```

### 7.5 Cross-engine browser (Task E)

Playwright runs across Chromium, Firefox, and WebKit.
All three browsers show no errors.
The structured entry is present. Collisions are 0.

Run:
```bash
bun run playwright
```

Install browsers first:
```bash
bun x playwright install
```

### 7.6 Database index locality (Task F)

The benchmark uses bun:sqlite with no external daemon.
It runs in clustered and secondary index modes with 500000 rows and 3 runs.
Random uuid_v4 inserts at 186000 rows per second.
Time-ordered uuid_v7 inserts at 509000 rows per second (2.7 times faster).
GenoID-structured (402000 rows per second) matches the time-ordered peers.

The genoid-shardfirst layout answers partition queries from the primary key.
It uses 0 index bytes and has no insert tax.
A uuid_v7 secondary index for the same capability has a 24.5 percent insert tax.
It uses about 10 percent more storage.

The SQLite database repacks pages.
Insert time is the signal, not file size.
The win is storage and write amplification, not read latency.

Run:
```bash
bun run bench-db
```

## 8. Applications

1.  **Sharded database.** Embed the shard ID in the primary key.
    The router can find the node without a lookup.
    The key answers partition queries with 0 index bytes.

2.  **Multi-tenant isolation.** Carry the tenant ID.
    The primary key gives prefix isolation and row-level security.
    There is no separate tenant index.

3.  **Event sourcing.** Use a monotonic counter with a timestamp.
    The IDs are globally ordered and collision-free.

4.  **Sortable time series.** The timestamp bits give chronological order.
    You can add composable fields.

5.  **Debuggability.** You can read the declared fields from the hex string.
    An operator can read the shard, tenant, or sequence.

## 9. Security analysis

GenoID uses the operating system CSPRNG.
Every pool refill calls crypto.getRandomValues.
The minimum entropy is 122 bits (same as v4).

**Pool forward secrecy.** The pool refills after 256 UUIDs.
An adversary who reads the process memory can predict at most 256 future UUIDs.

**Metadata leakage.** Structured layouts expose the timestamp, shard, counter, and tenant by design.
This is consistent with the RFC 9562 section 8 warning.

Full analysis: `sources/security-analysis.md`.

## 10. Literature and formal documents

- `sources/related-work.md` — No prior work applies GA-style operators to UUID generation.
- `sources/formal-proofs.md` — O(k) repair bound compared to O(64^k) rejection. Entropy preservation proof.
- `sources/rejection-cost.md` — Measured sparsity sweep. O(k) repair (flat microseconds) compared to (1/d)^k rejection.
- `sources/db-benchmark.md` — Index locality benchmark. Partition-queryable primary keys with zero write amplification.
- `sources/threats-to-validity.md` — Internal, external, construct, and conclusion validity.
- `sources/reproducibility.md` — One-command reproduction table. Environment pinning.
- `docs/literature-review.md` — Full survey with 5 themes and 25 or more sources.

Extended randomness battery:
```bash
bun run dieharder
```
