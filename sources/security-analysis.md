# GenoID — Security Analysis

This document gives the formal security argument behind the "Security class"
labels used in the evaluation tables. It turns the per-field bit counts already
present in the implementation into an explicit **entropy budget**, defines an
**adversarial model**, and benchmarks GenoID against the security considerations
of **RFC 9562** (the UUID standard it extends). All claims are grounded in the
code in `algo.ts` and the published RFC.

> Scope note: statistical randomness (NIST SP 800-22) is a *necessary* but not
> *sufficient* condition for cryptographic security. NIST PASS means "looks like
> random noise"; it does **not** prove unpredictability under an adversary. This
> document addresses the adversarial side.

## 1. Threat model

| Threat | Capability | Goal |
|---|---|---|
| **Passive observer** | Collects ≤ N emitted UUIDs (no process access) | Distinguish GenoID from random; infer embedded structure; predict future values |
| **Distinguishing attack** | Same as passive, plus an oracle | Decide whether a given UUID came from GenoID vs a true CSPRNG |
| **State-compromise** | Reads process memory → recovers the in-process CSPRNG pool buffer | Predict *future* UUIDs until the next pool refill |
| **Backward-secrecy** | Reads current pool state | Recover *past* UUIDs |
| **Structure inference** | Holds one or more structured UUIDs | Read timestamp / shard / tenant / counter (by design, for routing) |

Key assumption: the **OS CSPRNG** (`crypto.getRandomValues`) is a reliable source
of randomness, matching RFC 9562 §8.1. GenoID seeds every pool refill from it.

## 2. Entropy accounting per field

Min-entropy is the *worst-case* bits an adversary cannot predict. Fixed bits
(version/variant) and **deterministic/observable** fields (timestamp, counter,
small-枚举 shard/tenant) contribute **zero** min-entropy — an adversary can read
or bound them.

| Generator | Bits | Field breakdown | Secret? | Min-entropy |
|---|---|---|---|---:|
| **v4** (`crypto.randomUUID`) | 128 | 122 random + 6 fixed (ver/var) | All random | **122** |
| **v7** (RFC 9562) | 128 | 48 ms-timestamp + 74 random + 6 fixed | Random only; timestamp public ±1 ms | **74** |
| **GenoID v8** (pooled) | 128 | 122 CSPRNG (pooled) + 6 fixed | All random | **122** |
| **GenoID-structured** (dbkey) | 128 | 48 ts + 8 shard(1..5) + 16 counter + 50 random + 6 fixed | Random only; ts/shard/counter visible | **50** |
| **ULID-v8** | 128 | 48 ts + 74 random + 6 fixed | Same as v7 | **74** |
| **pg_uuid_v8** | 128 | 48 ts *AES-encrypted* + 74 random + 6 fixed(v4) | Ts is ciphertext → indistinguishable from random | **up to 122** |
| **Math.random** | 128 | Xorshift128+ state | None — state fully reversible | **0** |

For dbkey: `128 − 48(ts) − 8(shard) − 16(counter) − 6(fixed) = 50` random bits.
The shard (domain 1..5) yields only ⌈log₂5⌉ ≈ 2.3 bits even of structure-info; the
counter is monotonic and thus predictable from ordering; the timestamp is public
to ±1 ms (same leak as v7). The 50 random bits are the only entropy an adversary
cannot strip.

## 3. Adversarial analysis

### 3.1 Passive observer / distinguishing attack

- **v4, GenoID v8, GenoID-structured (random portion):** the non-structured bits
  are drawn from a CSPRNG pool, so UUIDs are computationally indistinguishable
  from uniform random — exactly the RFC 9562 §8.1 guarantee. NIST SP 800-22
  (15/15 PASS on the structured layouts) is consistent with this.
- **Structured layouts leak structure by design.** A passive observer reading a
  dbkey UUID can recover the millisecond timestamp, the shard (enum 1..5), and
  the monotonic counter. This is **intended** (that is what makes the ID
  self-describing / routable) but it means structured UUIDs are *distinguishable*
  from random and reveal metadata. They are **not** a confidentiality mechanism.
- **pg_uuid_v8** is the strongest on this axis: its timestamp is AES-encrypted
  into the payload, so even the steganographic field is ciphertext to a passive
  observer — the full 122 bits look random (the "stealth" property).

### 3.2 State compromise (forward secrecy)

GenoID keeps a single in-process pool: `GENO_POOL_N = 256` (plain) / `STRUCT_POOL_N
= 256` (structured). On refill, `crypto.getRandomValues` repopulates all 256
entries, after which the pool is independent of prior state.

