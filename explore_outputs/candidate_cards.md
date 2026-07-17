# Candidate Idea Cards — GenoID Research Directions

Ranked per `ai-research-explore` idea-evaluation-framework.

Hard gates: baseline_gate != abandon; single_variable_fit >= 0.6;
interface_fit >= 0.5; patch_surface <= 0.7; dependency_drag <= 0.7;
eval_risk <= 0.6; short_run_feasibility != blocked.

A card FAILS if any hard gate fails. Soft dimensions tune priority only;
ranking is candidate-prioritization, not novelty proof.

---

## Candidate A — Architectural Framework for RFC 9562 v8 Composition
**Question:** Can GA-inspired crossover/mutation provide *architectural* value
for v8 UUID generation beyond raw CSPRNG, even if statistically cosmetic?

| Gate / Dimension | Score | Notes |
|---|---|---|
| baseline_gate | keep | working impl + ablation evidence |
| single_variable_fit | 0.70 | one clear question: architectural vs statistical value |
| interface_fit | 0.90 | fits algo.ts, bench.ts, NIST pipeline |
| patch_surface | 0.20 | paper-writing lane; minimal code |
| dependency_drag | 0.10 | no new deps |
| eval_risk | 0.20 | all evidence in hand |
| short_run_feasibility | feasible | data exists |
| expected_upside | HIGH | fills real gap (no v8 algorithm papers exist) |
| innovation_story_strength | MEDIUM | first-of-kind v8 architecture study |
| source_support_strength | MEDIUM | RFC 9562 is the only anchor; thin prior lit |

**HARD GATES: PASS**

---

## Candidate B — Negative Result: GA Cannot Rescue Degraded Entropy
**Question:** Can GA operations rescue weak/degraded entropy sources for UUID
generation?

| Gate / Dimension | Score | Notes |
|---|---|---|
| baseline_gate | keep | definitive experimental answer already obtained: NO |
| single_variable_fit | 0.80 | very crisp single-variable question |
| interface_fit | 0.90 | uses degradation sample suite |
| patch_surface | 0.20 | paper-writing lane |
| dependency_drag | 0.10 | no new deps |
| eval_risk | 0.15 | results already in hand |
| short_run_feasibility | feasible | data exists |
| expected_upside | MEDIUM-HIGH | surprising, clear, actionable message |
| innovation_story_strength | HIGH | counterintuitive, well-supported |
| source_support_strength | MEDIUM | needs GA-for-randomness lit contrast |

**HARD GATES: PASS**

---

## Candidate C — Repeatable v8 Validation Methodology
**Question:** What is a repeatable validation methodology for RFC 9562 v8 UUID
algorithms (NIST + crypto + collision + uniformity)?

| Gate / Dimension | Score | Notes |
|---|---|---|
| baseline_gate | keep | harness already built |
| single_variable_fit | 0.55 | borderline: methodology is multi-faceted |
| interface_fit | 0.90 | reuses all harness code |
| patch_surface | 0.20 | paper-writing lane |
| dependency_drag | 0.10 | no new deps |
| eval_risk | 0.20 | low |
| short_run_feasibility | feasible | |
| expected_upside | HIGH | useful to community |
| innovation_story_strength | MEDIUM | |

**HARD GATES: FLAG** — `single_variable_fit` (0.55) below 0.6 threshold.
Either tighten the framing (single variable = "validation completeness
score") to lift to >= 0.6, or treat as a sub-section of A rather than a
standalone paper.

---

## Candidate D — "GA for Entropy Gap" Rescue (original hypothesis)
**Question:** Does GA improve randomness of weak entropy sources?

| Gate / Dimension | Score | Notes |
|---|---|---|
| baseline_gate | **abandon** | experiment already run on 5 degraded sources; GA rescued 0 core failures, worsened 2/5 |

**HARD GATES: FAIL** — `baseline_gate = abandon`. Dropped. This is the
original motivating hypothesis, now refuted by our own data; it becomes
*evidence for* Candidate B, not a standalone direction.

---

## Recommendation
**User constraint (2026-07-17): no negative-result paper.** Therefore lead
with **Candidate A** (architectural framework) — this is the publication
vehicle. Candidate B's degradation/ablation evidence is retained but demoted
from headline contribution to *supporting* material inside A's validation
section (proves the design choice is principled, not a gimmick), never
framed as a negative-result paper.

Proposed A structure:
1. Propose GenoID as a pool-based RFC 9562 v8 composition framework
   (crossover + mutation over independent CSPRNG parents, structured control
   bytes, batch pooling).
2. CSPRNG ablation (raw-v8 vs full vs xonly vs monly): all pass NIST — shows
   the GA layer is a clean, stateless-preserving composition primitive.
3. (Supporting, not headline) Degradation study used to justify "rely on raw
   CSPRNG; GA is architectural, not a randomness fix" — presented as design
   rationale, not a standalone negative claim.
4. Conclusion: v8 UUID value is *architectural* (structure/pooling/
   embeddable fields); GenoID demonstrates a concrete, validated pattern.

Candidate C folds into §4 as the "validated against NIST + collision +
uniformity" methodology claim. Candidate B is demoted; Candidate D remains
dropped.

Guardrail: this ranking does not prove novelty or SOTA; a literature
contrast (RFC 9562, UUIDv7 papers, GA-for-randomness work) is still required
before submission.
