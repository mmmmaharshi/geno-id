import {
  benchRepeated,
  benchRepeatedAsync,
  birthdayBound50,
  collisionTest,
  collisionTestAsync,
} from "../../dist/bench-core.js"
type BenchStats = ReturnType<typeof benchRepeated>

// Local Welch t-test compare (port of scripts/significance.ts) so this Deno
// port has no dependency on the Node-only significance.ts module.
function meanOf(xs: number[]): number {
  return xs.reduce((a, b) => a + b, 0) / xs.length
}
function varianceOf(xs: number[]): number {
  const n = xs.length
  if (n < 2) return 0
  const m = meanOf(xs)
  return xs.reduce((a, x) => a + (x - m) ** 2, 0) / (n - 1)
}
function lgamma(x: number): number {
  if (x < 0.5) return Math.log(Math.PI / Math.sin(Math.PI * x)) - lgamma(1 - x)
  const y = x - 1
  let a = 0.99999999999980993
  const t = y + 7.5
  const LANCZOS = [
    676.5203681218851, -1259.1392167224028, 771.32342877765313,
    -176.61502916214059, 12.507343278686905, -0.13857109526572012,
    9.9843695780195716e-6, 1.5056327351493116e-7,
  ]
  for (let i = 1; i < 9; i++) a += LANCZOS[i - 1] / (y + i)
  return 0.5 * Math.log(2 * Math.PI) + (y + 0.5) * Math.log(t) - t + Math.log(a)
}
function betacf(x: number, a: number, b: number): number {
  const MAXIT = 200
  const EPS = 3e-12
  const FPMIN = 1e-300
  const qab = a + b
  const qap = a + 1
  const qam = a - 1
  let c = 1
  let d = 1 - (qab * x) / qap
  if (Math.abs(d) < FPMIN) d = FPMIN
  d = 1 / d
  let h = d
  for (let m = 1; m <= MAXIT; m++) {
    const m2 = 2 * m
    let aa = (m * (b - m) * x) / ((qam + m2) * (a + m2))
    d = 1 + aa * d
    if (Math.abs(d) < FPMIN) d = FPMIN
    c = 1 + aa / c
    if (Math.abs(c) < FPMIN) c = FPMIN
    d = 1 / d
    h *= d * c
    aa = (-(a + m) * (qab + m) * x) / ((a + m2) * (qap + m2))
    d = 1 + aa * d
    if (Math.abs(d) < FPMIN) d = FPMIN
    c = 1 + aa / c
    if (Math.abs(c) < FPMIN) c = FPMIN
    d = 1 / d
    const del = d * c
    h *= del
    if (Math.abs(del - 1) < EPS) break
  }
  return h
}
function betai(x: number, a: number, b: number): number {
  if (x <= 0) return 0
  if (x >= 1) return 1
  const pf =
    Math.exp(Math.log(x) * a + Math.log(1 - x) * b - lgamma(a) - lgamma(b) + lgamma(a + b)) / a
  return pf * betacf(x, a, b)
}
function studentTwoTailedP(t: number, df: number): number {
  return betai(df / (df + t * t), df / 2, 0.5)
}
function compareBench(a: BenchStats, b: BenchStats): {
  t: number
  df: number
  p: number
  d: number
} {
  const na = a.samples.length
  const nb = b.samples.length
  const ma = meanOf(a.samples)
  const mb = meanOf(b.samples)
  const va = varianceOf(a.samples)
  const vb = varianceOf(b.samples)
  if (va + vb === 0) return { t: 0, df: Math.max(1, na + nb - 2), p: 1, d: 0 }
  const se = Math.sqrt(va / na + vb / nb)
  const t = (ma - mb) / se
  const df = (va / na + vb / nb) ** 2 /
    ((va / na) ** 2 / (na - 1) + (vb / nb) ** 2 / (nb - 1))
  const pooled = Math.sqrt(
    ((na - 1) * va + (nb - 1) * vb) / (na + nb - 2),
  )
  const d = pooled === 0 ? 0 : (ma - mb) / pooled
  return { t, df, p: studentTwoTailedP(t, df), d }
}

