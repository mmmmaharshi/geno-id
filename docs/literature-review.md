# Literature Review: Evolutionary Composition of Cryptographic UUIDs

**Angle:** Does evolutionary crossover/mutation improve CSPRNG randomness, and what prior art exists for structured RFC 9562 v8 UUID composition?

**Scope:** This review stress-tests two refutable claims of the GenoID project
(`AGENTS.md` research-findings table) against external literature:

- **C1 — "GA is architectural, not statistical."** The genetic-algorithm
  (crossover + mutation) layer over a CSPRNG does not improve — and sometimes
  degrades — statistical randomness; the CSPRNG is the sole source of quality.
- **C2 — Declarative v8 layout composition is the genuine contribution.**
  Embedding structured fields (tenant, shard, timestamp) inside a 128-bit UUID
  via constraint-guided mutation-as-repair is novel relative to prior art.

Internal evidence cited as ground truth: `scripts/export-ablation.ts`,
`scripts/bench-structured.ts`, `bench-core.ts:33` (`birthdayBound50`), and the
`AGENTS.md` findings table. External sources are marked `[n]`.

---

## 1. Outline

1. Genetic algorithms applied to random number generation
   1.1 GA as a PRNG *design* tool (evolving generators)
   1.2 GA as a PRNG *post-processor* (improving existing streams)
   1.3 Theoretical limit: operators cannot add entropy
2. Entropy and the CSPRNG guarantee
   2.1 Definition and next-bit test
   2.2 Post-processing stretches, never creates, entropy
   2.3 XOR mixing of independent sources
