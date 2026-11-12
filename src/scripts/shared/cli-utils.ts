// Cross-cutting helpers shared by scripts/*.ts CLIs (provenance, runtime
// labels, seeded RNG). Each function here previously existed as 2-3
// byte-identical copies; this module is the single home. Side-effect free on
// import so tests can use it without running any CLI.
import { execFileSync } from "node:child_process"

// Commit SHA of the working tree, or "unknown" when git is unavailable
// (release tarballs, PATH-less CI). Pass the repo root explicitly.
export function gitSha(root: string): string {
  try {
    return execFileSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf-8" }).trim()
  } catch {
    return "unknown"
  }
}

// Runtime label for artifact environment blocks.
export function runtimeVersion(): string {
  const bun = (globalThis as { Bun?: { version: string } }).Bun
  return bun ? `Bun ${bun.version}` : `Node ${process.version}`
}

// Deterministic xorshift32 stream for seeded experiments.
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = Math.imul(a ^ (a >>> 15), a | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}
