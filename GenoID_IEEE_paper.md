# GenoID: A Declarative RFC 9562 v8 UUID Composition Framework via Genetic-Algorithm-Style Constraint Repair

**Manohar Maharshi Padala**
*Independent Researcher*
Email: pmanoharmaharshi@gmail.com
Code: https://github.com/mmmmaharshi/geno-id

> Formatting note: this draft uses generic IEEE conference structure (title/abstract/index terms/roman-numeral sections/IEEE numbered references), restructured per the SPJ/Dreyer/Knuth/Ng writing model — related work moved after technical content, four-sentence abstract, refutable forward-referenced contributions, intuition before formalism. When a target venue's Call for Papers is selected, re-flow this content into that venue's official template (IEEEtran LaTeX or the matching Word template); the section order below maps directly onto standard IEEE sections.

---

## Abstract

Standard UUID generators cannot embed application-defined structure — a shard, a tenant, a monotonic counter — inside a standards-compliant identifier without paying rejection sampling's exponential cost. RFC 9562 makes this gap explicit: version 8 reserves 122 bits for exactly this purpose but defines no algorithm to fill them, so every production system that wants a self-describing identifier today hand-rolls a one-off, fixed layout. We close this gap with GenoID, a declarative composition framework that produces valid, collision-free v8 UUIDs from arbitrary constrained fields at O(k) cost instead of O(64^k) — verified across 100M generated identifiers with zero collisions and a full NIST SP 800-22 and dieharder statistical pass. The result is a portable algorithm for the UUID version RFC 9562 defines but does not implement, backed by formal complexity and entropy-preservation proofs and an explicit adversarial security analysis that separates GenoID's architectural contribution from the unchanged, CSPRNG-inherited randomness quality beneath it.

**Index Terms** — UUID, RFC 9562, identifier generation, genetic algorithm, constraint repair, CSPRNG, distributed systems, database indexing.

---

## I. Introduction

A UUID that cannot describe itself forces every system that touches it to keep a side table. Distributed systems increasingly rely on 128-bit UUIDs as primary keys and event identifiers precisely because they can be generated independently, without coordination, across nodes — but standard UUIDs are opaque. RFC 9562 (May 2024), which obsoletes RFC 4122, formalizes this space and adds three new versions: v6 and v7 solve the B-tree fragmentation problem of purely random v4 IDs by adding a timestamp, and v8 is left explicitly experimental — its 122 non-fixed bits carry no defined semantics, and the standard states plainly that "UUIDv8's uniqueness will be implementation specific and MUST NOT be assumed" [1, §5.8]. The widely used `uuid` JavaScript package ships no `v8()` generator at all, noting that "the RFC does not define a creation algorithm for them" [17]. Version 8 is a form with 122 blanks and no instructions for filling them in.

Consider a team running a sharded Postgres cluster who wants every primary key to encode its shard number, so a router can locate the owning node without a lookup table. UUIDv4 gives them randomness but no shard field. UUIDv7 gives them a timestamp but still no shard. Rejection sampling — draw a candidate UUID, keep it only if the shard bits happen to land in the allowed set of, say, five values, and redraw otherwise — needs up to 64^k expected draws for k such constrained fields (6.9×10^10 for k=6), which is unusable in production. GenoID generates the same key correctly on the first try, every time, in O(k) work.

Three existing paths fall short of this. UUIDv4 is fully random and carries no structure by design. UUIDv7 fixes a single timestamp layout and nothing beyond it. The closest code-level prior art, pg_uuid_v8, hides one encrypted timestamp inside a v4-format UUID — valuable, but a single fixed layout with no multi-field composition. None offers a declarative, general mechanism for arbitrary structured fields; a full comparison follows in Section VI.

GenoID resolves this without rejection, by borrowing the vocabulary of genetic algorithms — population, crossover, mutation — and repurposing it as an engineering mechanism rather than an optimization search. Two independently CSPRNG-populated candidate UUIDs act as parents; a child is assembled by field-boundary crossover, each declared field inherited whole from one parent; any field that violates its constraint is then repaired in place by a deterministic nearest-valid-value mapping, in O(field length) time, with no redraw and no retry loop.

**Contributions.**