3. Statistical test batteries and their power at small samples
   3.1 NIST SP 800-22 and the Type II error
   3.2 Dieharder / TestU01 and sample-size requirements
   3.3 Why weak generators pass at 1.2M bits (GenoID's observation)
4. Structured and sortable identifiers: prior art
   4.1 RFC 9562 v8 as the experimental canvas
   4.2 UUID v7, ULID, KSUID, Snowflake, XID
   4.3 pg_uuid_v8: the closest prior art (steganographic timestamps)
   4.4 GenoID's declarative layout as a different contribution
5. Degraded-entropy rescue: a literature gap
6. Knowledge gaps and open questions

---

## 2. Per-section summaries

### 2.1 Genetic algorithms applied to random number generation

**GA as a PRNG design tool.** Evolutionary search has long been used to *evolve*
PRNGs rather than to post-process them. Barker's "Evolving More Random Number
Generators Using Genetic Programming" applies genetic programming to expression
trees that *are* candidate PRNGs [1]. The IEEE "Pseudorandom Number Generator
Generation Method with Genetic Programming" targets lightweight-device PRNGs by
evolving expressions for WISP-family sensors [2]. Alhussain (2015) reports that a
"deterministic genetic algorithm" improved the statistical quality (frequency,
runs, autocorrelation, entropy) of a conventional PRNG [3]. More recently, GAN-based
PRNGs are *trained* with a genetic algorithm acting as the optimizer over the
generator network (GAGAN, 2024) [4]. These works treat GA as a *generator
synthesis* mechanism — finding a good deterministic function — not as a
per-output refinement of an already-good CSPRNG.

**GA as a PRNG post-processor.** GenoID's actual mechanism is different: it takes
CSPRNG bytes, then applies crossover between two pooled parents plus byte-level
mutation to *compose* each UUID. The literature on using GA operators as a
per-sample transform over an already-random stream is sparse. The dominant GA
research concerns operator *efficiency* and *selection pressure*, not entropy
gain. Kneissl & Sudholt (2023/2026) prove that uniform crossover can *reduce the
cost of randomness* (random bits consumed) in evolutionary *algorithms*, but
explicitly measure compute cost, not output entropy [5]. The "Cost of Randomness"
result is about how many random bits an EA needs to run — orthogonal to whether
crossover changes the entropy of the bits it consumes.

**Theoretical limit.** Information theory is unambiguous: a deterministic
transformation cannot increase Shannon entropy [6]. Crossover and mutation are
deterministic given their random masks; they permute, select, and flip bits
already drawn from a source. If the source is a CSPRNG (next-bit unpredictable),
the output is at best as random as the source, never more. This is the formal
basis for C1. The GenoID ablation (`export-ablation.ts`: raw-v8 16B, full 34B,
xonly, monly) finding that *all variants pass NIST* and that GA "cannot be
assessed on weak entropy at 1.2M bits" is consistent with this: when the substrate
is already a CSPRNG, GA is entropy-neutral; when the substrate is weak
(Math.random / Xorshift128+), GA also cannot rescue it (see §2.5).

### 2.2 Entropy and the CSPRNG guarantee

**Definition.** A CSPRNG must satisfy the next-bit test: no polynomial-time
algorithm predicts the (k+1)-th bit from the first k bits with non-negligible
advantage [7]. CSPRNGs draw from an OS entropy pool (`/dev/urandom`,
`BCryptGenRandom`, `window.crypto.getRandomValues`) and "stretch" it via AES-CTR,
HMAC, or ChaCha20 [8]. The amount of randomness that can be generated is bounded
by the entropy provided: "the entropy that can be generated is equal to the
entropy provided by the system" [7].

**Post-processing stretches, never creates.** Entropy extractors condition raw
TRNG output for uniformity, but they are Information-Theoretically provable
*extractors* — they preserve, not amplify, min-entropy [9]. A CSPRNG "stretch"
available entropy over more bits [7]. Neither mechanism creates entropy from
nothing. GenoID's GA layer is a deterministic post-processor over CSPRNG output,
so by §2.1 it cannot increase the min-entropy per UUID below the CSPRNG's own
contribution. This directly supports C1's "CSPRNG is the sole source of quality."

**XOR mixing.** The one operation that *can* combine entropies is XOR of
*independent* sources: if one source is compromised, the other still protects the
output (one-time-pad analogy) [10][11]. GenoID does not use cross-source XOR
mixing; its "pool" is a single CSPRNG sampled into two parents for crossover. The
relevant prior art for *combining* randomness is entropy pooling (Linux
`drivers/char/random.c`), not GA recombination [10].

### 2.3 Statistical test batteries and their power at small samples

**NIST SP 800-22.** The suite's own documentation states a Type II error (β) —
accepting a bad generator as random — "is not a fixed value" and depends on the
specific non-randomness; "no set of statistical tests can absolutely certify a
generator" [12][13]. Tests recommend minimum sequence lengths (e.g. ≥1000 bits
general, ≈500 000+ for tests 13–14) [14]. At small n the test's power against
subtle deviations is low, so a weak generator can pass [15].

**Dieharder / TestU01.** These are stronger panels. Dieharder runs across
100–500 MB per pass; TestU01's Crush/BigCrush require millions of bits and report
extremely low p-values on subtle deviations [15]. TestU01 is more sensitive to
most-significant-bit flaws and needs bit-reversed re-testing for low-bit
applications [16]. Practitioners warn that "passing a single battery does not
prove randomness" and that false positives rise sharply across 20+ batteries
without multiple-testing correction [15].

