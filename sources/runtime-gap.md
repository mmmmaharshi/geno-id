# Runtime performance gap: Bun vs Node.js

## Observation

`crypto.getRandomValues` — the sole CSPRNG source for UUID generators — is dramatically slower per call in Node.js than in Bun on the same hardware. This inflates the apparent cost of any generator that calls `getRandomValues` frequently.

## Data

GitHub Actions matrix (ubuntu-24.04, identical runner), mean of 10 repeated trials:

| Generator | `getRandomValues` calls/UUID | Bun 1.3.x | Node 22 | Node/Bun ratio |
|---|---:|---:|---:|---:|
| v4 (`crypto.randomUUID`) | 0 (native impl.) | 15.53M | 14.93M | 0.96× |
| genoid-v8 (pooled) | 0.0039 (1 call / 256 IDs) | 8.80M | 5.72M | 0.65× |
| snowflake (no CSPRNG) | 0 | 3.61M | 5.74M | 1.59× |
| v7 (custom) | 1 | 4.91M | 0.51M | **0.10×** |
| ulid | 1 | 0.61M | 0.21M | 0.34× |
| ulid-v8 | 1 | 1.29M | 0.23M | 0.18× |
| pg-uuid-v8 | 1 | 1.15M | 0.23M | 0.20× |
| ksuid | 1 | 0.42M | 0.15M | 0.36× |

### Analysis

**Zero-CSPRNN-call generators** (v4 native, snowflake) are effectively equal or faster on Node. Every generator that calls `crypto.getRandomValues` per UUID sees a 3–10× slowdown on Node. The pooled GenoID v8 (0.0039 calls/UUID) is only 1.5× slower.

The `crypto.randomUUID` native binding bypasses the JS-level `getRandomValues` overhead entirely — Node implements it as a direct C++ call. By contrast, Node's `crypto.getRandomValues` (even with `Buffer.allocUnsafe`) has measurable per-call overhead from the JS → C++ boundary, argument validation, and array-length checks.

### Implications

1. **Bun benchmarks inflate the apparent performance of CSPRNG-heavy generators** vs Node. A benchmark run on Bun alone is not representative of Node production deployments.
2. **The GenoID pool strategy is architecturally validated**: batching reduces `getRandomValues` calls from 1/UUID to 0.0039/UUID, collapsing the runtime gap from 10× to <2×.
3. **Snowflake is faster on Node** — it makes zero CSPRNG calls, so it avoids the boundary cost entirely and benefits from Node's faster general JS execution.

## Cross-environment consolidated table

All numbers = ops/sec, mean of 10 trials (95% CI within ±5%). Bun = Bun 1.3.x, Node = v22. CI runners = ubuntu-24.04, macOS-14, windows-2025.

| Generator | Ubuntu Bun | macOS Bun | Win Bun | Ubuntu Node 20 | Ubuntu Node 22 | Ubuntu Node 23 | Min–max spread |
|---|---:|---:|---:|---:|---:|---:|---:|
| v4-native | 15.53M | 16.33M | 12.62M | 13.59M | 14.93M | 13.57M | 1.3× |
| v7-custom | 4.91M | 4.41M | 3.29M | 0.41M | 0.51M | 0.39M | 12.6× |
| genoid-v8 | 8.80M | 15.47M | 6.62M | 6.20M | 5.72M | 6.49M | 2.7× |
| mathrandom | 0.66M | 0.72M | 0.45M | 0.50M | 0.48M | 0.51M | 1.6× |
| pg-uuid-v8 | 1.15M | 1.38M | 0.90M | 0.22M | 0.23M | 0.22M | 6.3× |
| ulid | 0.61M | 0.77M | 0.44M | 0.21M | 0.21M | 0.20M | 3.9× |
| ulid-v8 | 1.29M | 1.60M | 0.98M | 0.23M | 0.23M | 0.22M | 7.3× |
| ksuid | 0.42M | 0.47M | 0.30M | 0.15M | 0.16M | 0.15M | 3.1× |
| snowflake | 3.61M | 4.49M | 2.55M | 5.52M | 5.74M | 5.35M | 2.3× |

The spread column tells the story: generators that call `getRandomValues` per UUID (v7, ulid, ulid-v8, pg-uuid-v8) span 4–13× across environments. Pooled genoid-v8 and non-CSPRNG snowflake stay within 3×.

## Reproduction

```bash
# Full CI matrix (CI only, ~20 min)
git push origin main  # triggers .github/workflows/bench.yml

# Local single environment
bun run bench-ci      # ~30 s

# Cross-environment consolidated report
bun run ci-consolidate dist/  # merges all *-results.json in dist/
```