import {
  genPgUuidV8,
  genUlid,
  genUlidV8,
  genKsuid,
  genSnowflake,
  extractRandomBits,
  TIMESTAMPED_FIXED,
} from "../baselines.ts"

const algo = (await import("../../dist/algo.js")) as {
  genV4Native: () => string
  genV7: () => string
  genMathRandom: () => string
  genHashUUID: () => Promise<string>
  genGenoID: () => string
  genStructuredGenoID: (l: unknown) => string
  DBKEY_LAYOUT: unknown
}
const { genV4Native, genV7, genMathRandom, genHashUUID, genGenoID, genStructuredGenoID, DBKEY_LAYOUT } = algo

function validateFormat(uuid: string, expectedVersionNibble: string): boolean {
  const re = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/
  if (!re.test(uuid)) {
    return false
  }
  const versionChar = uuid[14]
  const variantChar = uuid[19]
  return versionChar === expectedVersionNibble && "89ab".includes(variantChar)
}

function fmtStats(r: BenchStats): string {
  return `${r.mean.toFixed(0)} ± ${r.std.toFixed(0)} ops/sec (95% CI ${r.ci95[0].toFixed(
    0,
  )}–${r.ci95[1].toFixed(0)}, ${r.trials} trials)`
}

function printCompare(label: string, a: BenchStats, b: BenchStats): void {
  const r = compareBench(a, b)
  const delta = ((a.mean - b.mean) / b.mean) * 100
  console.log(
    `${label}: Δ=${delta.toFixed(1)}%, Welch t=${r.t.toFixed(2)}, p=${r.p.toFixed(
      4,
    )}, d=${r.d.toFixed(2)} (${r.p < 0.05 ? "SIGNIFICANT" : "not significant"})`,
  )
}

console.log("--- Format validation (10 samples each) ---")
for (let i = 0; i < 10; i++) {
  if (!validateFormat(genV4Native(), "4")) throw new Error("v4 format fail")
}
for (let i = 0; i < 10; i++) {
  if (!validateFormat(genV7(), "7")) throw new Error("v7 format fail")
}
for (let i = 0; i < 10; i++) {
  if (!validateFormat(genMathRandom(), "4"))
    throw new Error("mathrandom format fail")
}
console.log("v4, v7, math.random formats OK")
const hsample = await genHashUUID()
console.log("hash sample:", hsample, "valid:", validateFormat(hsample, "5"))

const nSync = 500_000
const nAsync = 50_000
const TRIALS = 10

console.log(`\n--- Speed benchmark (Deno ${Deno.version.deno}, V8, ${TRIALS} repeated trials) ---`)
const sV4 = benchRepeated(genV4Native, nSync, TRIALS)
console.log("crypto.randomUUID (v4):", fmtStats(sV4))
const sV7 = benchRepeated(genV7, nSync, TRIALS)
console.log("UUIDv7 (custom):", fmtStats(sV7))
const sMR = benchRepeated(genMathRandom, nSync, TRIALS)
console.log("Math.random (v4-format):", fmtStats(sMR))
const sHash = await benchRepeatedAsync(genHashUUID, nAsync, TRIALS)
console.log("SHA-256 hash-derived (async, batch=1000):", fmtStats(sHash))
const sGeno = benchRepeated(genGenoID, nSync, TRIALS)
console.log("GenoID (v8, GA-inspired, pooled):", fmtStats(sGeno))
console.log("  vs native v4:", `${(sV4.mean / sGeno.mean).toFixed(1)}x slower`)