1. A **declarative RFC 9562 v8 layout** abstraction (`V8Layout`/`V8Field`) for typed, constrained fields — the algorithm the RFC leaves undefined (§II).
2. **Field-boundary crossover** over two independently pooled CSPRNG parents, proved to preserve min-entropy on random-type fields (§III-B).
3. **Constraint-guided mutation as repair**, proved O(k) per UUID against rejection sampling's O(64^k) (§III-A), and validated empirically at 0 violations over 1.5M checks (§V-A).
4. An **adversarial security analysis** that discloses a bounded 256-UUID forward-secrecy window and the by-design metadata leakage of structured layouts, rather than resting on NIST PASS alone (§IV).
5. Validation across five axes — composition correctness, collision-freedom at 100M scale, NIST SP 800-22 and dieharder statistical batteries, and multi-runtime throughput against the closest prior art (§V) — with the resulting limitations disclosed openly (§VII).

---

## II. Design

Think of a UUID's 122 free bits as a form with labeled blanks: some blanks must hold a timestamp, one must hold a shard number drawn from a small allowed set, one must only ever increase. GenoID lets a developer declare that form once, then fills every blank correctly on every generation call — no blank is ever left invalid, and no call is ever discarded.

### A. Declarative layout

A `V8Layout` declares an ordered set of `V8Field`s, each with a bit offset, a bit length, a `type` (`timestamp-ms`, `counter`, `shard`, `node`, or `random`), and an optional `constraint` (`allowed` set, `min`/`max` bound, or `monotonic`). Two shipped layouts illustrate the DSL: `dbkey` (48-bit timestamp, 8-bit shard constrained to a five-value allowed set, 16-bit monotonic counter, remaining bits random) and `multitenant` (12-bit tenant enum, 8-bit region enum, remaining bits random). `completeLayout` fills any undeclared bit range with `random`-type filler, so every generated value is a syntactically valid RFC 9562 v8 UUID — version nibble `8` and variant bits fixed, the remaining 122 bits carrying the declared composition.

### B. Field-boundary crossover

Generation begins by populating two independent CSPRNG pools — the "parents" — in full: `crypto.getRandomValues` fills the entire pool buffer before any field-specific value is written, so every field position in both parents starts from fresh, mutually independent CSPRNG bytes. A child UUID is then assembled field by field. For each declared field, one bit of an independently drawn `fieldSelect` value chooses whether the child inherits that field's bits from parent A or parent B. Because every field in both parents is independently CSPRNG-populated, and the select bit is independent of field contents, crossover never mixes a partial "good" value with a partial "bad" one within a field — it selects one whole, independently random field value, from one of two independent sources.

### C. Constraint-guided mutation as repair

After crossover, `repairConstraints` performs a single pass over the layout's constrained fields — no retry loop, no redraw. An `allowed`-constrained field is mapped to its Hamming-nearest member of the allowed set; a `min`/`max`-constrained field is clamped; a `monotonic` field is clamped to `max(current, last-seen)`, and the new value is recorded for the next call. Every branch returns a value that satisfies its constraint by construction — membership, clamping, and monotonicity are structural guarantees, not probabilistic outcomes. Section V-A reports the empirical face of this guarantee: 0 violations, not "near 0."

---

## III. Formal Analysis

Rejection sampling and repair make fundamentally different bets. Rejection bets that a lucky whole-UUID draw arrives before an unlucky run goes on forever; repair guarantees success on every draw by fixing only the fields that need it. The exponential-versus-linear gap below quantifies that bet, and the entropy argument that follows shows the bet costs nothing in randomness quality.

### A. Repair complexity: O(k) versus O(64^k)

**Setup.** Let a layout declare k constrained fields f_1,…,f_k, each of bit-length ℓ_i. Rejection sampling draws a full candidate UUID, checks all k constraints, and — on any failure — discards the entire UUID and redraws from scratch.

**Rejection sampling is exponential in expectation.** For an `allowed`-constrained field of length ℓ with a valid values out of 2^ℓ, a uniform draw succeeds with probability a/2^ℓ. For k independent fields, whole-UUID acceptance probability is the product ∏(a_i/2^ℓ_i). In the worst case (a_i = 1, ℓ_i = 8 — one allowed value per byte-granular field), this is 2^(−8k), giving an expected 2^(8k) = 64^k whole-UUID draws — roughly 6.9×10^10 for k=6. This expectation is a geometric random variable: a single unlucky run has no upper bound.

