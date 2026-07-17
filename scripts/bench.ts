import path from "node:path"
import {
  benchSync,
  benchAsyncBatched,
  birthdayBound50,
  collisionTest,
  collisionTestAsync,
} from "../dist/bench-core.js"
import {
  genPgUuidV8,
  genUlid,
  genUlidV8,
  genKsuid,
  genSnowflake,
  extractRandomBits,
  TIMESTAMPED_FIXED,
} from "./baselines.ts"

const __dirname = import.meta.dirname
const root = path.resolve(__dirname, "..")

const algo = await import(path.resolve(root, "dist/algo.js"))
const { genV4Native, genV7, genMathRandom, genHashUUID, genGenoID } =
  algo as {
    genV4Native: () => string
    genV7: () => string
    genMathRandom: () => string
    genHashUUID: () => Promise<string>
    genGenoID: () => string
  }

function validateFormat(uuid: string, expectedVersionNibble: string): boolean {
  const re = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/
  if (!re.test(uuid)) {
    return false
  }
  const versionChar = uuid[14]
  const variantChar = uuid[19]
  return versionChar === expectedVersionNibble && "89ab".includes(variantChar)
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

console.log("\n--- Speed benchmark (Node v22, V8, single run) ---")
const rV4 = benchSync(genV4Native, nSync)
console.log(
  "crypto.randomUUID (v4):",
  rV4.opsPerSec.toFixed(0),
  "ops/sec,",
  ((rV4.elapsed / rV4.n) * 1000).toFixed(4),
  "us/op",
)

const rV7 = benchSync(genV7, nSync)
console.log(
  "UUIDv7 (custom):",
  rV7.opsPerSec.toFixed(0),
  "ops/sec,",
  ((rV7.elapsed / rV7.n) * 1000).toFixed(4),
  "us/op",
)

const rMR = benchSync(genMathRandom, nSync)
console.log(
  "Math.random (v4-format):",
  rMR.opsPerSec.toFixed(0),
  "ops/sec,",
  ((rMR.elapsed / rMR.n) * 1000).toFixed(4),
  "us/op",
)

const rHash = await benchAsyncBatched(genHashUUID, nAsync)
console.log(
  "SHA-256 hash-derived (async, batch=1000):",
  rHash.opsPerSec.toFixed(0),
  "ops/sec,",
  ((rHash.elapsed / rHash.n) * 1000).toFixed(4),
  "us/op",
)

const rGeno = benchSync(genGenoID, nSync)
console.log(
  "GenoID (v8, GA-inspired, pooled):",
  rGeno.opsPerSec.toFixed(0),
  "ops/sec,",
  ((rGeno.elapsed / rGeno.n) * 1000).toFixed(4),
  "us/op",
)
console.log(
  "  vs native v4:",
  `${(rV4.opsPerSec / rGeno.opsPerSec).toFixed(1)}x slower`,
)

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

console.log("\n--- Baseline throughput (Node v22, V8, single run) ---")
const rPg = benchSync(genPgUuidV8, nSync)
printRate("pg_uuid_v8 (steganographic v4, XOR)", rPg)
const rUlid = benchSync(genUlid, nSync)
printRate("ULID (26-char base32)", rUlid)
const rUlidV8 = benchSync(genUlidV8, nSync)
printRate("ULID-v8 (UUID-mapped)", rUlidV8)
const rKsuid = benchSync(genKsuid, nSync)
printRate("KSUID (27-char base62, 160-bit)", rKsuid)
const rSnow = benchSync(() => genSnowflake(), nSync)
printRate("Snowflake (64-bit int)", rSnow)

function printRate(label: string, r: { opsPerSec: number; elapsed: number; n: number }) {
  console.log(
    `${label}:`,
    r.opsPerSec.toFixed(0),
    "ops/sec,",
    ((r.elapsed / r.n) * 1000).toFixed(4),
    "us/op",
  )
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
console.log(`pg_uuid_v8, n=${nLarge}:`, collisionTestBigInt(genPgUuidV8, nLarge), "collisions")
console.log(`ULID-v8, n=${nLarge}:`, collisionTestBigInt(genUlidV8, nLarge), "collisions")
