# current_research — GenoID Research Anchor

Durable context for `ai-research-explore` candidate evaluation.

## Task family
Assess the research contribution of GenoID (GA-inspired RFC 9562 v8 UUID
algorithm) and select a defensible paper direction.

## Repo state (trusted lane)
- `algo.ts`: `genGenoID` (34-byte: two independent 16B parents + 2 control
  bytes for cut/mutPos, pooled batch of 256, crossover + mutation), RFC 9562 v8
  nibble `0x8`. Native baselines: v4 (`crypto.randomUUID`), v7, hash
  (SubtleCrypto), Math.random. `genRawV8` (16B CSPRNG, no GA) not exported.
- `bench-core.ts` / `scripts/bench.ts`: speed, collision, uniformity harness.
- `scripts/stats.ts`: in-house monobit/runs/chi-square/pairwise/entropy.
- `scripts/export-*.ts`: NIST sample exporters.
- `scripts/nist-bridge.py`: NIST SP 800-22 runner, `--file/--label/--json`.

## Evidence already collected (evaluation_source)
- CSPRNG ablation: v4, raw-v8, genoid-full, xonly, monly — all pass NIST SP
  800-22 (GA cosmetic on CSPRNG).
- Weak-entropy (Math.random, Xorshift128+): mr-raw, mr-genoid, mr-xonly,
  mr-monly — all pass at 1.22M bits (no failures to rescue; inconclusive
  scale).
- Controlled degradation (5 sources × raw+GA, 1.22M bits each):
  - biased P(1)=0.3: raw 12/32 fail, ga 11/35 fail (1 secondary rescued)
  - correl (XOR chain): raw 13/41, ga 12/41 (rescues 3, introduces 2)
  - restricted (0–127): raw 12/37, ga 13/35 (worsens)
  - periodic (4B XOR): raw 0/40, ga 6/40 (GA introduces failures)
  - lcg (glibc rand): raw 13/37, ga 12/37 (rescues 1, 12 core unchanged)
  - **Headline: GA cannot rescue degraded entropy; in 2/5 cases worsens it.**

## compute_budget
Local NIST runs complete. No further large-scale experiments required for
candidate ranking; paper-writing lane only.

## Explicit explore-lane authorization
User requested `ai-research-explore` load + research-gap narrowing.