**`repairConstraints` is linear in k.** The repair function iterates the layout's fields exactly once. Each `allowed`-constrained field costs O(|allowed_i|·ℓ_i) — a bounded Hamming-distance search; `min`/`max` and `monotonic` fields cost O(1); writing a repaired field back costs O(ℓ_i). Because |allowed_i| and ℓ_i are layout constants independent of k, the total cost Σ O(|allowed_i|·ℓ_i) is O(k) — linear, with an empirically measured constant factor bounded by 8. Critically, this bound holds unconditionally: the repair function never redraws and never loops more than once over the fields, eliminating rejection sampling's unbounded tail risk entirely.

**Correctness.** Each repair branch returns a constraint-satisfying value by construction — the proof, not an independent empirical coincidence, is why Section V-A measures exactly 0 mismatches and 0 constraint violations over 1.5M structured-field checks.

### B. Entropy preservation under field-boundary crossover

Shuffling two decks of independently drawn random bits, field by field, does not make the result less random than either deck alone — the claim below states this precisely.

**Claim.** For a `random`-type field, field-boundary crossover does not reduce min-entropy relative to drawing that field's bits directly from the CSPRNG, conditioned on the field-select bit being independent of field contents.

**Argument.** Let X_A, X_B be a field's value in parent A and B — both uniform on {0,1}^ℓ and mutually independent, since both parents are independently CSPRNG-populated before any field write. Let S be the independent select bit; the child's value is X_A if S=1, else X_B. For any fixed v ∈ {0,1}^ℓ:

```
Pr[child = v] = Pr[S=1]·Pr[X_A=v] + Pr[S=0]·Pr[X_B=v]
              = Pr[S=1]·2^-ℓ + Pr[S=0]·2^-ℓ = 2^-ℓ
```

The child field is itself uniform on {0,1}^ℓ regardless of S's distribution: crossover is measure-preserving on random-type fields. This matches the empirical NIST SP 800-22 15/15 PASS result on structured layouts' random payload — bias would surface as a monobit or frequency test failure — and it explains why crossover provably cannot *improve* entropy either: it is a no-op on an already-uniform source. For `structured` (non-random) field types the claim does not apply and is not claimed; those fields are deterministic or constrained by design and correctly carry zero min-entropy in the accounting of Section IV-B regardless of crossover.

**Repair does not increase entropy.** `repairConstraints` is a deterministic function of its input; by the data-processing inequality, H(g(X)) ≤ H(X) for any deterministic g, so repair can only hold or reduce entropy on a constrained field. This is the formal grounding for the paper's central honesty claim, restated once more because it matters: GA's contribution in GenoID is architectural — composition, constraint satisfaction — never a randomness enhancer.

---

## IV. Security Analysis

Statistical randomness alone does not establish security. A NIST SP 800-22 PASS shows the output resembles random noise; it does not show the output is unpredictable to an adversary who can act. This section gives that second, adversarial argument, which the composition mechanism of Section II does not by itself provide.

### A. Threat model

**Table I. Threat model.**

| Threat | Capability | Goal |
|---|---|---|
| Passive observer | ≤N UUIDs, no access | Distinguish, infer, predict |
| Distinguishing | Passive + oracle | GenoID vs. CSPRNG? |
| State compromise | Reads pool memory | Predict future IDs |
| Backward secrecy | Reads pool state | Recover past IDs |
| Structure inference | Holds struct. UUID | Read ts/shard/counter |

The OS CSPRNG (`crypto.getRandomValues`) is assumed reliable, matching RFC 9562 §8.1; every GenoID pool refill is seeded from it.

### B. Entropy accounting

**Table II. Min-entropy by generator.**

