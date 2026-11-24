import {
  andBits,
  orBits,
  shiftLeftBits,
  shiftRightBits,
  xorBits,
} from "../shared/bitwise.ts"

import { genRawV8, hexVal } from "./shared/export-bits.ts"

import fs from "node:fs"

import { need } from "../shared/need.ts"
import path from "node:path"

const __dirname = import.meta.dirname

const root = path.resolve(__dirname, "..", "..")

const HEX_STARTS = [0, 2, 4, 6, 9, 11, 14, 16, 19, 21, 24, 26, 28, 30, 32, 34]

const FREE_MASK = [
  0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0x0F, 0xFF, 0x3F, 0xFF, 0xFF, 0xFF,

  0xFF, 0xFF, 0xFF, 0xFF,
]

const uuidToFreeBits = (uuid: string): string => {
  let bits = ""

  for (let i = 0; i < 16; i += 1) {
    const idx = HEX_STARTS[i]

    const hi = hexVal(need(uuid.codePointAt(idx)))

    const lo = hexVal(need(uuid.codePointAt(idx + 1)))

    const v = orBits(shiftLeftBits(hi, 4), lo)

    const free = andBits(v, FREE_MASK[i])

    for (let b = 0; b < 8; b += 1) {
      if (andBits(FREE_MASK[i], shiftLeftBits(1, b))) {
        let bit = "0"

        if (andBits(shiftRightBits(free, b), 1)) {
          bit = "1"
        }

        bits += bit
      }
    }
  }

  return bits
}

// ---- Ablation variants ----

// 1. raw-v8: no GA, just 16 random bytes → v8 format

// 2. genoid-full: current GenoID (34B, crossover + mutation)

const ENTRY = 34,
  POOL = 256

const _pool = new Uint8Array(ENTRY * POOL)

const _strs = Array.from<string>({ length: POOL })

let _idx = POOL

const _child = new Uint8Array(16)

const _child16 = new Uint16Array(_child.buffer)

const HEX16_VIEW: string[] = Array.from({ length: 65_536 })

{
  const probe = new Uint8Array(2)

  const probeView = new Uint16Array(probe.buffer)

  for (let hi = 0; hi < 256; hi += 1) {
    for (let lo = 0; lo < 256; lo += 1) {
      probe[0] = hi

      probe[1] = lo

      HEX16_VIEW[probeView[0]] =
        hi.toString(16).padStart(2, "0") + lo.toString(16).padStart(2, "0")
    }
  }
}

const genFull = (): string => {
  if (_idx >= POOL) {
    const g = _pool,
      t = HEX16_VIEW

    crypto.getRandomValues(g)

    for (let i = 0; i < POOL; i += 1) {
      const off = i * ENTRY

      const cut = andBits(g[off + 32], 15)

      const mutPos = andBits(g[off + 33], 15)

      let j = 0

      for (; j < cut; j += 1) {
        _child[j] = g[off + j]
      }

      for (; j < 16; j += 1) {
        _child[j] = g[off + 16 + j]
      }

      _child[mutPos] = xorBits(_child[mutPos], g[off + andBits(mutPos + 1, 15)])

      _child[6] = orBits(andBits(_child[6], 0x0F), 0x80)

      _child[8] = orBits(andBits(_child[8], 0x3F), 0x80)

      const v = _child16

      _strs[i] = `${t[v[0]] + t[v[1]]}-${t[v[2]]}-${t[v[3]]}-${t[v[4]]}-${
        t[v[5]]
      }${t[v[6]]}${t[v[7]]}`
    }

    _idx = 0
  }

  _idx += 1
  return _strs[_idx]
}

// 3. crossover-only: 34B, crossover, NO mutation

const _poolX = new Uint8Array(ENTRY * POOL)

const _strsX = Array.from<string>({ length: POOL })

let _idxX = POOL

const _childX = new Uint8Array(16)

const _childX16 = new Uint16Array(_childX.buffer)

const genCrossoverOnly = (): string => {
  if (_idxX >= POOL) {
    const g = _poolX,
      t = HEX16_VIEW

    crypto.getRandomValues(g)

    for (let i = 0; i < POOL; i += 1) {
      const off = i * ENTRY

      const cut = andBits(g[off + 32], 15)

      let j = 0

      for (; j < cut; j += 1) {
        _childX[j] = g[off + j]
      }

      for (; j < 16; j += 1) {
        _childX[j] = g[off + 16 + j]
      }

      _childX[6] = orBits(andBits(_childX[6], 0x0F), 0x80)

      _childX[8] = orBits(andBits(_childX[8], 0x3F), 0x80)

      const v = _childX16

      _strsX[i] = `${t[v[0]] + t[v[1]]}-${t[v[2]]}-${t[v[3]]}-${t[v[4]]}-${
        t[v[5]]
      }${t[v[6]]}${t[v[7]]}`
    }

    _idxX = 0
  }

  _idxX += 1
  return _strsX[_idxX]
}

// 4. mutation-only: 34B, NO crossover (always all from parent A), mutation

const _poolM = new Uint8Array(ENTRY * POOL)

const _strsM = Array.from<string>({ length: POOL })

let _idxM = POOL

const _childM = new Uint8Array(16)

const _childM16 = new Uint16Array(_childM.buffer)

const genMutationOnly = (): string => {
  if (_idxM >= POOL) {
    const g = _poolM,
      t = HEX16_VIEW

    crypto.getRandomValues(g)

    for (let i = 0; i < POOL; i += 1) {
      const off = i * ENTRY

      const mutPos = andBits(g[off + 33], 15)

      let j = 0

      for (; j < 16; j += 1) {
        _childM[j] = g[off + j]
      }

      _childM[mutPos] = xorBits(
        _childM[mutPos],
        g[off + andBits(mutPos + 1, 15)],
      )

      _childM[6] = orBits(andBits(_childM[6], 0x0F), 0x80)

      _childM[8] = orBits(andBits(_childM[8], 0x3F), 0x80)

      const v = _childM16

      _strsM[i] = `${t[v[0]] + t[v[1]]}-${t[v[2]]}-${t[v[3]]}-${t[v[4]]}-${
        t[v[5]]
      }${t[v[6]]}${t[v[7]]}`
    }

    _idxM = 0
  }

  _idxM += 1
  return _strsM[_idxM]
}

// ---- Export ----

const exportSamples = (
  label: string,

  fn: () => string,

  count: number,
): string => {
  const bits: string[] = Array.from<string>({ length: count })

  for (let i = 0; i < count; i += 1) {
    bits[i] = uuidToFreeBits(fn())
  }

  const allBits = bits.join("")

  const filePath = path.resolve(root, "dist", `ablation-${label}.bits.txt`)

  fs.writeFileSync(filePath, allBits, "utf8")

  console.log(`  ${label}: ${(allBits.length / 1e6).toFixed(1)}M bits`)

  return filePath
}

const N = 10_000

const variants: [string, () => string][] = [
  ["rawv8", genRawV8],

  ["full", genFull],

  ["xonly", genCrossoverOnly],

  ["monly", genMutationOnly],
]

console.log(`Exporting ${N.toLocaleString()} UUIDs per variant...`)

for (const [label, fn] of variants) {
  exportSamples(label, fn, N)
}

console.log("Done.")
