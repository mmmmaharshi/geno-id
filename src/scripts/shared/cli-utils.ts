import { execFileSync } from "node:child_process"
// Cross-cutting helpers shared by scripts/*.ts CLIs (provenance, runtime
// Labels, seeded RNG). Each function here previously existed as 2-3
// Byte-identical copies; this module is the single home. Side-effect free on
// Import so tests can use it without running any CLI.

import {
  andBits,
  orBits,
  shiftRightUnsignedBits,
  xorBits,
} from "../../shared/bitwise.ts"

// Commit SHA of the working tree, or "unknown" when git is unavailable

// (release tarballs, PATH-less CI). Pass the repo root explicitly.

export const gitSha = (root: string): string => {
  try {
    return execFileSync("git", ["rev-parse", "HEAD"], {
      cwd: root,
      encoding: "utf8",
    }).trim()
  } catch {
    return "unknown"
  }
}

// Artifact runtime label for environment blocks.

export const runtimeVersion = (): string => {
  const bun = (globalThis as { Bun?: { version: string } }).Bun

  if (bun) {
    return `Bun ${bun.version}`
  }

  return `Node ${process.version}`
}

// Seeded xorshift32 stream for deterministic experiments.

export const mulberry32 = (seed: number): (() => number) => {
  let a = andBits(seed, 0xff_ff_ff_ff)

  return () => {
    a = andBits(a + 0x6d_2b_79_f5, 0xff_ff_ff_ff)

    let t = Math.imul(xorBits(a, shiftRightUnsignedBits(a, 15)), orBits(a, 1))

    const factor = Math.imul(
      xorBits(t, shiftRightUnsignedBits(t, 7)),
      orBits(t, 61)
    )

    t = xorBits(t, t + factor)

    return (
      shiftRightUnsignedBits(xorBits(t, shiftRightUnsignedBits(t, 14)), 0) /
      4_294_967_296
    )
  }
}