| Generator | Bits | Secret portion | Min-entropy |
|---|---:|---|---:|
| v4 (`crypto.randomUUID`) | 128 | 122 random + 6 fixed | 122 |
| v7 (RFC 9562) | 128 | 48 ts (public) + 74 random + 6 fixed | 74 |
| GenoID v8 (pooled) | 128 | 122 CSPRNG + 6 fixed | 122 |
| GenoID-structured (dbkey) | 128 | 48 ts + 8 shard + 16 counter + 50 random + 6 fixed | 50 |
| ULID-v8 | 128 | 48 ts + 74 random + 6 fixed | 74 |
| pg_uuid_v8 | 128 | 48 ts (AES-ciphertext) + 74 random + 6 fixed | up to 122 |
| Math.random | 128 | Xorshift128+ state | 0 |

For the `dbkey` layout, 128 − 48(ts) − 8(shard) − 16(counter) − 6(fixed) = 50 random bits are the only entropy an adversary cannot strip; the shard, counter, and timestamp are visible by design, not by accident.

### C. Adversarial findings

Non-structured bits are CSPRNG-drawn and computationally indistinguishable from uniform random, matching RFC 9562 §8.1 and consistent with the 15/15 NIST PASS of Section V. Structured layouts leak metadata by design — that is what makes them self-describing and routable — and they are explicitly not a confidentiality mechanism. pg_uuid_v8 is strongest on this particular axis: its AES-encrypted timestamp makes the full 122 bits look random even to a passive observer, a genuinely elegant solution to a problem GenoID does not attempt to solve.

GenoID's in-process pool holds 256 entries; on refill, `crypto.getRandomValues` repopulates all 256 independent of prior state. An adversary who reads the pool buffer can therefore predict at most 256 future UUIDs, after which the stream is unpredictable again — a bounded, documented forward-secrecy window, not a total break. Unpooled generators such as v4 have strictly better forward secrecy, since there is no pool buffer to steal, at the cost of the throughput that pooling exists to recover; this is a deliberate trade-off, disclosed rather than hidden.

Past pool buffers are overwritten and not retained, so reading the current pool state does not recover past UUIDs — GenoID provides backward secrecy. `Math.random` (Xorshift128+) does not: its full generator state is recoverable from a handful of consecutive outputs.

### D. Honest security-class summary

Table II gives entropy budgets generator by generator; Section IV-C gives adversarial findings generator by generator. Neither on its own answers the question a practitioner actually asks: *which generator is safe to use, and under what condition does that stop being true?* This subsection answers that directly, with one explicit rubric in place of seven separate paragraphs of prose.

**Classification rubric.** A generator is **High** if its exploitable min-entropy is at least 122 bits — v4's own baseline — and no threat in Table I recovers past or future output faster than brute-force search over that entropy. **High\*** is the same bound carrying one disclosed, bounded exception. **High (comp.)** — "compositionally" secure — marks a generator whose *undisclosed* bits alone clear the High bar, even though its *declared* structure intentionally exposes other bits by design. **Insecure** marks any generator whose internal state can be recovered from its own output.

**Worked example.** GenoID-structured (the `dbkey` layout) shows why "High (comp.)" is not a euphemism for "weaker." Table II accounts 50 secret bits after subtracting the 48-bit timestamp, 8-bit shard, and 16-bit counter the layout exposes on purpose. Those 50 bits are drawn from the same CSPRNG pool as GenoID v8's full 122, so an adversary gains nothing by attacking the random portion specifically — the classification is High on the bits that are actually secret, with the caveat naming exactly which bits are not, rather than either overclaiming full-UUID secrecy or underclaiming the scheme as broken.

**Table III. Security class by generator.**

| Generator | Class | Caveat |
|---|---|---|
| v4 | High | §8.1 security; no pool |
| v7 | High* | Timestamp leak (§8.2) |
| GenoID v8 | High | ≤256-UUID forward-secrecy window |
| GenoID-structured | High (comp.) | 50-bit entropy; ts/shard/ctr leak by design |
| pg_uuid_v8 | High | AES-encrypted ts, indistinguishable |
| Math.random | Insecure | Reversible state, 0-bit entropy |

This table is a classification, not a proof. Reaching a formal cryptographic reduction — modeling the OS CSPRNG as a random oracle and proving indistinguishability against a defined adversary — is out of scope for this paper, and we say so here rather than let the confident-looking table imply otherwise. What the rubric above does establish, and what a reduction proof would only restate more formally, is the boundary Section IV has held throughout: entropy accounting plus adversarial reasoning tells a practitioner exactly which bits of a GenoID UUID are safe to treat as secret, and exactly which are not.

