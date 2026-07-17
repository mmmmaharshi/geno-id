import path from "node:path"

const __dirname = import.meta.dirname
const root = path.resolve(__dirname, "..")

interface AlgoModule {
  genV4Native: () => string
  genV7: () => string
  genMathRandom: () => string
  genHashUUID: () => Promise<string>
  genGenoID: () => string
}

const algo: AlgoModule = await import(path.resolve(root, "dist/algo.js"))
const { genV4Native, genV7, genMathRandom, genHashUUID, genGenoID } = algo

const HEX_STARTS = [0, 2, 4, 6, 9, 11, 14, 16, 19, 21, 24, 26, 28, 30, 32, 34]

function hexVal(c: number): number {
  if (c >= 48 && c <= 57) {
    return c - 48
  }
  if (c >= 97 && c <= 102) {
    return c - 87
  }
  return 0
}

function hexToBytes(s: string, out: Uint8Array): Uint8Array {
  for (let i = 0; i < 16; i++) {
    const idx = HEX_STARTS[i]
    out[i] =
      (hexVal(s.codePointAt(idx)!) << 4) | hexVal(s.codePointAt(idx + 1)!)
  }
  return out
}

const STANDARD_FREE_MASK = [
  0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0x0f, 0xff, 0x3f, 0xff, 0xff, 0xff, 0xff,
  0xff, 0xff, 0xff,
]
const V7_FREE_MASK = [
  0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x0f, 0xff, 0x3f, 0xff, 0xff, 0xff, 0xff,
  0xff, 0xff, 0xff,
]

function erfc(x: number): number {
  const z = Math.abs(x)
  const t = 1 / (1 + 0.5 * z)
  const ans =
    t *
    Math.exp(
      -z * z -
        1.26551223 +
        t *
          (1.00002368 +
            t *
              (0.37409196 +
                t *
                  (0.09678418 +
                    t *
                      (-0.18628806 +
                        t *
                          (0.27886807 +
                            t *
                              (-1.13520398 +
                                t *
                                  (1.48851587 +
                                    t * (-0.82215223 + t * 0.17087277)))))))),
    )
  return x >= 0 ? ans : 2 - ans
}

function chiSquareCriticalValue(df: number, alpha: number): number {
  const z = alpha === 0.05 ? 1.6448536 : 2.3263479
  const term = 1 - 2 / (9 * df) + z * Math.sqrt(2 / (9 * df))
  return df * term * term * term
}

function chiSquarePValueApprox(chi2: number, df: number): number {
  const z =
    ((chi2 / df) ** (1 / 3) - (1 - 2 / (9 * df))) / Math.sqrt(2 / (9 * df))
  return 0.5 * erfc(z / Math.SQRT2)
}

interface ChiResult {
  chi2: number
  crit05: number
  df: number
  k: number
  p: number
  pos: number
}

interface CorrFlag {
  i: number
  j: number
  r: number
  z: number
}

interface BatteryResult {
  avgByteEntropy: number
  chiResults: ChiResult[]
  corrFlags: CorrFlag[]
  monobitP: number
  n: number
  nBits: number
  name: string
  runsP: number | null
  runsSkipped: boolean
}

