# GenoID Paper Plan (ICSE/FSE/ASE — Systems/SE)

Working title: **GenoID: A Declarative GA-Based Composition Framework for RFC 9562 v8 UUIDs**

Scope (decided): focused on Gap 1 (declarative v8 layout composition via crossover)
+ Gap 2 (constraint-guided mutation as repair). No steganographic gap; no
negative-result paper.

## Structure (§ by section)
1. **Abstract** — GA on UUIDs helps composition, not randomness; declarative v8
   layout + repair as the contribution.
2. **Intro / Motivation** — UUIDs are random blobs; applications need embedded
   structure (shard, tenant, monotonic counter) without giving up collision
   safety or CSPRNG security.
3. **Background** — RFC 9562 v8, prior art `pg_uuid_v8` (May 2026,
   steganographic XOR/AES timestamps, code-only, no framework). Our gap:
   declarative composition + constraint repair.
4. **Design** — `V8Layout`/`V8Field`, `validateLayout` (reserved-nibble guard),
   pooled parents, field-boundary crossover (`composeStructured`),
   constraint-guided mutation (`repairConstraints`).
5. **Experiments (E1–E6)**
   - E1 composition correctness (RQ1): 1.5M checks, 0 mismatches.
   - E2 repair vs rejection (RQ2): repairs ≈ k; rejection 64^k (k=6 → 6.9e10).
   - E3/E4/E5 collision + uniformity (RQ3): 0 collisions @2M; dev 0.0053; NIST
     SP 800-22 all 15 tests PASS (dbkey/multitenant/eventsourcing).
   - E6 throughput (RQ4): Node 19× slower than v4; browser 3× slower.
6. **Related work / Threats / Limitations**.

## Candidate tables / figures
- **Figure/Tbl A — Algorithm comparison** (from `benchmark_results.json`):
  v4, v7, SHA-256, Math.random, GenoID pool, GenoID-structured × speed +
  collisions.
- **Callout (Figure B) — Native baseline throughput**: explicit, labeled number
  shown in the browser UI (`index.html` #nativeCallout) and in
  `benchmark_results.json` rawLog:
  - Native `crypto.randomUUID` (v4) = ~1.6M ops/s in-browser.
  - GenoID pool = ~12.3M ops/s (7.5× faster than native v4).
  - GenoID-structured = ~0.53M ops/s (3.1× slower than native v4 in-browser).
  - Interpretation: native `crypto.randomUUID` is comparatively slow inside a JS
    engine, which *compresses* the apparent cost of the structured framework.
    This is a throughput observation, **not** a security/quality weakness of v4
    (v4 passes all NIST tests; its security class is "High"). Frame honestly.
- **Figure C — Repair-vs-rejection growth** (E2): GA linear in k vs 64^k.
- **Figure D — NIST SP 800-22 panel** for the three structured layouts.

## Honesty notes for writing
- Do NOT claim v4 is "weak" on security/randomness — only that it is slower
  in-browser. All algorithms pass NIST.
- Structured "entropy" column (50 random bits) understates true collision
  resistance (timestamp + shard + monotonic counter add far more); footnote it.
