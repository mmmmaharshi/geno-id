// Pure computation core for the in-house NIST-style randomness battery. Shared
// by `stats.ts` (orchestrator) and `stats-worker.ts` (one battery per CPU core).
// No DOM, no I/O beyond the imported generator module.

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
    out[i] = (hexVal(s.codePointAt(idx)!) << 4) | hexVal(s.codePointAt(idx + 1)!)
  }
  return out
}

export const STANDARD_FREE_MASK = [
  0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0x0f, 0xff, 0x3f, 0xff, 0xff, 0xff, 0xff,
  0xff, 0xff, 0xff,
]
export const V7_FREE_MASK = [
  0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x0f, 0xff, 0x3f, 0xff, 0xff, 0xff, 0xff,
  0xff, 0xff, 0xff,
]

export function erfc(x: number): number {
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
  const z = ((chi2 / df) ** (1 / 3) - (1 - 2 / (9 * df))) / Math.sqrt(2 / (9 * df))
  return 0.5 * erfc(z / Math.SQRT2)
}

export interface ChiResult {
  chi2: number
  crit05: number
  df: number
  k: number
  p: number
  pos: number
}

export interface CorrFlag {
  i: number
  j: number
  r: number
  z: number
}

export interface BatteryResult {
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

export async function runBattery(
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
    const uuid: string = isAsync ? await (fn() as Promise<string>) : (fn() as string)
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
      for (const j of activeBytes) if (j > i) sumprod[i * 16 + j] += bytes[i] * bytes[j]
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