async function runBattery(
  name: string,
  fn: () => string | Promise<string>,
  isAsync: boolean,
  n: number,
  FREE_MASK: number[],
): Promise<BatteryResult> {
  let onesFree = 0,
    runsCount = 0,
    totalFreeBits = 0,
    prevBit = -1
  const activeBytes: number[] = []
  for (let i = 0; i < 16; i++) {
    if (FREE_MASK[i] !== 0x00) activeBytes.push(i)
  }

  const freqFull: (Float64Array | null)[] = []
  for (let i = 0; i < 16; i++) {
    freqFull.push(
      FREE_MASK[i] === 0x00
        ? null
        : new Float64Array(FREE_MASK[i] === 0xff ? 256 : FREE_MASK[i] + 1),
    )
  }

  const sum = new Float64Array(16)
  const sumsq = new Float64Array(16)
  const sumprod = new Float64Array(16 * 16)
  const bytes = new Uint8Array(16)

  for (let s = 0; s < n; s++) {
    const uuid: string = isAsync
      ? await (fn() as Promise<string>)
      : (fn() as string)
    hexToBytes(uuid, bytes)

    for (let i = 0; i < 16; i++) {
      const v = bytes[i]
      const free = v & FREE_MASK[i]
      for (let b = 0; b < 8; b++) {
        if (FREE_MASK[i] & (1 << b)) {
          const bit = (v >> b) & 1
          if (bit === 1) {
            onesFree++
          }
          totalFreeBits++
          if (prevBit !== -1 && bit !== prevBit) {
            runsCount++
          }
          prevBit = bit
        }
      }
      if (freqFull[i]) {
        freqFull[i]![free]++
      }
      sum[i] += v
      sumsq[i] += v * v
    }
    for (const i of activeBytes) {
      for (const j of activeBytes)
        if (j > i) sumprod[i * 16 + j] += bytes[i] * bytes[j]
    }
  }

  const nBits = totalFreeBits
  const S = 2 * onesFree - nBits
  const sObs = Math.abs(S) / Math.sqrt(nBits)
  const monobitP = erfc(sObs / Math.SQRT2)

  const pi = onesFree / nBits
  let runsP: number | null = null
  let runsSkipped = false
  if (Math.abs(pi - 0.5) >= 2 / Math.sqrt(nBits)) {
    runsSkipped = true
  } else {
    const vObs = runsCount + 1
    runsP = erfc(
      Math.abs(vObs - 2 * nBits * pi * (1 - pi)) /
        (2 * Math.sqrt(2 * nBits) * pi * (1 - pi)),
    )
  }

  const chiResults: ChiResult[] = []
  for (const i of activeBytes) {
    const k = freqFull[i]!.length
    const expected = n / k
    let chi2 = 0
    for (let c = 0; c < k; c++) {
      const d = freqFull[i]![c] - expected
      chi2 += (d * d) / expected
    }
    const df = k - 1
    chiResults.push({
      chi2,
      crit05: chiSquareCriticalValue(df, 0.05),
      df,
      k,
      p: chiSquarePValueApprox(chi2, df),
      pos: i,
    })
  }

  const corrFlags: CorrFlag[] = []
  const zThreshold = 3.5
  for (const i of activeBytes) {
    const meanI = sum[i] / n,
      varI = sumsq[i] / n - meanI * meanI
    for (const j of activeBytes) {
      if (j <= i) {
        continue
      }
      const meanJ = sum[j] / n,
        varJ = sumsq[j] / n - meanJ * meanJ
      const cov = sumprod[i * 16 + j] / n - meanI * meanJ
      const r = cov / Math.sqrt(varI * varJ)
      const z = r * Math.sqrt(n)
      if (Math.abs(z) > zThreshold) {
        corrFlags.push({ i, j, r, z })
      }
    }
  }

  let entropyCount = 0,
    entropySum = 0
  for (let i = 0; i < 16; i++) {
    if (FREE_MASK[i] !== 0xff) {
      continue
    }
    let H = 0
    for (let c = 0; c < 256; c++) {
      const p = freqFull[i]![c] / n
      if (p > 0) {
        H -= p * Math.log2(p)
      }
    }
    entropySum += H
    entropyCount++
  }
  const avgByteEntropy = entropySum / entropyCount

  return {
    avgByteEntropy,
    chiResults,
    corrFlags,
    monobitP,
    n,
    nBits,
    name,
    runsP,
    runsSkipped,
  }
}

function fmtP(p: number | null): string {
  return p === null ? "n/a" : p.toFixed(4)
}

console.log("=== Statistical randomness test suite ===")
console.log(
  "Free-bit mask excludes the 6 fixed version/variant bits: 122/128 bits tested per sample.\n",
)

const N_MAIN = 1_000_000
const N_LIGHT = 300_000
const N_ASYNC = 20_000

