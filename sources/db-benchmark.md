# Database index-locality benchmark

Measures whether time-ordered / structured UUID primary keys give better B-tree
index locality than random v4 (faster sustained inserts), and quantifies the
cost a conventional key pays to become *partition-queryable* — the capability
GenoID's declared fields provide for free.

**Zero external software.** Runs entirely in-process on `bun:sqlite` (built into
Bun); no Postgres/MySQL daemon to install. Reproduce with:

```bash
bun run build && bun run bench-db --rows=500000
```

Knobs: `--rows`, `--runs`, `--cache-mb` (buffer budget — kept small so the
B-tree spills and the locality regime is exercised), `--blob-bytes`, `--mode`.
Output artifact: `results/db-sqlite.json`.

## Method

One SQLite database file per arm; only the **primary-key type** differs, the row
payload (`tenant`, `ts`, 64-byte blob) is identical and seeded so comparisons
isolate the PK. Keys are stored as native 16-byte `BLOB` — never text. Two table
modes reproduce the two real-world index layouts:

- **clustered** (`WITHOUT ROWID`) — the PK *is* the B-tree (InnoDB-like); random
  keys reshuffle the clustered store on every insert.
- **secondary** (rowid table) — the PK is a secondary B-tree (Postgres-like).

Arms: `bigint_seq` (16-byte counter, ideal-locality lower bound), `uuid_v4`,
`uuid_v7`, `pg_uuid_v8`, `ulid_v8`, `genoid_v8` (pooled random), `genoid_structured`
(`dbkey`, time-first), and `genoid_shardfirst` (a declared layout with the shard
in the leading byte, so a partition is a contiguous key range). Throughput is the
mean of N runs with a 95% CI; a warmup batch is discarded.

### Honest scope

The strong, reproducible signal is **insert throughput**. SQLite repacks pages
aggressively, so on-disk *size* diverges far less than production InnoDB would
(`pages/row` is ~flat across arms here); absolute size/page-split numbers belong
to a native Postgres/InnoDB run. Results are therefore **relative** and instantly
reproducible. The partition-query differentiator is **storage + write
amplification, not read latency** — see below.

## Results

Environment: Apple A18 Pro (6 cores), 8 GB, macOS/arm64, SQLite 3.51.0;
`rows=500000`, `runs=3`, `cache-mb=16`, `blob=64B`.

### Insert throughput — clustered (InnoDB-like), rows/s (mean, 95% CI)

| Arm | rows/s | vs v4 |
|---|---:|---:|
| bigint_seq (ideal) | 1,127,273 | 6.0× |
| uuid_v7 | 509,370 | 2.7× |
| genoid_structured | 402,385 | 2.2× |
| ulid_v8 | 398,579 | 2.1× |
| genoid_shardfirst | 386,045 | 2.1× |
| pg_uuid_v8 | 383,993 | 2.1× |
| uuid_v4 | 186,400 | 1.0× |
| genoid_v8 (random) | 166,072 | 0.9× |

**`uuid_v4` → `uuid_v7` = 2.7×** reproduces the published result that time-ordered
keys roughly halve insert cost (Shopify's ULID→MySQL migration, and the ULID/v7
literature). **`genoid_structured` (402k) matches the time-ordered peers** — it
inherits their locality. `genoid_v8` is deliberately fully random (no time
ordering) and behaves like `uuid_v4`; use `genoid_structured` where locality
matters. The secondary-index mode shows the same ordering at ~0.8× the absolute
rates (full table in `results/db-sqlite.json`).

### Partition-query differentiator (the declarative-structure payoff)

Query: "all rows for partition `k`". `genoid_shardfirst` carries the partition in
the PK; every other scheme carries it only in a column.

| | insert rows/s | index storage | answers partition query |
|---|---:|---:|---|
| `genoid_shardfirst` (partition in PK) | **385,596** | **0** | PK range scan |
| `uuid_v7` + secondary index | 371,703 | 7.2 MB | indexed probe |
| `uuid_v7`, no index | 492,509 | 0 | full scan only |

To make the partition query fast, a conventional key must maintain a secondary
index: a **24.5 % insert-throughput tax** (492,509 → 371,703 rows/s) plus ~10 %
storage (7.2 MB on this table). GenoID embeds the partition in the key, so at
**equal capability** (both partition-queryable) it inserts **faster** *and* uses
**less** storage — no index, no tax.

Read latency is the honest caveat: the GenoID PK range scan (≈380 ms for ~100k
matched rows, `99,538 / 500,000 ≈ 1/5`) is *slower* than the baseline's indexed
probe (≈1.2 ms). The win is architectural — zero index storage and zero insert
write-amplification — not query speed. A read-dominated workload can additionally
index GenoID's shard bits; a write-dominated / sharding workload (the target use
case) keeps the full insert throughput the baseline forfeits.

Point lookups are indistinguishable across arms (~6.5 µs/op) — expected, all are
16-byte PK equality probes.

## Limitations

- Single embedded engine (SQLite). Page repacking hides the size/page-split
  divergence a native InnoDB/Postgres would show; only insert-time is treated as
  a discriminating metric here. A `--engine=postgres` path (native `PG_URL`) is
  the place for absolute size and split-count figures.
- In-process, single-thread load on shared consumer hardware — numbers are
  relative, not production capacity-planning figures.
- The partition experiment compares equal-cardinality partitions, not identical
  row sets; it measures cost-of-capability, not a row-for-row query race.