**Why weak generators pass at 1.2M bits (GenoID's observation).** GenoID's
`AGENTS.md` records that Math.random (Xorshift128+) passes all 15 NIST tests at
1.22M bits, so "no failures to rescue" existed at that scale. This is exactly the
small-sample power limitation §2.3.1 predicts: Xorshill128+ is a strong
*non-cryptographic* PRNG; its deviations (linear complexity, matrix rank) only
become detectable at 100M+ bits, consistent with TestU01 guidance that Crush-class
power needs tens of millions of bits [15][16]. GenoID's own dieharder export uses
a 100M-bit (12.5 MB) sample precisely to escape this blind spot
(`scripts/run-dieharder.ts:17`, `scripts/export-dieharder.ts:3`). The repo's
finding that raw-v8 (16B CSPRNG) shows an *occasional* NIST false-positive
(binary_matrix_rank FAIL at p=0.001) while GenoID (34B) shows none is a
sample-size/rank-distribution artifact, not a GA quality effect — larger draws
avoid the low end of the rank distribution [AGENTS.md].

### 2.4 Structured and sortable identifiers: prior art

**RFC 9562 v8 as the experimental canvas.** RFC 9562 (May 2024) obsoletes RFC
4122 and adds v6/v7/v8 [17]. v8 is explicitly "for experimental or
vendor-specific use cases"; the only hard requirement is correct version/variant
bits, leaving 122 payload bits to the implementer [18]. RFC 9562 §6.4 even
recommends v8 for embedding a pseudorandom Node ID in distributed generation [18].
This is the standard-sanctioned space GenoID occupies.

**UUID v7, ULID, KSUID, Snowflake, XID.** v7 places a 48-bit Unix-ms timestamp in
the high bits for B-tree-friendly insertion, at the cost of exposing creation time
[17][19]. ULID (128-bit, 48-bit ms timestamp + 80-bit rand, Crockford Base32) and
KSUID (128-bit, 32-bit sec timestamp + 128-bit rand, Base62) are non-standard but
widely used sortable identifiers [20][21]. Snowflake (64-bit: 41-bit ts + worker
+ sequence) and XID (12-byte) add worker/shard coordination [21][22]. A useful
comparison of *effective random bits* (after subtracting time/version fields):
UUID v4 = 122, UUID v7 = 74, ULID = 80, KSUID = 128, NanoID = 126 [21]. GenoID's
structured mode deliberately sacrifices some random bits to embed fields, exactly
as v7/ULID do — but with *declarative* field definitions rather than a fixed
timestamp-first layout.

**pg_uuid_v8: the closest prior art.** pg_uuid_v8 (ineron, 2026) is a PostgreSQL C
extension generating "steganographic" UUIDs that *look like* v4 but embed an
encrypted microsecond timestamp (48 bits) via XOR/AES with a seed, enabling
functional-index range queries without exposing creation time [23][24]. Vérité
(2025) independently describes encrypting a v7 timestamp into a v4/v8 disguise
using XTEA [25]. Both are *timestamp-embedding* schemes. GenoID's contribution is
distinct: a *declarative* v8 layout (`V8Layout`/`V8Field` in `algo.ts`) with
constraint-guided mutation-as-repair, supporting arbitrary typed fields
(tenant, shard, dbkey, event-sourcing) and not limited to a single timestamp. No
academic "GA-for-UUID" paper exists [AGENTS.md]; pg_uuid_v8 is code-only with no
framework. This gap validates C2.

**Throughput tradeoff.** GenoID-structured runs ≈19× slower than v4 in Node and
≈3× slower in-browser (`AGENTS.md` RQ4). This is the expected cost of
composition: v7's timestamp prefix is cheaper than GenoID's pooled-crossover
repair. The trade is justified where structured fields are needed.

### 2.5 Degraded-entropy rescue: a literature gap

GenoID's `AGENTS.md` reports that across 5 controlled-degradation sources
(biased, correlation, range-restricted, periodic, LCG), GA **failed to fix any
core structural failure** and in 2 cases *worsened* quality. We searched for
contradicting literature — work showing evolutionary operators *rescuing* a bad
entropy source — and found none. The neighboring GA literature is about
*optimization* (Biased Random-Key GA for scheduling/routing/network design; 150+
paper review by Londe et al. 2025) [26][27], not entropy repair. The "GA improves
randomness" papers [1][3][4] evolve a *fresh* generator to be good, they do not
post-process a *fixed* degraded stream into a good one. The absence of
rescue literature, combined with the entropy ceiling of §2.2, strongly supports
GenoID's finding: GA is not a randomness improver. This is a genuine gap worth
stating as a refutable claim — if a future paper shows GA-based entropy rescue,
C1 would need revision.

---

## 3. Paper database

| # | Source | Method / Contribution | Limitation / Relevance to GenoID |
|---|--------|----------------------|----------------------------------|
| 1 | Barker, "Evolving More Random Number Generators Using Genetic Programming" [semantic scholar] | GP evolves expression trees that *are* PRNGs | Generator *synthesis*, not post-processing of a CSPRNG |
| 2 | "Pseudorandom Number Generator Generation Method with Genetic Programming" (IEEE) | GP for lightweight-device PRNGs (WISP) | Domain-specific; still design-time synthesis |
| 3 | Alhussain 2015, "Using Deterministic GA to Provide Secured Cryptographic PRNGs" | GA improved freq/runs/autocorr/entropy of a conventional PRNG | Weak statistical evidence; single PRNG; no entropy-source analysis |
| 4 | GAGAN 2024 (Springer Complex & Intelligent Systems) | GAN-based PRNG optimized by GA over generator params | GA trains the *network*, not a per-output transform |
| 5 | Kneissl & Sudholt 2023/2026, "Cost of Randomness in EAs" | Crossover can *reduce random bits consumed* by an EA | Measures compute cost, not output entropy |
| 6 | Shannon 1948; Wikipedia "Entropy (information theory)" | Deterministic transform cannot increase Shannon entropy | Formal basis for C1 |
| 7 | Wikipedia "CSPRNG"; Nakov "Secure Random Generators" | Next-bit test; entropy bounded by seed entropy | Defines the CSPRNG guarantee GenoID relies on |
| 8 | Dang et al. 2025 (TCHES), entropy extractors for TRNG | Info-theoretic extractors *preserve* min-entropy | Post-processing stretches, never creates entropy |
| 9 | crypto.stackexchange "Mixing Entropy Sources by XOR" [10]; Linux random.c discussion [11] | XOR of independent sources preserves security | GenoID uses pooling, not cross-source XOR |
| 10 | NIST SP 800-22 Rev 1a [12][13] | 15-test suite; β not fixed; tests can't certify | Small-sample power limitation → weak gens pass at 1.2M bits |
| 11 | techyorker 2026; de la Fraga 2025 (Springer) on Dieharder/TestU01 | Crush needs millions of bits; 20+ batteries need correction | Explains why Xorshift128+ passes NIST at 1.2M but not at 100M |
| 12 | Wikipedia TestU01/Diehard [16] | Crush/BigCrush sensitivity; bit-reversed re-test needed | Basis for GenoID's 100M-bit dieharder export |
| 13 | RFC 9562 (D. Davis et al., 2024) [17][18] | Standardizes v6/v7/v8; v8 = experimental 122-bit payload | The sanctioned canvas for GenoID |
| 14 | ULID / KSUID / Snowflake / XID comparisons [20][21][22] | Sortable IDs; effective-random-bit table | Prior art GenoID's structured mode generalizes |
| 15 | pg_uuid_v8 (ineron, 2026) [23][24]; Vérité 2025 [25] | Steganographic v8 timestamp embedding (XOR/AES/XTEA) | Closest prior art; timestamp-only, no declarative framework |
| 16 | Londe et al. 2025, "Biased Random-Key Genetic Algorithms: A Review" [26][27] | 150+ BRKGA papers; optimization focus | Shows GA literature is optimization, not entropy rescue |

---

## 4. Knowledge gaps

1. **GA-for-entropy rescue is unstudied.** No external paper shows evolutionary
   operators *repairing* a fixed degraded entropy stream. GenoID's negative
   finding (GA worsens 2/5 cases) has no contradicting precedent — a genuine gap
   and a refutable claim.
2. **Small-sample NIST false positives are under-quantified in practice.** NIST
   documents β theoretically [12] but few works report empirical false-positive
   rates at 1–1.2M bits for specific generators; GenoID's raw-v8 occasional
   `binary_matrix_rank` FAIL is a data point the field lacks.
3. **Declarative UUID composition has no academic treatment.** pg_uuid_v8 is
   code-only; no paper formalizes constraint-guided mutation-as-repair inside
   RFC 9562 v8. GenoID's `V8Layout`/`V8Field` is, to our knowledge, the first
   declarative framework — the core novel contribution (C2).
4. **Throughput-vs-structure tradeoff is benchmarked only informally.** GenoID's
   ≈19× Node / ≈3× browser slowdown (structured vs v4) needs comparison against
   pg_uuid_v8 and native v7 in a shared harness; no cross-implementation
   structured-UUID benchmark exists.
5. **34B vs 16B CSPRNG draw size** as a NIST-stability lever is observed
   internally but not studied as a general principle (rank-distribution low-end
   avoidance). Worth a controlled experiment.

---

## References

[1] Barker, "Evolving More Random Number Generators Using Genetic Programming."
    Semantic Scholar 8251c152057943bced4d147843be12e0f7c37e83.
[2] "The Pseudorandom Number Generator Generation Method with Genetic
    Programming." IEEE Xplore 8566484.
[3] A. H. Alhussain, "Using Deterministic Genetic Algorithm to Provide Secured
    Cryptographic Pseudorandom Number Generators." IJTESS 1(4), 2015,
    RePEc:apa:ijtess:2015:p:107-116.
[4] "GAN-based pseudo random number generation optimized through genetic
    algorithms (GAGAN)." Complex & Intelligent Systems, Springer, 2024,
    doi:10.1007/s40747-024-01606-w.
[5] C. Kneissl, D. Sudholt, "The Cost of Randomness in Evolutionary Algorithms:
    Crossover can Save Random Bits." EvoCOP 2023 / Evolutionary Computation
    2026;34(1):1–28, doi:10.1162/evco_a_00365.
[6] C. Shannon, "A Mathematical Theory of Communication." 1948; Wikipedia
    "Entropy (information theory)".
[7] Wikipedia "Cryptographically secure pseudorandom number generator";
    Nakov, "Secure Random Generators (CSPRNG)", Practical Cryptography.
[8] Dang et al., "Entropy extractor based high-throughput post-processings for
    True Random Number Generators." IACR TCHES 2025(4):145–171,
    doi:10.46586/tches.v2025.i4.145-171.
[9] crypto.stackexchange.com/q/17658 "Mixing Entropy Sources by XOR";
    Stack Overflow q/3429519 "Safe mixing of entropy sources" (Linux random.c).
[10] NIST SP 800-22 Rev 1a, "A Statistical Test Suite for RNGs and PRNGs for
     Cryptographic Applications." doi:10.6028/NIST.SP.800-22r1a.
[11] techyorker.com "Mysterious Sequences That Look Random" (2026);
    de la Fraga & Tlelo-Cuautle, "Statistical Tests for PRNGs," Springer 2025,
    doi:10.1007/978-3-031-82865-2_4.
[12] Wikipedia "TestU01" / "Diehard tests" (L'Ecuyer & Simard 2007; Marsaglia
    1995/1996).
[13] D. Davis et al., "Universally Unique IDentifiers (UUIDs)," RFC 9562, May
    2024, datatracker.ietf.org/doc/html/rfc9562.
[14] UUID comparison guides: guidsgenerator.com "GUID vs ULID vs KSUID vs
    SnowflakeID"; k-lab.dev ID decoder; dev.to "UUID v7, ULID, KSUID".
[15] ineron/pg_uuid_v8 (GitHub, 2026); pgxn.org/dist/pg_uuid_v8; dev.to
    "I Built UUIDs That Look Random But Sort Like Timestamps".
[16] D. Vérité, "Producing UUIDs Version 7 disguised as Version 4 (or 8),"
    PostgreSQL Notes, 2025-11-05.
[17] M. A. Londe, L. S. Pessoa, C. E. Andrade, M. G. C. Resende,
    "Biased random-key genetic algorithms: A review." EJOR 321(1):1–22, 2025,
    doi:10.1016/j.ejor.2024.03.030.