console.log("\n--- Collision test ---")
const nColl = 2_000_000
console.log(
  `v4 native, n=${nColl}:`,
  collisionTest(genV4Native, nColl),
  "collisions",
)
console.log(`v7 custom, n=${nColl}:`, collisionTest(genV7, nColl), "collisions")
console.log(
  `Math.random, n=${nColl}:`,
  collisionTest(genMathRandom, nColl),
  "collisions",
)

const nCollHash = 50_000
console.log(
  `SHA-256 hash-derived, n=${nCollHash}:`,
  await collisionTestAsync(genHashUUID, nCollHash),
  "collisions",
)

console.log(
  `GenoID, n=${nColl}:`,
  collisionTest(genGenoID, nColl),
  "collisions",
)

// ---------- Uniformity validation ----------

interface UniformityResult {
  bitBalance: number
  chiSq: number
}

async function uniformityTest(
  genFn: () => Promise<string>,
  n: number,
  label: string,
): Promise<UniformityResult> {
  let onesCount = 0,
    totalBits = 0
  const byteHistogram: number[] = new Array(256).fill(0)
  for (let i = 0; i < n; i++) {
    const uuid = await genFn()
    const bytes = new Uint8Array(
      uuid
        .replaceAll(/-/g, "")
        .match(/.{2}/g)!
        .map((h) => Number.parseInt(h, 16)),
    )
    byteHistogram[bytes[0]]++
    for (const byte of bytes) {
      for (let b = 0; b < 8; b++) {
        if ((byte >> b) & 1) {
          onesCount++
        }
        totalBits++
      }
    }
  }
  const bitBalance = onesCount / totalBits
  const expected = n / 256
  let chiSq = 0
  for (const obs of byteHistogram) {
    chiSq += Math.pow(obs - expected, 2) / expected
  }
  console.log(
    `${label}: bit-balance=${bitBalance.toFixed(
      5,
    )} (expect 0.500), chi-sq(byte0, df=255)=${chiSq.toFixed(
      2,
    )} (crit@0.05=293.25, PASS=${chiSq < 293.25})`,
  )
  return { bitBalance, chiSq }
}

console.log("\n--- Uniformity validation ---")
await uniformityTest(async () => genV4Native(), 20_000, "v4 native")
await uniformityTest(async () => genGenoID(), 20_000, "GenoID (v8, GA-inspired, pooled)")

console.log("\n--- Theoretical n for 50% collision probability ---")
console.log("v4 (122 bits):", birthdayBound50(122).toExponential(3))
console.log("v7 random part (74 bits):", birthdayBound50(74).toExponential(3))
console.log("hash-derived (121 bits):", birthdayBound50(121).toExponential(3))
console.log("GenoID (122 bits):", birthdayBound50(122).toExponential(3))

// ---------- Baseline comparison (Phase A) ----------
// pg_uuid_v8 is the closest prior art (UUID v4-compatible steganographic timestamp).
// ULID / KSUID / Snowflake are the broader structured-ID landscape.

console.log(`\n--- Baseline throughput (Deno ${Deno.version.deno}, V8, ${TRIALS} repeated trials) ---`)
const sPg = benchRepeated(genPgUuidV8, nSync, TRIALS)
printRate("pg_uuid_v8 (steganographic v4, XOR)", sPg)
const sUlid = benchRepeated(genUlid, nSync, TRIALS)
printRate("ULID (26-char base32)", sUlid)
const sUlidV8 = benchRepeated(genUlidV8, nSync, TRIALS)
printRate("ULID-v8 (UUID-mapped)", sUlidV8)
const sKsuid = benchRepeated(genKsuid, nSync, TRIALS)
printRate("KSUID (27-char base62, 160-bit)", sKsuid)
const sSnow = benchRepeated(() => genSnowflake(), nSync, TRIALS)
printRate("Snowflake (64-bit int)", sSnow)