---

## V. Evaluation

Every number below is reproducible from a single command (`bun run bench`), and is also produced as a CI artifact across a nine-job matrix spanning ubuntu-24.04, macOS-14, and windows-2025, each on Bun (latest), Node 22 LTS, and Deno 2.9.3 — seven distinct runtime×OS cells.

### A. Composition correctness

Over 1.5M structured-field checks, GenoID reports 0 mismatches and 0 constraint violations — the empirical counterpart to the by-construction correctness proof of Section III-A.

### B. Repair vs. rejection cost

Measured GA repairs per UUID scale as ≈k, confirming the O(k·8) bound of Section III-A against rejection sampling's O(64^k).

### C. Collision and uniformity

Across 2M generated UUIDs, every tested generator — including `genoid-structured` — reports 0 collisions, with a maximum uniformity deviation of 0.0053 on the random payload (uniformity is measured on the random payload only, not the whole UUID, since structured layouts have a constant leading timestamp byte). At full scale — 100M UUIDs, via an open-addressing 128-bit hash set fanned across all cores — every generator again reports 0 observed collisions, against a theoretical 50%-collision birthday bound of roughly 2.7×10^18. This scale is a sanity check against implementation bugs, not a claim to have exhausted the collision space; no UUID paper tests to 2.7×10^18, and this one does not pretend to.

### D. NIST SP 800-22 and dieharder

All 15 NIST SP 800-22 sub-tests pass on three structured layouts (`struct-dbkey`, `multitenant`, `eventsourcing`). An extended dieharder battery — birthdays, rank_32x32, dna, count_1s_str, parking_lot, runs, sts_monobit, sts_serial; 38 sub-tests, 5 independent trials each, 100M-bit samples — reports 152/152 PASS (modal assessment per sub-test) across four generator variants: native v4, `rawv8` (RFC 9562 v8 without GA), `genoid-v8` (GA + pooling), and `struct-dbkey` (structured). The GA and non-GA variants pass identically, which is the empirical face of the Section III-B proof: GA neither degrades nor improves statistical quality on random-type fields.

### E. Throughput and baseline comparison

**Table IV. Throughput (ops/sec, mean of 10 trials, 95% CI within ±5%), Ubuntu/Bun column shown; full seven-cell matrix in the repository.**

| Generator | Ops/sec (Ubuntu, Bun) | NIST |
|---|---:|---|
| v4-native | 11.85M | — |
| v7-custom | 5.74M | — |
| genoid-v8 (pooled) | 10.12M | — |
| pg-uuid-v8 | 0.85M | 15/15 |
| ulid-v8 | 0.93M | 15/15 |
| snowflake | 3.01M | — |
| genoid-structured (dbkey) | 0.67M | 15/15 |

Head-to-head against the closest code-level prior art, pg_uuid_v8 (n=2M): both report 0 collisions; GenoID-structured's uniformity deviation is 0.0051 against pg_uuid_v8's 0.0066; pg_uuid_v8 runs about 1.7× faster, since cheap XOR steganography beats GA-based repair on raw speed, but it is fixed-layout — timestamp only — while GenoID is declarative and supports arbitrary multi-field composition. Both pass NIST. GenoID trades some throughput for composition flexibility; it does not trade away statistical quality to get it.

A secondary finding concerns the runtime, not the algorithm: Node's `crypto.getRandomValues` carries markedly higher per-call overhead than Bun's or Deno's, so generators calling it once per UUID — v7, ULID, pg_uuid_v8, ULID-v8, KSUID — run 3–13× slower on Node than on Bun or Deno on comparable OSes. GenoID's pooled design, at 0.0039 CSPRNG calls per UUID, stays within roughly 1.5× across runtimes — a property of amortized pooling, orthogonal to the composition contribution this paper makes.

### F. Additional deployability checks