- **Consequence:** if an adversary reads the pool buffer, they can predict **up to
  256** future UUIDs (until the next refill), then the stream becomes
  unpredictable again. This is a bounded forward-secrecy window, **not** a total
  break.
- **v4 / hash-derived** have **no in-process pool** — each call fetches fresh
  entropy from the OS, so there is no pool buffer to steal. They offer strictly
  better forward secrecy than the pooled GenoID, at the cost of throughput (the
  whole point of pooling).
- This is the same trade-off the OS kernel itself makes (its own entropy pool is
  an in-kernel buffer); GenoID's 256-UUID window is far smaller than a typical
  OS CSPRNG pool epoch.

### 3.3 Backward secrecy

Past pool buffers are not retained (they are overwritten and GC-eligible on the
next refill). Knowing the current pool state does **not** recover past UUIDs.
So GenoID provides backward secrecy. The sole exception is **Math.random**
(Xorshift128+), whose entire generator state is recoverable from ~2 consecutive
outputs — no backward *or* forward secrecy.

### 3.4 Structure inference summary

| Field | Visible to observer | Risk |
|---|---|---|
| Timestamp (v7, struct) | Creation time ±1 ms | Metadata leak; RFC 9562 §8.2 warns against relying on generation-time secrecy |
| Shard / tenant (struct) | Small enum (e.g. 1..5) | Routing aid; trivially enumerable; **not a secret** by design |
| Counter (struct) | Monotonic sequence | Reveals event ordering / rate; not a secret |
| Random bits | — | Only true entropy |

## 4. RFC 9562 baseline comparison

RFC 9562 §8 ("Security Considerations") is the canonical baseline. Mapping:

| RFC 9562 finding | GenoID status |
|---|---|
| §8.1 v4 security depends on a reliable OS CSPRNG | **Met** — GenoID seeds every pool refill from `crypto.getRandomValues` |
| §8.2 v7 exposes generation time (±1 ms) | **Met / inherited** — GenoID-structured has the same timestamp leak; plain GenoID does not |
| §8.3 v8 is experimental; "uniqueness MUST NOT be assumed" (§5.8) | **Addressed** — GenoID supplies a *declarative v8 algorithm* (the RFC defines no creation algorithm), and uniqueness follows from CSPRNG quality, not from the v8 spec |
| PRNGs (e.g. `Math.random`) are unfit for UUID generation | **Confirmed** — Xorshift128+ state is recoverable; GenoID never uses a PRNG |
| Pool-based generation should document its forward-secrecy bound | **Documented here** — ≤ 256 UUIDs after pool-state theft |

## 5. Honest security-class reassessment

| Generator | Label | Caveat |
|---|---|---|
| v4 (`crypto.randomUUID`) | **High** | Standard UUID security (RFC 9562 §8.1); 122-bit min-entropy; no pool |
| v7 (RFC 9562) | **High\*** | Timestamp leakage acknowledged by RFC 9562 §8.2 |
| GenoID v8 (pooled) | **High** | Forward-secrecy caveat: ≤ 256 UUIDs predictable after pool-state theft; otherwise equivalent to v4 |
| GenoID-structured (dbkey) | **High** (composition framework) | 50-bit random min-entropy; structure (ts/shard/counter/tenant) leaks metadata **by design**; same pool caveat |
| pg_uuid_v8 | **High** | AES-encrypted timestamp is indistinguishable from random to a passive observer (stealth property) |
| SHA-256 hash-derived | **High** (slower) | 121-bit min-entropy; no pool; matches v4 security at higher cost |
| Math.random | **Insecure** | Xorshift128+ state fully reversible; 0-bit min-entropy |

**Bottom line:** the "High" label for GenoID is justified *for its CSPRNG
foundation* (identical to v4). The two honest caveats that the evaluation tables
must carry are (1) the **pool forward-secrecy window** (≤ 256 UUIDs) and (2) for
structured layouts, the **deliberate metadata leakage** (timestamp/shard/counter)
that makes them distinguishable from random and unsuitable as a confidentiality
primitive — consistent with RFC 9562's own warnings about v7-style timestamps.

## 6. Open caveats / future work

- **No formal reduction proof.** This analysis is entropy-bounding + adversarial
  reasoning, not a cryptographic reduction to a hardness assumption. Such a proof
  would require modelling the OS CSPRNG as a random oracle — out of scope.
- **Pool epoch length** (256 UUIDs) is a tunable constant; a deployment wanting
  tighter forward secrecy can lower `GENO_POOL_N` at a throughput cost.
- **Side channels** (timing of pool refill, memory snapshots) are not modelled
  beyond the state-compromise discussion above.