console.log("\n--- Statistical significance (Welch t-test, GenoID vs baselines) ---")
printCompare("GenoID vs v4", sGeno, sV4)
printCompare("GenoID vs v7", sGeno, sV7)
printCompare("GenoID vs pg_uuid_v8 (closest prior art)", sGeno, sPg)
printCompare("GenoID vs ULID-v8", sGeno, sUlidV8)
printCompare("GenoID vs Snowflake", sGeno, sSnow)

function printRate(label: string, r: BenchStats) {
  console.log(`${label}:`, fmtStats(r))
}

console.log("\n--- Baseline collision (UUID-shaped only, n=2M) ---")
console.log(`pg_uuid_v8, n=${nColl}:`, collisionTest(genPgUuidV8, nColl), "collisions")
console.log(`ULID-v8, n=${nColl}:`, collisionTest(genUlidV8, nColl), "collisions")

console.log("\n--- Baseline uniformity (random payload only, monobit) ---")
// Naive whole-UUID histograms are invalid for timestamped IDs (byte0 is a constant
// timestamp), so we measure ones-balance over the random payload bits instead.
function randomMonobit(
  fn: () => string,
  fixed: [number, number][],
  n: number,
  label: string,
): void {
  let ones = 0
  let total = 0
  for (let i = 0; i < n; i++) {
    const bits = extractRandomBits(fn(), fixed)
    for (const b of bits) ones += b
    total += bits.length
  }
  const balance = ones / total
  // 99.7% of the time (binomial, large n) balance stays within ~0.5 ± 0.011.
  const pass = Math.abs(balance - 0.5) < 0.02
  console.log(
    `${label}: random-bit-balance=${balance.toFixed(5)} (expect 0.500), PASS=${pass}`,
  )
}

await randomMonobit(genPgUuidV8, TIMESTAMPED_FIXED, 20_000, "pg_uuid_v8 (steganographic v4)")
await randomMonobit(genUlidV8, TIMESTAMPED_FIXED, 20_000, "ULID-v8 (UUID-mapped)")

// Exact (BigInt) large-scale collision test — memory-efficient vs full-string Set.
function collisionTestBigInt(fn: () => string, n: number): number {
  const set = new Set<bigint>()
  let collisions = 0
  for (let i = 0; i < n; i++) {
    const v = BigInt("0x" + fn().replaceAll("-", ""))
    if (set.has(v)) collisions++
    else set.add(v)
  }
  return collisions
}

console.log("\n--- Large-scale collision (n=10M, exact BigInt) ---")
const nLarge = 10_000_000
console.log(`v4 native, n=${nLarge}:`, collisionTestBigInt(genV4Native, nLarge), "collisions")
console.log(`GenoID, n=${nLarge}:`, collisionTestBigInt(genGenoID, nLarge), "collisions")
console.log(`v7 (RFC 9562), n=${nLarge}:`, collisionTestBigInt(genV7, nLarge), "collisions")
console.log(
  `GenoID-structured (dbkey), n=${nLarge}:`,
  collisionTestBigInt(() => genStructuredGenoID(DBKEY_LAYOUT), nLarge),
  "collisions",
)
console.log(`pg_uuid_v8, n=${nLarge}:`, collisionTestBigInt(genPgUuidV8, nLarge), "collisions")
console.log(`ULID-v8, n=${nLarge}:`, collisionTestBigInt(genUlidV8, nLarge), "collisions")

// Non-UUID-shaped IDs (ULID/KSUID are base32/base62 strings, Snowflake is a
// 64-bit int) use the canonical string-Set collisionTest (not the hex-BigInt
// path, which only applies to 128-bit UUIDs).
console.log("\n--- Baseline collision (non-UUID-shaped, n=2M, exact string Set) ---")
console.log(`ULID, n=${nColl}:`, collisionTest(genUlid, nColl), "collisions")
console.log(`KSUID, n=${nColl}:`, collisionTest(genKsuid, nColl), "collisions")
console.log(
  `Snowflake, n=${nColl}:`,
  collisionTest(() => genSnowflake(), nColl),
  "collisions",
)