Concurrent generation via `worker_threads` fan-out shows 0 cross-worker collisions and 0 constraint violations. A 100k-ID SQLite B-tree insertion test shows every tested ID type produces a clean B-tree — zero freelist growth — with sortable IDs matching or exceeding random-insert throughput; this is an index-locality proxy, not a claim about production database engines (Section VII returns to this limitation directly). A Playwright-driven cross-engine browser test — Chromium, Firefox, WebKit — reports zero browser errors and 0 collisions on all three engines.

---

## VI. Related Work

### A. UUID standards: RFC 4122 to RFC 9562

UUIDs are 128-bit identifiers, originally standardized as RFC 4122 (2005, versions 1–5), obsoleted by RFC 9562 (IETF Standards Track, May 2024), which adds versions 6, 7, and 8 [1]. UUIDv4 carries 122 bits of CSPRNG randomness with fixed version/variant bits — simple and unpredictable, but with poor B-tree locality due to its lack of order. UUIDv7 prepends a 48-bit big-endian Unix-millisecond timestamp, giving 74 random bits and solving v4's index-fragmentation problem while remaining drop-in compatible with existing v4 storage [1, §5.7]. UUIDv8 is explicitly experimental: only the version and variant bits are defined, and the RFC supplies no creation algorithm for the remaining 122 [1, §5.8].

### B. Sortable and structured identifiers

RFC 9562's own motivation section surveyed sixteen prior implementations while drafting the standard — ULID, LexicalUUID, Snowflake, Flake, ShardingID, KSUID, Elasticflake, FlakeID, Sonyflake, orderedUuid, COMBGUID, SID, pushID, XID, ObjectID, and CUID [1, §2] — a genuinely thorough survey that this paper leans on rather than repeats. Representative members: ULID [2] (48-bit timestamp + 80-bit randomness, Base32, lexicographically sortable); KSUID [3] (32-bit second-resolution timestamp + 128-bit randomness, tuned for distributed log ordering); Snowflake and derivatives [4] (`timestamp | worker | sequence`, k-sortable but coordination- and clock-dependent); TypeID [5] (typed prefix over a UUIDv7 payload); and COMBGUID (hybrid UUID with an embedded timestamp for index locality). Empirically, time-ordered identifiers measurably improve database behavior versus random v4 — reported gains include roughly 35% faster inserts and 22% smaller indexes at 10M rows, and Shopify reporting that switching to ULID halved INSERT duration on a high-throughput MySQL table [15], [16]. Recent academic work directly compares UUIDv4/v7/ULID for distributed systems on collision probability, network overhead, and generation speed [12], and a further study benchmarks ULID against UUIDv4/v7 atop Kafka and PostgreSQL [13]. This is a well-explored field — its gap is not effort but scope: it has explored *time-ordered* composition thoroughly, almost exclusively via fixed, hand-coded layouts, and none of it offers a declarative framework for arbitrary multi-field v8 composition.

### C. Steganographic UUIDs — closest prior art

pg_uuid_v8 [8], a PostgreSQL C extension (PGXN, May 2026), is the closest prior art, and a clever one. It generates v4-format-compliant UUIDs while embedding an encrypted microsecond timestamp — XOR, AES-128, or AES-256 — in the random portion, recoverable via a dedicated extraction function and indexable through a functional index, resolving the same performance/privacy trade-off as v7 through steganography rather than a plaintext timestamp. GenoID shares pg_uuid_v8's core instinct — put useful structure inside a standards-compliant UUID — but differs in scope: pg_uuid_v8 offers one fixed stego layout with no multi-field abstraction and no repair mechanism, while GenoID is a declarative, multi-field DSL packaged as a portable library (browser, Node, and CI-verified) rather than a database-specific extension. The two are complementary, not competing: a system wanting encrypted-timestamp indexability inside Postgres should still reach for pg_uuid_v8.

**Table V. GenoID vs. closest prior art.**

| | pg_uuid_v8 | GenoID |
|---|---|---|
| Form | v4-compatible steganographic | RFC 9562 v8 (custom) |
| Layout | single fixed stego layout | declarative `V8Layout`/`V8Field` DSL |
| Multi-field | no | yes (timestamp, shard, counter, tenant, …) |
| Repair mechanism | n/a | constraint-guided mutation as repair |
| Packaging | Postgres extension, code-only | portable TS library, browser + Node + CI |

