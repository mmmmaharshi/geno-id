import path from "node:path"
import { pathToFileURL } from "node:url"

import { andBits, shiftLeftBits, shiftRightBits } from "../shared/bitwise.ts"

const __dirname = import.meta.dirname

const root = path.resolve(__dirname, "..", "..")

const algo = (await import(
  pathToFileURL(path.resolve(root, "dist", "algo.js")).href
)) as {
  mutateChildBytes: (
    child: Uint8Array,
    mutPos: number,
    mixByte: number,
    useScramble: boolean
  ) => void
}

const { mutateChildBytes } = algo

const FREE_MASK = [
  0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0x0f, 0xff, 0x3f, 0xff, 0xff, 0xff, 0xff,
  0xff, 0xff, 0xff,
]

const ENTRY = 34

const CHUNK = 20_000

const N = 820_000

interface Acc {
  n: number
  ones: number
  runs: number
  last: number
  started: boolean
  posOnes: number[]
}

const fresh = (): Acc => ({
  last: 0,
  n: 0,
  ones: 0,
  posOnes: Array.from({ length: 122 }, () => 0),
  runs: 0,
  started: false,
})

const pushBit = (a: Acc, bit: number, pos: number): void => {
  a.n += 1
  a.ones += bit
  a.posOnes[pos] += bit
  if (!a.started || bit !== a.last) {
    a.runs += 1
    a.last = bit
    a.started = true
  }
}

const erf = (x: number): number => {
  const t = 1 / (1 + 0.3275911 * Math.abs(x))
  const y =
    1 -
    ((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) *
      t +
      0.254829592) *
      t *
      Math.exp(-x * x)
  return x >= 0 ? y : -y
}

const normP = (z: number): number => 1 - erf(Math.abs(z) / Math.SQRT2)

const report = (label: string, a: Acc): void => {
  const p = a.ones / a.n
  const zMono = (a.ones - a.n / 2) / Math.sqrt(a.n / 4)
  const expRuns = a.n / 2 + 1
  const sdRuns = Math.sqrt(a.n / 4)
  const zRuns = (a.runs - expRuns) / sdRuns
  let maxDev = 0
  for (const c of a.posOnes) {
    const d = Math.abs(c / (a.n / 122) - 0.5)
    if (d > maxDev) {
      maxDev = d
    }
  }
  console.log(
    `${label}: n=${a.n} ones=${p.toFixed(5)} monobitP=${normP(zMono).toFixed(4)} runsP=${normP(zRuns).toFixed(4)} maxPosDev=${maxDev.toFixed(5)}`
  )
}

const oldAcc = fresh()
const newAcc = fresh()
const child = new Uint8Array(16)
const pool = new Uint8Array(ENTRY * CHUNK)

for (let done = 0; done < N; done += CHUNK) {
  crypto.getRandomValues(pool)
  for (let i = 0; i < CHUNK; i += 1) {
    const off = i * ENTRY
    const cut = pool[off + 32] % 16
    const mutPos = pool[off + 33] % 16
    const mixByte = pool[off + ((mutPos + 1) % 16)]
    for (const [acc, useScramble] of [
      [oldAcc, false],
      [newAcc, true],
    ] as const) {
      let j = 0
      for (; j < cut; j += 1) {
        child[j] = pool[off + j]
      }
      for (; j < 16; j += 1) {
        child[j] = pool[off + 16 + j]
      }
      mutateChildBytes(child, mutPos, mixByte, useScramble)
      child[6] = (child[6] % 16) + 0x80
      child[8] = (child[8] % 64) + 0x80
      let pos = 0
      for (let k = 0; k < 16; k += 1) {
        const free = andBits(child[k], FREE_MASK[k])
        for (let b = 0; b < 8; b += 1) {
          if (andBits(FREE_MASK[k], shiftLeftBits(1, b))) {
            pushBit(acc, andBits(shiftRightBits(free, b), 1), pos)
            pos += 1
          }
        }
      }
    }
  }
}

report("old-xor ", oldAcc)
report("new-scram", newAcc)
console.log("done")
