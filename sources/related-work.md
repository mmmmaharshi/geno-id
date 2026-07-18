# GenoID — Background and Related Work (Phase B)

This document surveys the literature and prior art that situates GenoID: the
UUID standards (RFC 4122 → RFC 9562), the family of sortable/structured
identifiers, steganographic UUIDs (the closest prior art), genetic/evolutionary
computation, and high-throughput secure generation. It closes with the gap
GenoID fills and its contribution. All claims are grounded in the cited sources.

## 1. UUID standards: from RFC 4122 to RFC 9562

UUIDs are 128-bit identifiers defined by **RFC 4122** (Leach, Mealling, Salz,
2005) covering versions 1–5. RFC 4122 was **obsoleted by RFC 9562**
(Davis, Peabody, Leach; IETF Standards Track, May 2024), which adds versions 6,
7, and 8 and revises best practices [1].

- **UUIDv4** — 122 bits of CSPRNG randomness; variant/version bits fixed. Simple,
  universal, unpredictable, but non-ordered (poor B-tree index locality) [1, §5.4].
- **UUIDv7** — 48-bit big-endian Unix-ms timestamp, 4-bit version, 12-bit `rand_a`,
  2-bit variant, 62-bit `rand_b`. Time-ordered and drop-in compatible with v4
  storage, solving v4's index fragmentation [1, §5.7, Fig. 11].
- **UUIDv8** — *experimental / vendor-specific*. Only the version (bits 48–51) and
  variant (bits 64–65) are defined; the remaining **122 bits are
  implementation-specific**. RFC 9562 is explicit that "UUIDv8 is not a replacement
  for UUIDv4" and that "UUIDv8's uniqueness will be implementation specific and
  MUST NOT be assumed" [1, §5.8, Fig. 12].

A telling signal of the v8 gap: the ubiquitous `uuid` JavaScript package
deliberately ships **no `v8()` generator**, because "the RFC does not define a
creation algorithm for them" [17]. GenoID supplies precisely the algorithm the
RFC leaves open — a *portable, declarative* one for filling those 122 custom bits.

## 2. Sortable and structured identifiers

RFC 9562's Motivation section surveyed **16 prior implementations** while
preparing the standard: ULID, LexicalUUID, Snowflake, Flake, ShardingID, KSUID,
Elasticflake, FlakeID, Sonyflake, orderedUuid, COMBGUID, SID, pushID, XID,
ObjectID, and CUID [1, §2]. The space divides roughly as:

- **ULID** [2] — 48-bit ms timestamp + 80-bit randomness, Crockford Base32
  (no `I/L/O/U`), lexicographically sortable, with a monotonic variant that
  increments the random part within a millisecond.
- **KSUID** (Segment) [3] — 32-bit unsigned-second timestamp (custom epoch
  1400000000) + 128-bit randomness, 20 bytes; stable ordering for distributed logs.
- **Snowflake** (Twitter) [4] and derivatives (Sonyflake, Flake) — 64-bit
  `[timestamp | datacenter/worker | sequence]`; k-sortable and node-monotonic but
  clock-dependent and coordination-bearing.
- **TypeID** (Jetify) [5] — type-safe, K-sortable identifiers of the form
  `prefix_xxxx` built on a UUIDv7 payload; adds a typed prefix without leaving the
  UUID ecosystem.
- **xid** [6], **ObjectID** (MongoDB), **CUID** — shorter or alternative encodings
  optimised for readability/size.
- **COMBGUID** — a hybrid UUID + embedded timestamp to improve index locality
  (cited by RFC 9562 among the 16 surveyed) [1, §2].

Empirically, time-ordered IDs materially improve database behaviour versus random
v4: reduced B-tree page splits and WAL amplification in PostgreSQL/MySQL, with
reported inserts ~35% faster and ~22% smaller indexes at 10M rows, and Shopify
reporting ULID **halving INSERT duration** on a high-throughput MySQL table
[15,16]. Recent academic work compares UUIDv4/v7/ULID in distributed systems [12],
and a Kafka+PostgreSQL study benchmarks ULID vs UUIDv4/v7 [13].