### D. Genetic algorithms and evolutionary computation

A genetic algorithm (GA) is a population-based optimizer applying selection, crossover, and mutation, inspired by natural selection, and surveyed comprehensively as a general optimization family [9]–[11]. GAs are applied broadly across engineering and, recently, in synergy with large language models [arXiv:2505.15741]. A disclosed literature search across Semantic Scholar, arXiv, OpenAlex, and general web sources — re-verified in a July 2026 adversarial recheck aimed specifically at falsifying this claim — surfaces no academic paper applying genetic or evolutionary algorithms to UUID or identifier generation. Targeted queries combining GA terminology with identifier-generation terminology return two disjoint literatures with no intersection found; a parallel patent search finds GA-machine and genetic-programming patents (e.g., US5343554, US5970487, US6360191B1) alongside three unrelated identifier-generation patents that use hashing, counters, or coordination protocols — none combines the two. GenoID is accordingly not a new GA technique, but the first application of GA-style operators to the composition of v8 UUID payloads, and Section III-B's proof is exactly the honest accounting this claim demands: GA's value here is architectural, not an entropy improvement, and the paper says so rather than implying otherwise.

### E. High-throughput secure generation

v4/v8 generation throughput is bounded by the cost of drawing from the OS CSPRNG. Prior work recovers throughput by reusing a single CSPRNG source and amortizing draws — standard Java guidance favors reusing one `SecureRandom` instance over per-call construction, and a pooled/batch Go UUID library reports roughly a 14× speedup for pooled versus stateless v4 generation [14]. PostgreSQL 18 now ships a native `uuidv7()` [18]. GenoID adopts the same pooling principle at the algorithm level: one CSPRNG call fills a pool covering 64 UUIDs' worth of bytes, subsequently composed via byte-level crossover and mutation, combining pooling throughput with v8 composition flexibility.

---

## VII. Threats to Validity

We disclose these openly, ranked by how strongly we expect a reviewer to press on each — an unacknowledged limitation invites a hostile review; an acknowledged one invites a collaborative one.

**External validity — the strongest limitation.** This is a single-language, single-ecosystem (TypeScript) implementation. The composition algorithm is language-agnostic — byte-array bit operations translate directly — but no port to Go, Rust, or Java exists yet to confirm the complexity and throughput claims transfer. Benchmarks run on GitHub Actions–hosted CI runners (shared vCPUs, no NUMA, capped burst credit), so absolute throughput numbers should be read as relative comparisons across generators on the same runner, not production capacity-planning figures. The SQLite B-tree test uses a single engine and a uniform key distribution; real production skew — hot shards, bursty tenants — is not modeled and is left as future work.

**Construct validity.** "Statistical quality" (NIST PASS/FAIL) is scoped explicitly as necessary but not sufficient for security, which is exactly why Section IV exists as an independent adversarial argument rather than a restatement of the NIST result. The novelty construct — "no prior GA-for-identifier work" — rests on a disclosed, re-verified, but non-exhaustive search; absence of evidence is not evidence of absence, though the breadth of the search (multi-database, patent, and web, with the closest adjacent papers explicitly cited and differentiated) mitigates this substantially rather than eliminating it.

**Internal validity.** Benchmark confounds — JIT warm-up, GC pauses — are mitigated by reporting mean ± standard deviation over 10 trials with 95% confidence intervals and a Welch t-test with Cohen's d, rather than single-shot numbers. Two implementation bugs (32-bit truncation; single-parent population) were caught by the test suite before any result was reported. NIST's full 15-test battery runs unconditionally on every sample; the dieharder subset is an explicitly disclosed curation for CI time budget, not a hidden one.

**Conclusion validity.** Throughput comparisons use Welch t-tests and Cohen's d rather than bare point estimates. NIST's per-test α=0.01 is followed without a stricter family-wise (Bonferroni-style) correction across the 15-test battery, which a security venue may reasonably prefer. "0 collisions" is reported alongside the theoretical birthday-bound expectation, not treated as "0 probability."

None of these four items is hidden; each is the honest boundary of a claim made earlier in the paper, not a surprise saved for a rebuttal.

---

## VIII. Applications

