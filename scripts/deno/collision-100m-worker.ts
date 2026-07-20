// Worker (Deno Web Worker): dedup a partition of N UUIDs in isolation.
// Driven by `collision-100m.ts`, which fans the work across all cores.
import { type V8Layout } from "../../dist/algo.js"

const algo = (await import("../../dist/algo.js")) as {
  genV4Native: () => string
  genV7: () => string
  genGenoID: () => string
  genStructuredGenoID: (l: V8Layout) => string
  DBKEY_LAYOUT: V8Layout
}
const { genV4Native, genV7, genGenoID, genStructuredGenoID, DBKEY_LAYOUT } = algo

const MASK64 = (1n << 64n) - 1n

// Parse a UUID string into its 128-bit value as two 64-bit halves.
function uuidToKey(uuid: string): { hi: bigint; lo: bigint } {
  const hex = uuid.length === 36 ? uuid.replace(/-/g, "") : uuid
  const v = BigInt(`0x${hex}`)
  return { hi: (v >> 64n) & MASK64, lo: v & MASK64 }
}

// Compact open-addressing hash set for 128-bit keys (exact dedup).
class Uuid128Set {
  private cap: number
  private mask: number
  private keysHi: BigUint64Array
  private keysLo: BigUint64Array
  private occ: Uint8Array

  constructor(n: number, load = 0.7) {
    let cap = Math.max(16, Math.ceil(n / load))
    cap = 1 << Math.ceil(Math.log2(cap))
    this.cap = cap
    this.mask = cap - 1
    this.keysHi = new BigUint64Array(cap)
    this.keysLo = new BigUint64Array(cap)
    this.occ = new Uint8Array(cap)
  }

  // Returns true if the key was already present (a collision).
  add(hi: bigint, lo: bigint): boolean {
    let idx = Number((hi ^ (lo << 1n)) & BigInt(this.mask))
    while (this.occ[idx] === 1) {
      if (this.keysHi[idx] === hi && this.keysLo[idx] === lo) return true
      idx = (idx + 1) & this.mask
    }
    this.occ[idx] = 1
    this.keysHi[idx] = hi
    this.keysLo[idx] = lo
    return false
  }
}

const MODES: Record<string, () => string> = {
  "v4-native": genV4Native,
  "genoid-v8": genGenoID,
  "v7": genV7,
  "genoid-structured": () => genStructuredGenoID(DBKEY_LAYOUT),
}

interface WorkerData {
  mode: string
  n: number
}

// Deno Web Workers receive data via postMessage (no workerData/parentPort).
self.addEventListener("message", (e: MessageEvent<WorkerData>) => {
  const { mode, n } = e.data
  if (!Object.prototype.hasOwnProperty.call(MODES, mode)) {
    // oxlint-disable-next-line unicorn/require-post-message-target-origin
    self.postMessage({ error: `Unsupported mode: ${mode}`, n })
    return
  }
  const gen = MODES[mode]
  if (typeof gen !== "function") {
    // oxlint-disable-next-line unicorn/require-post-message-target-origin
    self.postMessage({ error: `Invalid generator for mode: ${mode}`, n })
    return
  }
  const set = new Uuid128Set(n)
  let collisions = 0
  for (let i = 0; i < n; i++) {
    const { hi, lo } = uuidToKey(gen())
    if (set.add(hi, lo)) collisions++
  }
  const tableMB = (set.capacity * 8 * 2 + set.capacity) / (1024 * 1024)
  // oxlint-disable-next-line unicorn/require-post-message-target-origin
  self.postMessage({ collisions, n, tableMB })
})