**Takeaway:** the field has thoroughly explored *time-ordered* composition, but
almost exclusively with fixed, hand-coded layouts. None offers a *declarative*
framework for arbitrary multi-field v8 composition.

## 3. Steganographic / privacy-preserving UUIDs — closest prior art

**pg_uuid_v8** (ineron; PGXN 1.0.0, May 2026) [8] is the closest prior art. It is
a PostgreSQL C extension that generates UUIDs **v4-format-compliant** while
embedding an encrypted microsecond timestamp (XOR / AES-128 / AES-256) in the
random portion. The hidden timestamp is recoverable via `uuid_stego_extract_timestamp`
and indexable through a PostgreSQL functional index, giving efficient range
queries without exposing creation time — a performance/privacy trade-off resolved
by steganography rather than by v7's plain timestamp.

GenoID shares pg_uuid_v8's core instinct — *put useful structure inside a
standards-compliant UUID* — but differs in scope:

| | pg_uuid_v8 | GenoID |
|---|---|---|
| Form | v4-compatible steganographic | RFC 9562 **v8** (custom) |
| Layout | single fixed stego layout | **declarative** `V8Layout`/`V8Field` DSL |
| Multi-field | no | yes (timestamp, shard, counter, tenant, …) |
| Repair | n/a | **constraint-guided mutation as repair** |
| Packaging | Postgres extension (code-only) | portable TS lib + browser + Node + CI |

pg_uuid_v8 is valuable but code-only: it provides no composition framework, no
typed-field abstraction, and no GA-style operators. GenoID generalises the idea
into a framework.

## 4. Genetic algorithms and evolutionary computation

A genetic algorithm (GA) is a population-based optimiser applying **selection,
crossover, and mutation** inspired by natural selection [9]; surveyed comprehensively
as a general optimisation family [9,10,11]. GAs are used across science and
engineering, including recent LLM–EC synergies [arXiv:2505.15741].

**Gap (confirmed by search).** A literature survey (Semantic Scholar, arXiv,
OpenAlex, web) surfaces **no academic paper applying genetic or evolutionary
algorithms to UUID or identifier generation**. GenoID is therefore not a new GA
technique but the first application of GA-style operators to the *composition* of
v8 UUID payloads.

This is consistent with GenoID's own experimental findings (AGENTS.md §Research
findings): GA does **not** improve — and occasionally degrades — statistical
randomness (all ablation variants pass NIST; CSPRNG is the sole quality source).
GA's value here is **architectural**: pooling, parallelism, and structured data
embedding, not entropy enhancement.

## 5. High-throughput secure generation (CSPRNG pooling)

v4/v8 generation is bounded by the cost of drawing from the OS CSPRNG. Throughput
is recovered by **reusing a single CSPRNG source and amortising draws**: the Java
guidance is to reuse one `SecureRandom` instance rather than construct per call
[dev.to]; the Go `pscheid92/uuid` library reports **NewV4 (Pool) ≈ 17 ns vs 247 ns
stateless** via a pooled/batch API [14]. PostgreSQL 18 now ships a native
`uuidv7()` [18].

GenoID adopts the same pooling principle at the algorithm level: one CSPRNG call
yields **64 UUIDs' worth of bytes**, which are then composed via byte-level
crossover/mutation over the pooled buffer — combining pooling throughput with v8
composition flexibility. (Measured: GenoID ≈ 13.3M UUID/s vs v4 ≈ 7.3M/s on the
same Node harness; see the evaluation tables.)

## 6. Gap and contribution