interface RunDef {
  async: boolean
  fn: () => string | Promise<string>
  label: string
  mask: number[]
  n: number
}

const runs: RunDef[] = [
  {
    async: false,
    fn: genGenoID,
    label: "GenoID (proposed, GA-inspired, v8)",
    mask: STANDARD_FREE_MASK,
    n: N_MAIN,
  },
  {
    async: false,
    fn: genV4Native,
    label: "crypto.randomUUID (v4)",
    mask: STANDARD_FREE_MASK,
    n: N_LIGHT,
  },
  {
    async: false,
    fn: genV7,
    label: "UUIDv7 (custom, RFC 9562)",
    mask: V7_FREE_MASK,
    n: N_LIGHT,
  },
  {
    async: false,
    fn: genMathRandom,
    label: "Math.random (v4-format)",
    mask: STANDARD_FREE_MASK,
    n: N_LIGHT,
  },
  {
    async: true,
    fn: genHashUUID,
    label: "SHA-256 hash-derived (v5-style)",
    mask: STANDARD_FREE_MASK,
    n: N_ASYNC,
  },
]

const results: BatteryResult[] = []
for (const r of runs) {
  console.log(`Running battery on ${r.label} (n=${r.n.toLocaleString()})...`)
  const res = await runBattery(r.label, r.fn, r.async, r.n, r.mask)
  results.push(res)
}

console.log(
  "\n--- Monobit (frequency) + Runs test, concatenated free-bit stream ---",
)
for (const res of results) {
  console.log(`${res.name}:`)
  console.log(`  free bits tested: ${res.nBits.toLocaleString()}`)
  console.log(
    `  monobit p-value: ${fmtP(res.monobitP)} ${
      res.monobitP >= 0.01 ? "PASS" : "FAIL"
    } (alpha=0.01)`,
  )
  console.log(
    `  runs p-value: ${
      res.runsSkipped
        ? "skipped (bit balance pre-test failed)"
        : fmtP(res.runsP) +
          " " +
          (res.runsP! >= 0.01 ? "PASS" : "FAIL") +
          " (alpha=0.01)"
    }`,
  )
}

console.log(
  "\n--- Per-byte-position chi-square uniformity (3 worst positions per algo) ---",
)
for (const res of results) {
  const failCount = res.chiResults.filter((c) => c.chi2 > c.crit05).length
  const failPositions = res.chiResults
    .filter((c) => c.chi2 > c.crit05)
    .map((c) => c.pos)
  const sorted = [...res.chiResults]
    .toSorted((a, b) => b.chi2 / b.df - a.chi2 / a.df)
    .slice(0, 3)
  console.log(
    `${res.name}: ${failCount}/${
      res.chiResults.length
    } positions fail at alpha=0.05 (positions: [${failPositions.join(",")}])`,
  )
  for (const c of sorted) {
    console.log(
      `  byte[${c.pos}] (df=${c.df}): chi2=${c.chi2.toFixed(
        2,
      )}, crit(a=0.05)=${c.crit05.toFixed(2)}, p=${fmtP(c.p)} ${
        c.chi2 <= c.crit05 ? "PASS" : "FAIL"
      }`,
    )
  }
}

console.log(
  "\n--- Pairwise byte-position correlation, GenoID only (flags |z|>3.5 across 120 pairs) ---",
)
const geno = results[0]
if (geno.corrFlags.length === 0) {
  console.log("  none flagged.")
} else {
  for (const f of geno.corrFlags) {
    console.log(
      "  byte[" +
        f.i +
        "] vs byte[" +
        f.j +
        "]: r=" +
        f.r.toFixed(4) +
        ", z=" +
        f.z.toFixed(2),
    )
  }
}

console.log(
  "\n--- Shannon entropy estimate, avg over fully-free bytes (max 8.0000 bits/byte) ---",
)
for (const res of results) {
  console.log(res.name + ": " + res.avgByteEntropy.toFixed(4) + " bits/byte")
}

console.log("\nDone.")
