# Future: conference → journal

Status: conference version submitted and approved. This file tracks the push
to a journal submission (realistic venues per the Round-1 panel: JSS / IST / SQJ).

## Goal

A **substantial conference extension** (see `GLOSSARY.md`): the same artifact,
plus new methods, new evidence, and new analysis the conference version did
not have — with a dedicated "what's new since the conference version" section.

Almost all Round-1 blocking text/evidence defects are already closed on disk
(see `sources/peer-review-round1.md` for the original list). What remains is
predominantly *new research*, not fixes.

## Already banked (write the delta section from this)

- Bit-allocation planner with optimality frontier (`planBitAllocation`, Smith's rule)
- 10^8 field histogram with closed-form fibre prediction
- Production-path E1 (1.5M checks through `genStructuredGenoID`)
- RFC 9562 §6.2 monotonicity in both pooled and compiled paths
- Executable mutation matrix (off-by-one repair, frozen counter), CI-gated
- Nine-environment benchmark matrix + consolidated artifact
- Rust cross-language check with golden vectors
- Narrowed contribution claim + full related-work lineage (§7, bib 14–21)

## Research to fill (ranked)

### 1. Workload-driven layout planning end-to-end — DONE (flagship)
Was: `paper.tex` admitted nothing infers the field weights from a workload.
Closed: `inferWorkload` + `bench-workload.ts` + 4.7x SQLite win + PG parity +
convergence proof. Remaining polish: region-range measurement on the flipped
mix is parity-by-construction; no further work unless reviewers ask for more mixes.

### 2. Native DB experiments — DONE (podman locally + CI service containers)
Ran the committed harness against PostgreSQL~18 + MySQL~8/InnoDB in podman
(plus embedded PG via PGlite in the workload loop): PG structured +31% /
shardfirst +20% vs v7 inserts, MySQL shardfirst +24%, lookups at parity.
Reversal withdrawn — old tracked run agrees (shardfirst +22%).
CI `native-db` job re-runs this on every main push via service containers.

### 3. Microshard head-to-head — DONE (bit-exact mirror + SQLite bench)
Harnessed microshard-uuid v1.0.0 via a bit-exact TS mirror (cross-checked
field-for-field against the Python lib). Tenant prune 1.3x (borderline),
points/inserts parity, throughput 16x (BigInt mirror cost),
frozen-tick 2M burst 33 vs 0 (matches n^2/2*2^36). Paper \S~microshard.

### 4. Multi-stream NIST — DONE at 5 draws (draws 1-5: 123, 120, 123, 120, 122/123; 7 fails / 615 p-values = 1.1% vs 1% expected; no test fails twice on one layout except Spectral/multitenant 2/5, consistent with chance). Failed draws archived with provenance in results/nist-draws/. Full ≥100-stream guidance remains out of scope; the caveat now reads 5 streams, not 1.

### 5. Repair-distribution grid — DONE (24/24 cells, max dev 0.3pp)
Measured output frequencies across an (m, ℓ) grid via
`src/scripts/bench-repair-grid.ts`; every cell matches the closed-form fibre
sizes. Paper \S~uniformity + artifact-map row added. (Process note: the
first run failed every cell because of a hand-copied RNG with a dropped
xor-fold — the shared `mulberry32` import fixed it. Dogfooding worked.)

### 6. Node 24 / V8 v14 check — PREDICTION CONFIRMED on Node 26 (V8 14.6)
System node is v26.13.0 / V8 14.6: structured-vs-base ratio 0.65 vs the
paper's Node-22 0.12–0.16 — the boxed-BigInt penalty shrank from ~85% to
~35%. Needs a clean-machine re-run for citable numbers before the paper
claims it; current runs are load-contaminated (NIST battery in flight).

## Mechanical tail (no research)

- Mint the Zenodo DOI for the frozen tag; add to `CITATION.cff` + Availability.
- Cut the frozen release tag once 1–3 land.
- `results/all-results.json` materializes automatically on the next main CI run.

## Non-goals

- Retro-archiving the failed NIST draw (data gone; disclosed in-text instead).
- Rewriting the contribution claim again (already narrowed and audited).
- New baselines unless a reviewer names one (ULID/Snowflake/pg_uuid_v8 cover the space).
