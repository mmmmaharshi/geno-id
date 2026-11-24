import {
  andBits,
  orBits,
  shiftLeftBits,
  shiftRightBits,
} from "../shared/bitwise.ts"

import { forEachSequential } from "./shared/sequence.ts"

import { need } from "../shared/need.ts"

import { nullValue } from "./shared/runtime-values.ts"

// Pure computation core for the in-house NIST-style randomness battery. Shared

// By `stats.ts` (orchestrator) and `stats-worker.ts` (one battery per CPU core).

// No DOM, no I/O beyond the imported generator module.

const HEX_STARTS = [0, 2, 4, 6, 9, 11, 14, 16, 19, 21, 24, 26, 28, 30, 32, 34]

const hexVal = (c: number): number => {
  if (c >= 48 && c <= 57) {
    return c - 48
  }

  if (c >= 97 && c <= 102) {
    return c - 87
  }

  return 0
}

const hexToBytes = (s: string, out: Uint8Array): Uint8Array => {
  for (let i = 0; i < 16; i += 1) {
    const idx = HEX_STARTS[i]

    const hi = hexVal(need(s.codePointAt(idx)))

    const lo = hexVal(need(s.codePointAt(idx + 1)))

    out[i] = orBits(shiftLeftBits(hi, 4), lo)
  }

  return out
}

export const STANDARD_FREE_MASK = [
  0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0x0F, 0xFF, 0x3F, 0xFF, 0xFF, 0xFF, 0xFF,

  0xFF, 0xFF, 0xFF,
]

export const V7_FREE_MASK = [
  0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x0F, 0xFF, 0x3F, 0xFF, 0xFF, 0xFF, 0xFF,

  0xFF, 0xFF, 0xFF,
]

// Config for one battery run — also the data contract sent to `stats-worker.ts`.

export interface RunDef {
  id: "genoid" | "v4" | "v7" | "mr" | "hash"

  label: string

  mask: number[]

  n: number
}

export const erfc = (x: number): number => {
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

  if (x >= 0) {
    return ans
  }

  return 2 - ans
}

const chiSquareCriticalValue = (df: number, alpha: number): number => {
  let z = 2.3263479

  if (alpha === 0.05) {
    z = 1.6448536
  }

  const term = 1 - 2 / (9 * df) + z * Math.sqrt(2 / (9 * df))

  return df * term * term * term
}

