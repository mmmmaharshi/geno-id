# GenoID

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
- **Composition correctness (E1):** 1.5M structured-field checks → 0 mismatches,
  0 constraint violations.
- **Repair beats rejection (E2):** GA repairs/UUID ≈ k (linear, O(k·8) ops);
  naive rejection needs 64^k trials (k=6 → 6.9×10¹⁰).
- **Collision + uniformity safety (E3–E5):** 0 collisions in 2M UUIDs
  (50%-collision n ≈ 2.7×10¹⁸); uniformity max deviation 0.0053.
- **Statistical quality (NIST SP 800-22):** all 15 tests PASS for the dbkey,
  multitenant, and eventsourcing layouts.
- **Practical throughput (E6 + browser):** ≈0.53M structured UUIDs/s; only
  ~3× slower than native `crypto.randomUUID` in-browser (and the base GenoID
  pool is 7.5× faster than native v4).

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
