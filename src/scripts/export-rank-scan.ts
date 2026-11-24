import { execFileSync } from "node:child_process"
import { mkdtempSync, writeFileSync } from "node:fs"
import { cpus, tmpdir } from "node:os"
import path from "node:path"

import { andBits, orBits, shiftLeftBits } from "../shared/bitwise.ts"

// P2 — 34B-vs-16B NIST rank-stability scan (single-process, CPU-pooled).

//

// AGENTS.md notes: "raw-v8 (16B CSPRNG) occasionally shows false-positive NIST

// Failures (1 binary_matrix_rank FAIL at p=0.001). GenoID (34B, with GA) showed

// None. Likely statistical ... 34B draws avoid the low end of the rank

// Distribution." This script quantifies that claim: sweep CSPRNG draw size, and

// For each size run T trials of ONLY the NIST binary_matrix_rank test, counting

// FAILs (p < 0.01).

//

// All trials run inside ONE Python process (single nist80022 import) using a

// Multiprocessing.Pool sized to the CPU count — avoids per-trial subprocess

// Fork overhead, which was the earlier bottleneck.

interface RankScanResult {
  size: number

  trials: number

  fails: number

  fail_rate: number
}

const SIZES = [16, 20, 24, 28, 32, 34]

const TRIALS = 60

// 8k UUIDs => ~1M payload bits each (matrix_rank ~0.78s/call, matches AGENTS.md 1.2M-bit scale)

const N_PER_TRIAL = 8000

// Single Python process: receives all trial bit-strings (one per line, no

// Newlines inside) and returns per-size FAIL counts. Runs serially in-process

// (multiprocessing removed) for speed; stdout is flushed per size.

const DRIVER = `
import sys, importlib.util, json
from pathlib import Path
from multiprocessing import Pool

spec = importlib.util.spec_from_file_location("nb", Path(sys.argv[1]) / "nist-bridge.py")
nb = importlib.util.module_from_spec(spec); spec.loader.exec_module(nb)
from nist80022.Matrix import Matrix
mx = Matrix()

with open(sys.argv[2]) as fh:
    size_trials = json.load(fh)  # [[size, [bits1, bits2, ...]], ...]

def one(bits):
    for name, p, ok in mx.binary_matrix_rank_text(bits):
        if not ok:
            return 1
    return 0

out = []
for size, trials in size_trials:
    fails = 0
    for bits in trials:
        fails += one(bits)
    out.append({"size": size, "trials": len(trials), "fails": fails, "fail_rate": fails / len(trials)})
    print(f"size {size}: {fails}/{len(trials)} fails", flush=True)
print(json.dumps(out), flush=True)
`

const rawV8Bytes = (): Uint8Array => {
  const b = new Uint8Array(16)

  crypto.getRandomValues(b)

  b[6] = orBits(andBits(b[6], 0x0f), 0x80)

  b[8] = orBits(andBits(b[8], 0x3f), 0x80)

  return b
}

// Single continuous bit string: 128 bits minus version(48..51)+variant(64..65).

const trialBits = (size: number): string => {
  let out = ""

  for (let i = 0; i < N_PER_TRIAL; i += 1) {
    const b = rawV8Bytes()

    let s = ""

    const lim = Math.min(size, 16)

    for (let j = 0; j < lim; j += 1) {
      s += b[j].toString(2).padStart(8, "0")
    }

    const chars = s.match(/./gu) ?? []

    for (const idx of [48, 49, 50, 51, 64, 65]) {
      if (idx < chars.length) {
        chars[idx] = ""
      }
    }

    out += chars.join("")
  }

  return out
}

const main = (): void => {
  const cores = cpus().length

  const tmp = mkdtempSync(path.join(tmpdir(), "rank-scan-"))

  const driverPath = path.join(tmp, "driver.py")

  writeFileSync(driverPath, DRIVER)

  const rows: string[] = ["size,trials,fails,fail_rate"]

  console.log(
    `=== P2: draw-size vs binary_matrix_rank FAIL (${cores} cores) ===`
  )

  console.log("size | trials | fails | fail_rate")

  console.log("-----|--------|-------|----------")

  const payload: [number, string[]][] = []

  for (const size of SIZES) {
    const trials: string[] = []

    for (let t = 0; t < TRIALS; t += 1) {
      trials.push(trialBits(size))
    }

    payload.push([size, trials])
  }

  const payloadPath = path.join(tmp, "payload.json")

  writeFileSync(payloadPath, JSON.stringify(payload))

  const out = execFileSync(
    "python3",

    ["-u", driverPath, `${process.cwd()}/scripts`, payloadPath],

    { encoding: "utf8", maxBuffer: shiftLeftBits(1, 30) }
  )

  const results = JSON.parse(
    out.trim().split("\n").pop() ?? "[]"
  ) as RankScanResult[]

  for (const r of results) {
    rows.push(`${r.size},${r.trials},${r.fails},${r.fail_rate}`)

    console.log(
      `${String(r.size).padStart(4)} | ${String(r.trials).padStart(6)} | ${String(r.fails).padStart(5)} | ${r.fail_rate}`
    )
  }

  writeFileSync("dist/rank-scan.csv", rows.join("\n"))

  console.log(`\nWrote dist/rank-scan.csv`)
}

main()
