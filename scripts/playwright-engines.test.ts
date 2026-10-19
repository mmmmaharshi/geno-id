import { test } from "node:test"
import assert from "node:assert/strict"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"

// The browser runner labelled each row with the requested engine but pinned
// the launch function to chromium, so results/benchmark_results.json carried
// three chromium runs labelled chromium / firefox / webkit. Any consumer that
// trusts the label reads a false cross-browser claim.

const root = path.resolve(import.meta.dirname, "..")
const mod = (await import(path.join(root, "scripts", "playwright.ts"))) as {
  runBenchmark: (
    args: Record<string, string | boolean>,
    options: { browser?: "chromium" | "firefox" | "webkit" },
  ) => Promise<{
    browser: string
    userAgent: string
    results: Record<string, string>[]
    collisions: Record<string, string>[]
    browserErrors: string[]
    rawLog: string
    generationPlan: string
  }>
  planPlaywrightWrite: (runCount: number, outPath: string) => { write: boolean; message: string }
  startServer: () => Promise<{ close: () => Promise<void>; origin: string }>
}

const ENGINES = ["chromium", "firefox", "webkit"] as const

// Engine fingerprints taken from the real navigator.userAgent of each engine.
const MUST_MATCH: Record<string, RegExp> = {
  chromium: /HeadlessChrome\/\d+/,
  firefox: /Firefox\/\d+/,
  webkit: /Version\/\d+\.\d+ Safari\/\d+/,
}
// A foreign engine's signature must never appear in this engine's row.
const MUST_NOT_MATCH: Record<string, RegExp> = {
  chromium: /^(?!.*HeadlessChrome).*$/,
  firefox: /HeadlessChrome/,
  webkit: /HeadlessChrome/,
}

const N_SYNC = Number(process.env.PW_TEST_SYNC ?? 2000)
const N_ASYNC = Number(process.env.PW_TEST_ASYNC ?? 200)
const N_COLL = Number(process.env.PW_TEST_COLL ?? 20000)

test(
  "every engine row comes from the engine it claims, and the three agents differ",
  { timeout: 600_000 },
  async () => {
    const agents: string[] = []
    const server = await mod.startServer()

    try {
      for (const engine of ENGINES) {
        const output = await mod.runBenchmark(
          {
            url: `${server.origin}/index.html`,
            "n-sync": String(N_SYNC),
            "n-async": String(N_ASYNC),
            "n-coll": String(N_COLL),
            timeout: "300000",
          },
          { browser: engine },
        )

        assert.equal(output.browser, engine, "the output must record the engine that was requested")
        assert.match(
          output.userAgent,
          MUST_MATCH[engine],
          `expected a ${engine} user agent, got "${output.userAgent}"`,
        )
        assert.doesNotMatch(
          output.userAgent,
          MUST_NOT_MATCH[engine],
          `the ${engine} row reports a foreign engine user agent: "${output.userAgent}"`,
        )
        assert.deepEqual(output.browserErrors, [], `${engine} must report no browser errors`)
        assert.ok(output.results.length >= 6, `${engine} produced ${output.results.length} result rows`)
        assert.ok(output.collisions.length >= 6, `${engine} produced ${output.collisions.length} collision rows`)
        assert.equal(
          output.generationPlan,
          "compiled-direct-v8",
          `${engine} must record the production generation plan it ran`,
        )

        agents.push(output.userAgent)
      }
    } finally {
      await server.close()
    }

    assert.equal(
      new Set(agents).size,
      ENGINES.length,
      `expected ${ENGINES.length} distinct user agents, got: ${agents.join(" | ")}`,
    )
  },
)

test("the write guard still refuses to replace a committed artifact with an empty run set", () => {
  const plan = mod.planPlaywrightWrite(0, "results/benchmark_results.json")
  assert.equal(plan.write, false)
  assert.match(plan.message, /left untouched/)
})

test("a scratch output path is honoured and does not collide with the committed artifact", () => {
  const dir = mkdtempSync(path.join(tmpdir(), "playwright-guard-"))
  try {
    const plan = mod.planPlaywrightWrite(2, path.join(dir, "scratch.json"))
    assert.equal(plan.write, true)
    assert.match(plan.message, /scratch\.json/)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})
