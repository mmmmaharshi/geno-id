import path from "node:path"
import { pathToFileURL } from "node:url"

import {
  benchRepeated,
  benchRepeatedAsync,
  birthdayBound50,
  collisionTest,
  collisionTestAsync,
} from "../../dist/bench-core.js"
import { andBits, shiftRightBits } from "../shared/bitwise.ts"
import { need } from "../shared/need.ts"
import {
  TIMESTAMPED_FIXED,
  extractRandomBits,
  genKsuid,
  genPgUuidV8,
  genSnowflake,
  genUlid,
  genUlidV8,
} from "./baselines.ts"
import { compareBench } from "./significance.ts"

type BenchStats = ReturnType<typeof benchRepeated>

const __dirname = import.meta.dirname

const root = path.resolve(__dirname, "..", "..")

const algo = (await import(
  pathToFileURL(path.resolve(root, "dist/algo.js")).href
)) as {
  genV4Native: () => string

  genV7: () => string

  genMathRandom: () => string

  genHashUUID: () => Promise<string>

  genGenoID: () => string

  genStructuredGenoID: (l: unknown) => string

  DBKEY_LAYOUT: unknown
}

const {
  genV4Native,
  genV7,
  genMathRandom,
  genHashUUID,
  genGenoID,
  genStructuredGenoID,
  DBKEY_LAYOUT,
} = algo

const validateFormat = (
  uuid: string,
  expectedVersionNibble: string
): boolean => {
  const re = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/u

  if (!re.test(uuid)) {
    return false
  }

  const versionChar = uuid.charAt(14)

  const variantChar = uuid.charAt(19)

  return versionChar === expectedVersionNibble && "89ab".includes(variantChar)
}

const fmtStats = (r: BenchStats): string =>
  `${r.mean.toFixed(0)} ± ${r.std.toFixed(0)} ops/sec (95% CI ${r.ci95[0].toFixed(
    0
  )}–${r.ci95[1].toFixed(0)}, ${r.trials} trials)`

const printCompare = (label: string, a: BenchStats, b: BenchStats): void => {
  const r = compareBench(a, b)

  const delta = ((a.mean - b.mean) / b.mean) * 100

  let significance = "not significant"

  if (r.p < 0.05) {
    significance = "SIGNIFICANT"
  }

  console.log(
    `${label}: Δ=${delta.toFixed(1)}%, Welch t=${r.t.toFixed(2)}, p=${r.p.toFixed(
      4
    )}, d=${r.d.toFixed(2)} (${significance})`
  )
}

console.log("--- Format validation (10 samples each) ---")

for (let i = 0; i < 10; i += 1) {
  if (!validateFormat(genV4Native(), "4")) {
    throw new Error("v4 format fail")
  }
}

for (let i = 0; i < 10; i += 1) {
  if (!validateFormat(genV7(), "7")) {
    throw new Error("v7 format fail")
  }
}

for (let i = 0; i < 10; i += 1) {
  if (!validateFormat(genMathRandom(), "4")) {
    throw new Error("mathrandom format fail")
  }
}

console.log("v4, v7, math.random formats OK")

const hsample = await genHashUUID()

console.log("hash sample:", hsample, "valid:", validateFormat(hsample, "5"))

const nSync = 500_000

const nAsync = 50_000

const TRIALS = 10

console.log(
  `\n--- Speed benchmark (Node v22, V8, ${TRIALS} repeated trials) ---`
)

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

  "collisions"
)

console.log(`v7 custom, n=${nColl}:`, collisionTest(genV7, nColl), "collisions")

console.log(
  `Math.random, n=${nColl}:`,

  collisionTest(genMathRandom, nColl),

  "collisions"
)

const nCollHash = 50_000

console.log(
  `SHA-256 hash-derived, n=${nCollHash}:`,

  await collisionTestAsync(genHashUUID, nCollHash),

  "collisions"
)

console.log(
  `GenoID, n=${nColl}:`,

  collisionTest(genGenoID, nColl),

  "collisions"
)

// ---------- Uniformity validation ----------

interface UniformityResult {
  bitBalance: number

  chiSq: number
}

const uniformityTest = async (
  genFn: () => string | Promise<string>,

  n: number,

  label: string
): Promise<UniformityResult> => {
  let onesCount = 0,
    totalBits = 0

  const byteHistogram: number[] = Array.from<number>({ length: 256 }).fill(0)

  const collect = async (i: number): Promise<void> => {
    if (i >= n) {
      return
    }

    const uuid = await genFn()

    const matches = need(uuid.replaceAll("-", "").match(/.{2}/gu))

    const bytes = new Uint8Array(matches.map((h) => Number.parseInt(h, 16)))

    byteHistogram[bytes[0]] += 1

    for (const byte of bytes) {
      for (let b = 0; b < 8; b += 1) {
        if (andBits(shiftRightBits(byte, b), 1)) {
          onesCount += 1
        }

        totalBits += 1
      }
    }

    await collect(i + 1)
  }

  await collect(0)

  const bitBalance = onesCount / totalBits

  const expected = n / 256

  let chiSq = 0

  for (const obs of byteHistogram) {
    chiSq += (obs - expected) ** 2 / expected
  }

  console.log(
    `${label}: bit-balance=${bitBalance.toFixed(
      5
    )} (expect 0.500), chi-sq(byte0, df=255)=${chiSq.toFixed(
      2
    )} (crit@0.05=293.25, PASS=${chiSq < 293.25})`
  )

  return { bitBalance, chiSq }
}

