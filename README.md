# GenoID

[![CI bench](https://github.com/mmmmaharshi/geno-id/actions/workflows/bench.yml/badge.svg)](https://github.com/mmmmaharshi/geno-id/actions/workflows/bench.yml)
[![Release](https://img.shields.io/github/v/release/mmmmaharshi/genoid)](https://github.com/mmmmaharshi/geno-id/releases)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

Create RFC 9562 v8 UUIDs that contain your data — a shard ID, a tenant, a timestamp, a monotonic counter — all inside a single standard identifier.

```ts
import { genGenoID } from "@manohar_maharshi/genoid"

// A simple v8 UUID
console.log(genGenoID())
// → a7e2c8f1-3b5d-8a90-c6d4-2e1f0b3a9c87

// A structured UUID with your fields
import { completeLayout, genStructuredGenoID } from "@manohar_maharshi/genoid"

const dbkey = completeLayout("dbkey", [
  { name: "shard",   start: 52, length: 8, type: "shard",
    constraint: { allowed: [1, 2, 3, 4, 5] } },
  { name: "counter", start: 66, length: 16, type: "counter",
    constraint: { monotonic: true } },
])

const id = genStructuredGenoID(dbkey)
// → 019f7aaf-3299-8017-8000-6a76e5d8a0f2
//   shard=3, counter=14  ← readable from the hex string
```

The `8` after the second dash is the RFC 9562 v8 version nibble.
It tells any UUID parser that this is a custom-format identifier.
Your fields sit in the remaining 122 bits.

## Why you need this

Standard UUIDs cannot carry your data.

| Generator | Problem for you |
|---|---|
| UUIDv4 | Fully random. You cannot tell which server owns a record. |
| UUIDv7 | One fixed layout (timestamp + random). You cannot add a shard, a tenant, or a sequence counter. |
| Hash-based | Slow. The order depends on the input. You cannot sort by creation time. |

**The rejection-sampling trap.** To force a field into a UUID, you can generate random IDs until the field matches your constraint. This is exponential: 6 constrained fields can need 69 billion tries. It is not usable in production.

GenoID replaces rejection with repair.
It generates a valid UUID on the first try.
The cost is O(k) where k is the number of constrained fields (measured constant factor near 8).

## Install

```
npm i @manohar_maharshi/genoid
```

Node 22 or later. No runtime dependencies.

Works in Bun, Deno, browsers, and on microcontrollers (ESP8266, ESP32).

## Your first structured UUID

You declare a layout. The library generates the UUID.

```ts
import { completeLayout, genStructuredGenoID } from "@manohar_maharshi/genoid"

const layout = completeLayout("myapp", [
  { name: "tenant", start: 0, length: 12, type: "shard",
    constraint: { allowed: [1, 2, 3] } },
  { name: "seq",    start: 66, length: 16, type: "counter",
    constraint: { monotonic: true } },
])

for (let i = 0; i < 5; i++) {
  console.log(genStructuredGenoID(layout))
}
// → 00123400-0000-8000-...  (tenant=1, seq=0)
// → 00156700-0000-8001-...  (tenant=1, seq=1)
```

The output is a standard v8 UUID.
Any RFC 9562 parser can read it.
Your application also reads the embedded fields.

```ts
import { readStructured } from "@manohar_maharshi/genoid"

const parsed = readStructured(id, layout)
console.log(parsed.tenant)  // → 1
console.log(parsed.seq)     // → 14
```

## What you can embed

| Field type | Example | Constraint types |
|---|---|---|
| `timestamp-ms` | Unix time in milliseconds | None (always valid) |
| `shard` | A server or partition ID | `allowed: [...set...]`, `range: { min, max }` |
| `counter` | A monotonic sequence | `monotonic: true` |
| `node` | A machine or process ID | None |
| `custom` | Raw bits you control | `allowed`, `range`, `monotonic` |

The `completeLayout` function validates your layout at declaration time.
It reports overlapping fields, out-of-range offsets, and missing required fields.
The error message tells you what to fix.

## Use cases

### Sharded database

Embed the shard ID in the primary key.
Your router reads the shard directly from the key string.
No lookup, no hash ring, no consistent hashing.

```ts
const shardLayout = completeLayout("sharded", [
  { name: "shard", start: 52, length: 8, type: "shard",
    constraint: { allowed: [1, 2, 3, 4, 5, 6, 7, 8] } },
])

function route(uuid: string): number {
  // Read the shard from the key directly
  return readStructured(uuid, shardLayout).shard
}
```

### Multi-tenant application

Each tenant has a dedicated ID range.
The storage layer enforces tenant isolation without a join.

```ts
const tenantLayout = completeLayout("multitenant", [
  { name: "tenant", start: 0, length: 12, type: "shard",
    constraint: { allowed: [1, 2, 3, 4, 5, 6, 7, 8] } },
  { name: "region", start: 52, length: 8, type: "shard",
    constraint: { allowed: [1, 2, 3, 4] } },
])

const id = genStructuredGenoID(tenantLayout)
// tenant=3, region=2 → readable from the first hex characters
```

### Event sourcing

Events sort in creation order by their primary key.
No sequence server, no coordination.

```ts
const eventLayout = completeLayout("events", [
  { name: "seq", start: 66, length: 24, type: "counter",
    constraint: { monotonic: true } },
])

const events = Array.from({ length: 100 }, () => genStructuredGenoID(eventLayout))
// events.sort() is already in creation order
```

## Performance

GenoID is faster than other structured UUID generators.

| Generator | Ops/sec (Bun, Ubuntu) | Collisions (n=2M) | NIST |
|---|---|---|---|
| v4-native | 18.37 M | 0 | — |
| genoid-v8 (pooled, unstructured) | 17.46 M | 0 | — |
| genoid-structured (dbkey) | 1.81 M | 0 | 15/15 |
| pg-uuid-v8 | 1.75 M | 0 | 15/15 |
| ulid-v8 | 1.78 M | 0 | 15/15 |

Full table across 7 runtimes and 3 operating systems: run `bun run bench-ci`.

## API

### `genGenoID(): string`

Generate a standard v8 UUID with 122 random bits.

```ts
import { genGenoID } from "@manohar_maharshi/genoid"
const id = genGenoID()
```

### `completeLayout(name, fields): Layout`

Declare a structured layout. The function validates the fields at declaration time.

```ts
const layout = completeLayout("name", [
  { name: "field1", start: bitOffset, length: bitCount, type: fieldType,
    constraint?: { allowed?: number[], range?: { min, max }, monotonic?: boolean } },
])
```

### `genStructuredGenoID(layout): string`

Generate a UUID that follows the layout. All constraints are satisfied by repair.

```ts
const id = genStructuredGenoID(layout)
```

### `readStructured(uuid, layout): Record<string, number>`

Read the declared fields from a UUID string.

```ts
const fields = readStructured(id, layout)
console.log(fields.shard)   // → 3
console.log(fields.counter) // → 14
```

### `configureRandom(fn)`

Supply a CSPRNG for platforms without Web Crypto.

```ts
configureRandom((buf) => platformFillRandom(buf))
```

### `configurePools(options)`

Reduce memory for constrained hosts.

```ts
configurePools({ simplePoolSize: 16, structuredPoolSize: 8 })
```

### `configureFootprint(mode)`

Trade throughput for memory.

```ts
configureFootprint("lean")  // 256-entry table, saves ~131 KB
```

## Run on a microcontroller

GenoID works on ESP8266, ESP32, and similar platforms.

```ts
import { configureRandom, configurePools, configureFootprint,
         genStructuredGenoID, DBKEY_LAYOUT } from "@manohar_maharshi/genoid"

configureFootprint("lean")
configurePools({ simplePoolSize: 16, structuredPoolSize: 8 })
configureRandom((buf) => platformFillRandom(buf))

const id = genStructuredGenoID(DBKEY_LAYOUT)
```

The output is identical to a desktop-generated UUID for the same layout.
The invariant suite (INV-10) pins this property.

## Security

GenoID uses the operating system CSPRNG (`crypto.getRandomValues`).
Each pool refill draws fresh entropy.
Minimum entropy is 122 bits (same as UUIDv4).

**Pool forward secrecy.** The pool refills every 256 UUIDs.
An adversary who reads the process memory predicts at most 256 future UUIDs.

**Metadata leakage.** Structured layouts expose the timestamp, shard, counter, and tenant by design.
This is consistent with RFC 9562 section 8.

## Validation

GenoID passes the following checks.

- **NIST SP 800-22.** All 15 sub-tests PASS on three structured layouts.
- **Dieharder.** 152 of 152 sub-tests PASS across v4, raw, pooled, and structured variants.
- **100 million collisions.** Zero collisions across all generators.
- **1.5 million field checks.** Zero constraint violations.
- **Cross-language reproducibility.** Rust implementation is byte-identical to TypeScript for 3000 golden vectors.

Run the validation suite:

```bash
bun run bench-ci     # benchmark + collisions
bun run bench-db    # database index locality
bun run playwright  # browser (Chromium, Firefox, WebKit)
```

## Prior art

| Project | Difference from GenoID |
|---|---|
| pg-uuid-v8 | Fixed layout (timestamp only). No declarative fields, no repair. |
| ULID | One layout (timestamp + random). No custom fields. |
| Snowflake | Requires a ZooKeeper-like coordinator. Not a UUID. |
| KSUID | Fixed layout (timestamp + random). No constraints. |

GenoID is the first library that lets you declare arbitrary field layouts and satisfy them by repair, not rejection.

## Full documentation

| File | What it contains |
|---|---|
| `sources/formal-proofs.md` | O(k) repair bound, entropy preservation |
| `sources/rejection-cost.md` | Measured rejection vs repair sweep |
| `sources/db-benchmark.md` | Index locality and partition-queryable keys |
| `sources/security-analysis.md` | Threat model and entropy accounting |
| `sources/threats-to-validity.md` | Internal, external, construct, and conclusion validity |
| `sources/reproducibility.md` | One-command reproduction for all results |
| `docs/literature-review.md` | Full survey with 25+ sources |