const chiSquarePValueApprox = (chi2: number, df: number): number => {
  const z =
    ((chi2 / df) ** (1 / 3) - (1 - 2 / (9 * df))) / Math.sqrt(2 / (9 * df))

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

interface SampleStats {
  freqFull: (Float64Array | null)[]

  onesFree: number

  prevBit: number

  runsCount: number

  sum: Float64Array

  sumprod: Float64Array

  sumsq: Float64Array

  totalFreeBits: number
}

const activeByteIndices = (freeMask: readonly number[]): number[] => {
  const activeBytes: number[] = []

  for (let i = 0; i < 16; i += 1) {
    if (freeMask[i] !== 0x00) {
      activeBytes.push(i)
    }
  }

  return activeBytes
}

const createSampleStats = (freeMask: readonly number[]): SampleStats => ({
  freqFull: Array.from({ length: 16 }, (_, index) => {
    const mask = freeMask[index]

    if (mask === 0x00) {
      return nullValue
    }

    let size = 256

    if (mask !== 0xFF) {
      size = mask + 1
    }

    return new Float64Array(size)
  }),

  onesFree: 0,

  prevBit: -1,

  runsCount: 0,

  sum: new Float64Array(16),

  sumprod: new Float64Array(16 * 16),

  sumsq: new Float64Array(16),

  totalFreeBits: 0,
})

const accumulateSample = (
  bytes: Uint8Array,

  freeMask: readonly number[],

  stats: SampleStats,
): void => {
  for (let i = 0; i < 16; i += 1) {
    const value = bytes[i]

    const free = andBits(value, freeMask[i])

    for (let b = 0; b < 8; b += 1) {
      if (andBits(freeMask[i], shiftLeftBits(1, b))) {
        const bit = andBits(shiftRightBits(value, b), 1)

        if (bit === 1) {
          stats.onesFree += 1
        }

        stats.totalFreeBits += 1

        if (stats.prevBit !== -1 && bit !== stats.prevBit) {
          stats.runsCount += 1
        }

        stats.prevBit = bit
      }
    }

    const frequencies = stats.freqFull[i]

    if (frequencies) {
      frequencies[free] += 1
    }

    stats.sum[i] += value

    stats.sumsq[i] += value * value
  }
}

const accumulateProducts = (
  bytes: Uint8Array,

  activeBytes: readonly number[],

  sumprod: Float64Array,
): void => {
  for (const i of activeBytes) {
    for (const j of activeBytes) {
      if (j > i) {
        sumprod[i * 16 + j] += bytes[i] * bytes[j]
      }
    }
  }
}

const collectSyncSamples = (
  n: number,

  fn: () => string | Promise<string>,

  consume: (uuid: string) => void,
): void => {
  for (let sample = 0; sample < n; sample += 1) {
    consume(fn() as string)
  }
}

const collectAsyncSamples = async (
  n: number,

  fn: () => string | Promise<string>,

  consume: (uuid: string) => void,
): Promise<void> => {
  await forEachSequential(n, async () => {
    consume(await fn())
  })
}

const runsStatistics = (
  onesFree: number,

  totalFreeBits: number,

  runsCount: number,
): { p: number | null; skipped: boolean } => {
  const pi = onesFree / totalFreeBits

  if (Math.abs(pi - 0.5) >= 2 / Math.sqrt(totalFreeBits)) {
    return { p: nullValue, skipped: true }
  }

  const observed = runsCount + 1

  return {
    p: erfc(
      Math.abs(observed - 2 * totalFreeBits * pi * (1 - pi)) /
        (2 * Math.sqrt(2 * totalFreeBits) * pi * (1 - pi)),
    ),

    skipped: false,
  }
}

const chiSquareResults = (
  activeBytes: readonly number[],

  freqFull: readonly (Float64Array | null)[],

  n: number,
): ChiResult[] => {
  const results: ChiResult[] = []

  for (const i of activeBytes) {
    const frequencies = need(freqFull[i])

    const k = frequencies.length

    const expected = n / k

    let chi2 = 0

    for (let c = 0; c < k; c += 1) {
      const delta = frequencies[c] - expected

      chi2 += (delta * delta) / expected
    }

    const df = k - 1

    results.push({
      chi2,

      crit05: chiSquareCriticalValue(df, 0.05),

      df,

      k,

      p: chiSquarePValueApprox(chi2, df),

      pos: i,
    })
  }

  return results
}

const correlationFlags = (
  activeBytes: readonly number[],

  sum: Float64Array,

  sumsq: Float64Array,

  sumprod: Float64Array,

  n: number,
): CorrFlag[] => {
  const flags: CorrFlag[] = []

  const zThreshold = 3.5

  for (const i of activeBytes) {
    const meanI = sum[i] / n

    const varI = sumsq[i] / n - meanI * meanI

    for (const j of activeBytes) {
      if (j > i) {
        const meanJ = sum[j] / n

        const varJ = sumsq[j] / n - meanJ * meanJ

        const covariance = sumprod[i * 16 + j] / n - meanI * meanJ

        const r = covariance / Math.sqrt(varI * varJ)

        const z = r * Math.sqrt(n)

        if (Math.abs(z) > zThreshold) {
          flags.push({ i, j, r, z })
        }
      }
    }
  }

  return flags
}

const averageByteEntropy = (
  freeMask: readonly number[],

  freqFull: readonly (Float64Array | null)[],

  n: number,
): number => {
  let entropyCount = 0

  let entropySum = 0

  for (let i = 0; i < 16; i += 1) {
    if (freeMask[i] === 0xFF) {
      const frequencies = need(freqFull[i])

      let entropy = 0

      for (let c = 0; c < 256; c += 1) {
        const probability = frequencies[c] / n

        if (probability > 0) {
          entropy -= probability * Math.log2(probability)
        }
      }

      entropySum += entropy

      entropyCount += 1
    }
  }

  return entropySum / entropyCount
}

export const runBattery = async (
  name: string,

  fn: () => string | Promise<string>,

  isAsync: boolean,

  n: number,

  FREE_MASK: number[],
): Promise<BatteryResult> => {
  const activeBytes = activeByteIndices(FREE_MASK)

  const bytes = new Uint8Array(16)

  const stats = createSampleStats(FREE_MASK)

  const consume = (uuid: string): void => {
    hexToBytes(uuid, bytes)

    accumulateSample(bytes, FREE_MASK, stats)

    accumulateProducts(bytes, activeBytes, stats.sumprod)
  }

  if (isAsync) {
    await collectAsyncSamples(n, fn, consume)
  } else {
    collectSyncSamples(n, fn, consume)
  }

  const nBits = stats.totalFreeBits

  const S = 2 * stats.onesFree - nBits

  const sObs = Math.abs(S) / Math.sqrt(nBits)

  const monobitP = erfc(sObs / Math.SQRT2)

  const { p: runsP, skipped: runsSkipped } = runsStatistics(
    stats.onesFree,
    nBits,
    stats.runsCount,
  )

  return {
    avgByteEntropy: averageByteEntropy(FREE_MASK, stats.freqFull, n),

    chiResults: chiSquareResults(activeBytes, stats.freqFull, n),

    corrFlags: correlationFlags(
      activeBytes,
      stats.sum,
      stats.sumsq,
      stats.sumprod,
      n,
    ),

    monobitP,

    n,

    nBits,

    name,

    runsP,

    runsSkipped,
  }
}