console.log("\n--- Uniformity validation ---")

await uniformityTest(genV4Native, 20_000, "v4 native")

await uniformityTest(genGenoID, 20_000, "GenoID (v8, GA-inspired, pooled)")

console.log("\n--- Theoretical n for 50% collision probability ---")

console.log("v4 (122 bits):", birthdayBound50(122).toExponential(3))

console.log("v7 random part (74 bits):", birthdayBound50(74).toExponential(3))

console.log("hash-derived (121 bits):", birthdayBound50(121).toExponential(3))

console.log("GenoID (122 bits):", birthdayBound50(122).toExponential(3))

// ---------- Baseline comparison (Phase A) ----------

// Pg_uuid_v8 is the closest prior art (UUID v4-compatible steganographic timestamp).

// ULID / KSUID / Snowflake are the broader structured-ID landscape.

const printRate = (label: string, r: BenchStats): void => {
  console.log(`${label}:`, fmtStats(r))
}

console.log(
  `\n--- Baseline throughput (Node v22, V8, ${TRIALS} repeated trials) ---`
)

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

console.log(
  "\n--- Statistical significance (Welch t-test, GenoID vs baselines) ---"
)

printCompare("GenoID vs v4", sGeno, sV4)

printCompare("GenoID vs v7", sGeno, sV7)

printCompare("GenoID vs pg_uuid_v8 (closest prior art)", sGeno, sPg)

printCompare("GenoID vs ULID-v8", sGeno, sUlidV8)

printCompare("GenoID vs Snowflake", sGeno, sSnow)

console.log("\n--- Baseline collision (UUID-shaped only, n=2M) ---")

console.log(
  `pg_uuid_v8, n=${nColl}:`,
  collisionTest(genPgUuidV8, nColl),
  "collisions"
)

console.log(
  `ULID-v8, n=${nColl}:`,
  collisionTest(genUlidV8, nColl),
  "collisions"
)

console.log("\n--- Baseline uniformity (random payload only, monobit) ---")

// Naive whole-UUID histograms are invalid for timestamped IDs (byte0 is a constant

// Timestamp), so we measure ones-balance over the random payload bits instead.

const randomMonobit = (
  fn: () => string,

  fixed: [number, number][],

  n: number,

  label: string
): void => {
  let ones = 0

  let total = 0

  for (let i = 0; i < n; i += 1) {
    const bits = extractRandomBits(fn(), fixed)

    for (const b of bits) {
      ones += b
    }

    total += bits.length
  }

  const balance = ones / total

  // 99.7% of the time (binomial, large n) balance stays within ~0.5 ± 0.011.

  const pass = Math.abs(balance - 0.5) < 0.02

  console.log(
    `${label}: random-bit-balance=${balance.toFixed(5)} (expect 0.500), PASS=${pass}`
  )
}

randomMonobit(
  genPgUuidV8,
  TIMESTAMPED_FIXED,
  20_000,
  "pg_uuid_v8 (steganographic v4)"
)

randomMonobit(genUlidV8, TIMESTAMPED_FIXED, 20_000, "ULID-v8 (UUID-mapped)")

// Exact (BigInt) large-scale collision test — memory-efficient vs full-string Set.

const collisionTestBigInt = (fn: () => string, n: number): number => {
  const set = new Set<bigint>()

  let collisions = 0

  for (let i = 0; i < n; i += 1) {
    const v = BigInt(`0x${fn().replaceAll("-", "")}`)

    if (set.has(v)) {
      collisions += 1
    } else {
      set.add(v)
    }
  }

  return collisions
}

console.log("\n--- Large-scale collision (n=10M, exact BigInt) ---")

const nLarge = 10_000_000

console.log(
  `v4 native, n=${nLarge}:`,
  collisionTestBigInt(genV4Native, nLarge),
  "collisions"
)

console.log(
  `GenoID, n=${nLarge}:`,
  collisionTestBigInt(genGenoID, nLarge),
  "collisions"
)

console.log(
  `v7 (RFC 9562), n=${nLarge}:`,
  collisionTestBigInt(genV7, nLarge),
  "collisions"
)

console.log(
  `GenoID-structured (dbkey), n=${nLarge}:`,

  collisionTestBigInt(() => genStructuredGenoID(DBKEY_LAYOUT), nLarge),

  "collisions"
)

console.log(
  `pg_uuid_v8, n=${nLarge}:`,
  collisionTestBigInt(genPgUuidV8, nLarge),
  "collisions"
)

console.log(
  `ULID-v8, n=${nLarge}:`,
  collisionTestBigInt(genUlidV8, nLarge),
  "collisions"
)

// Non-UUID-shaped IDs (ULID/KSUID are base32/base62 strings, Snowflake is a

// 64-bit int) use the canonical string-Set collisionTest (not the hex-BigInt

// Path, which only applies to 128-bit UUIDs).

console.log(
  "\n--- Baseline collision (non-UUID-shaped, n=2M, exact string Set) ---"
)

console.log(`ULID, n=${nColl}:`, collisionTest(genUlid, nColl), "collisions")

console.log(`KSUID, n=${nColl}:`, collisionTest(genKsuid, nColl), "collisions")

console.log(
  `Snowflake, n=${nColl}:`,

  collisionTest(() => genSnowflake(), nColl),

  "collisions"
)