Existing work covers (a) standardised time-ordered UUIDs (v7) and bespoke
sortable IDs (ULID, KSUID, Snowflake, TypeID), (b) one steganographic v8 extension
(pg_uuid_v8), and (c) GA as a general optimiser with **no** identifier application.
What is unaddressed is a **declarative, framework-level** approach to composing v8
UUIDs from **typed, constrained fields**, where GA-style crossover/mutation is
repurposed as **constraint repair** rather than as a randomness improver.

**GenoID contribution:**
1. A **declarative RFC 9562 v8 layout** (`V8Layout`/`V8Field`) describing typed,
   constrained fields (timestamp, shard, monotonic counter, tenant, …).
2. **Field-boundary crossover** over two independently pooled CSPRNG parents, so
   every child inherits valid field values regardless of which parent is selected.
3. **Constraint-guided mutation as repair** — invalid field values are repaired
   in place (O(k·8) per UUID) instead of rejected (64^k trials).
4. Validation: composition correctness (0 mismatches / 0 constraint violations over
   1.5M checks), collision/uniformity (0 collisions at 2M; max uniformity dev
   0.0053), NIST SP 800-22 (15/15 PASS on struct-dbkey / multitenant /
   eventsourcing), and deployability (browser + Node + multi-OS CI matrix).

## References

[1] K. Davis, B. Peabody, P. Leach, *Universally Unique IDentifiers (UUIDs)*,
    RFC 9562, IETF, May 2024. https://www.rfc-editor.org/rfc/rfc9562
[2] ULID specification. https://github.com/ulid/spec
[3] Segment, *KSUID*. https://github.com/segmentio/ksuid
[4] Twitter, *Snowflake*. https://github.com/twitter-archive/snowflake
[5] Jetify, *TypeID*. https://github.com/jetify-com/typeid
[6] rs, *xid*. https://github.com/rs/xid
[7] J. Nilsson, *The Cost of GUIDs as Primary Keys* (COMBGUID), InformIT, 2002
    (surveyed in [1, §2]).
[8] ineron, *pg_uuid_v8* — PostgreSQL extension for steganographic UUIDs,
    PGXN 1.0.0, 2026-05-28. https://github.com/ineron/pg_uuid_v8 ·
    https://pgxn.org/dist/pg_uuid_v8
[9] B. Alhijawi, A. Awajan, *Genetic algorithms: theory, genetic operators,
    solutions, and applications*, Evolutionary Intelligence 17, 1245–1256 (2024).
    https://link.springer.com/article/10.1007/s12065-023-00822-6
[10] T. Bäck, *Evolutionary Algorithms in Theory and Practice*, 1996.
[11] D. B. Fogel, *Evolutionary Computation: Towards a New Philosophy of Machine
     Intelligence*, 1995.
[12] arXiv:2509.08969, *A Comparative Analysis of Identifier Schemes: UUIDv4,
     UUIDv7 …*, Sep 2025. https://arxiv.org/abs/2509.08969
[13] nimakarimiank, *uids-comparison* (ULID/UUIDv4/v7 with Kafka + PostgreSQL).
     https://github.com/nimakarimiank/uids-comparison
[14] pscheid92/uuid (Go, RFC 9562) — V8 + high-throughput Pool/Batch APIs.
     https://pkg.go.dev/github.com/pscheid92/uuid
[15] Rich Dev Tools, *UUID v4 vs v7 vs ULID: What the Public Benchmarks Actually
     Show*, 2026-07-16. https://richdevtools.com/articles/backend/uuid-v7-performance-benchmarks
[16] remove.sh, *UUID v4 vs v7 vs ULID: Which Should You Use in 2026?*,
     2026-04-12. https://remove.sh/blog/uuid-v4-vs-v7-vs-ulid-how-to-choose-the-right-identifier-for-your-database
[17] uuidjs/uuid (JS) — notes v8 not provided as RFC defines no algorithm.
     https://github.com/uuidjs/uuid
[18] PostgreSQL 18, *UUID Functions* (`uuidv7()`).
     https://www.postgresql.org/docs/current/functions-uuid.html
