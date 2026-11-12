import { mapPool } from "./pool.ts"
import { STANDARD_FREE_MASK, V7_FREE_MASK, type BatteryResult, type RunDef } from "./stats-core.ts"

console.log("=== Statistical randomness test suite (deno) ===")
console.log(
  "Free-bit mask excludes the 6 fixed version/variant bits: 122/128 bits tested per sample.\n",
)

const N_MAIN = 1_000_000
const N_LIGHT = 300_000
const N_ASYNC = 20_000

const runs: RunDef[] = [
  { id: "genoid", label: "GenoID (proposed, GA-inspired, v8)", mask: STANDARD_FREE_MASK, n: N_MAIN },
  { id: "v4", label: "crypto.randomUUID (v4)", mask: STANDARD_FREE_MASK, n: N_LIGHT },
  { id: "v7", label: "UUIDv7 (custom, RFC 9562)", mask: V7_FREE_MASK, n: N_LIGHT },
  { id: "mr", label: "Math.random (v4-format)", mask: STANDARD_FREE_MASK, n: N_LIGHT },
  { id: "hash", label: "SHA-256 hash-derived (v5-style)", mask: STANDARD_FREE_MASK, n: N_ASYNC },
]

// Run one battery in its own Deno Web Worker. The battery loop is CPU-bound
// single-thread JS, so web workers (not Promise.all over async fns) are what
// actually use extra cores — mapPool fans the batteries out across all of them.
function runOneDef(r: RunDef): Promise<BatteryResult> {
  return new Promise((resolve, reject) => {
    const w = new Worker(new URL("stats-worker.ts", import.meta.url).href, {
      type: "module",
    })
    w.addEventListener("message", (e: MessageEvent<BatteryResult>) => {
      w.terminate()
      resolve(e.data)
    })
    w.addEventListener("error", (err: ErrorEvent) => {
      w.terminate()
      reject(err)
    })
    // oxlint-disable-next-line unicorn/require-post-message-target-origin
    w.postMessage({ id: r.id, label: r.label, mask: r.mask, n: r.n })
  })
}

for (const r of runs) {
  console.log(`Running battery on ${r.label} (n=${r.n.toLocaleString()})...`)
}
const results = await mapPool(runs, runOneDef, Math.max(1, navigator.hardwareConcurrency || 1))

function fmtP(p: number | null): string {
  return p === null ? "n/a" : p.toFixed(4)
}

console.log("\n--- Monobit (frequency) + Runs test, concatenated free-bit stream ---")
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

console.log("\n--- Per-byte-position chi-square uniformity (3 worst positions per algo) ---")
for (const res of results) {
  const failCount = res.chiResults.filter((c) => c.chi2 > c.crit05).length
  const failPositions = res.chiResults.filter((c) => c.chi2 > c.crit05).map((c) => c.pos)
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
      "  byte[" + f.i + "] vs byte[" + f.j + "]: r=" + f.r.toFixed(4) + ", z=" + f.z.toFixed(2),
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
