# Future: conference → journal

Status: conference version submitted and approved. This file tracks the push
to a journal submission (realistic venues per the Round-1 panel: JSS / IST / SQJ).

## Goal

A **substantial conference extension** (see `CONTEXT.md`): the same artifact,
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

### 1. Workload-driven layout planning end-to-end (flagship, ~2–4 weeks)
`paper.tex` admits it: nothing infers the field weights from a workload.
Close the loop — take a real workload trace, infer weights, plan the layout
with `planBitAllocation`, measure the query win. This turns "compiler" from
an overclaim into the journal's headline new method. Scope the claim as "when
planning helps vs. hand layouts" so a negative result is still publishable.

### 2. Native DB experiments (~1 week + a server)
Harness committed (`scripts/bench-db-native.ts`), results zero. One
PostgreSQL + one MySQL/InnoDB run kills the "SQLite-only proxy" threat —
the most repeated reviewer objection.

### 3. Microshard head-to-head (~1 week)
Harness `microshard-uuid` on the same workload with the same metrics
(routing, locality, random-bit budget). Converts the weakest prose paragraph
into a table. Reviewers will have read microshard.

### 4. Multi-stream NIST + draw archive (~days of compute)
Draw-count logging now exists (`nist-full-battery.py`). Run ≥100 streams per
layout (NIST guidance), archive the anomalous draw properly. Replaces the
single-stream caveat with evidence.

### 5. Repair-distribution grid (~days)
Measure output frequencies across an (m, ℓ) grid; validate the fibre theorem
empirically beyond the shard case. Turns "proven but narrowly tested" into a result.

### 6. Node 24 / V8 v14 check (~hours)
Threats section predicts the V8 v14 patch fixes the Node repair penalty.
Verify it; a confirmed prediction is a finding.

## Mechanical tail (no research)

- Mint the Zenodo DOI for the frozen tag; add to `CITATION.cff` + Availability.
- Cut the frozen release tag once 1–3 land.
- `results/all-results.json` materializes automatically on the next main CI run.

## Non-goals

- Retro-archiving the failed NIST draw (data gone; disclosed in-text instead).
- Rewriting the contribution claim again (already narrowed and audited).
- New baselines unless a reviewer names one (ULID/Snowflake/pg_uuid_v8 cover the space).