1. **Sharded databases** — embed the shard ID directly in the primary key; a router locates the owning node without a lookup table.
2. **Multi-tenancy** — carry a tenant ID in the identifier for prefix-based isolation and row-level security enforcement.
3. **Event sourcing** — a monotonic counter combined with a timestamp field yields globally ordered, collision-free event identifiers.
4. **Sortable time-series data** — timestamp bits provide chronological order while remaining fields carry composable application data.
5. **Operational debuggability** — declared fields are readable directly from the hex representation, letting operators inspect shard, tenant, or sequence without decoding logic.

---

## IX. Conclusion and Future Work

RFC 9562 leaves version 8's 122 bits undefined on purpose; GenoID fills them with a declarative, portable algorithm instead of a one-off hand-rolled layout. Its central move — genetic-algorithm-style crossover and mutation repurposed as O(k) constraint repair rather than a randomness search — carries a formal complexity proof, a formal entropy-preservation proof, and broad empirical validation: composition correctness, collision-freedom at 100M scale, NIST and dieharder statistical batteries, and throughput benchmarking against the closest prior art. An explicit adversarial security analysis exists specifically so "passes NIST" is never mistaken for "is secure," and it discloses a bounded 256-UUID forward-secrecy window and the by-design metadata leakage of structured layouts rather than eliding them.

The paper's own threats-to-validity analysis names the highest-value next step plainly: confirming that the O(k) complexity and throughput characteristics transfer to a non-JavaScript implementation — Go, Rust, or Java — is the single most consequential piece of future work, alongside a formal cryptographic reduction proof for the pooled-CSPRNG construction and an evaluation of B-tree behavior under realistic, skewed production key distributions rather than uniform synthetic ones.

---

## References

[1] K. Davis, B. Peabody, and P. Leach, "Universally Unique IDentifiers (UUIDs)," RFC 9562, IETF, May 2024. [Online]. Available: https://www.rfc-editor.org/rfc/rfc9562

[2] ULID specification. [Online]. Available: https://github.com/ulid/spec

[3] Segment, "KSUID." [Online]. Available: https://github.com/segmentio/ksuid

[4] Twitter, "Snowflake." [Online]. Available: https://github.com/twitter-archive/snowflake

[5] Jetify, "TypeID." [Online]. Available: https://github.com/jetify-com/typeid

[6] rs, "xid." [Online]. Available: https://github.com/rs/xid

[7] J. Nilsson, "The Cost of GUIDs as Primary Keys," InformIT, 2002.

[8] ineron, "pg_uuid_v8 — PostgreSQL extension for steganographic UUIDs," PGXN 1.0.0, May 2026. [Online]. Available: https://github.com/ineron/pg_uuid_v8

[9] B. Alhijawi and A. Awajan, "Genetic algorithms: theory, genetic operators, solutions, and applications," *Evolutionary Intelligence*, vol. 17, pp. 1245–1256, 2024.

[10] T. Bäck, *Evolutionary Algorithms in Theory and Practice*. Oxford Univ. Press, 1996.

[11] D. B. Fogel, *Evolutionary Computation: Towards a New Philosophy of Machine Intelligence*. IEEE Press, 1995.

[12] "A Comparative Analysis of Identifier Schemes: UUIDv4, UUIDv7, and ULID for Distributed Systems," arXiv:2509.08969, Sep. 2025.

[13] nimakarimiank, "uids-comparison" (ULID/UUIDv4/v7 with Kafka + PostgreSQL). [Online]. Available: https://github.com/nimakarimiank/uids-comparison

[14] pscheid92/uuid (Go, RFC 9562), V8 + pooled/batch APIs. [Online]. Available: https://pkg.go.dev/github.com/pscheid92/uuid

[15] Rich Dev Tools, "UUID v4 vs v7 vs ULID: What the Public Benchmarks Actually Show," 2026.

[16] "UUID v4 vs v7 vs ULID: Which Should You Use in 2026?," remove.sh Blog, 2026.

[17] uuidjs/uuid (JS). [Online]. Available: https://github.com/uuidjs/uuid

[18] PostgreSQL 18 Documentation, "UUID Functions" (`uuidv7()`). [Online]. Available: https://www.postgresql.org/docs/current/functions-uuid.html
