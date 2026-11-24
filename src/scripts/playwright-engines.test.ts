/// <reference types="node" />

import assert from "node:assert/strict"
import path from "node:path"
import { test } from "node:test"

// The browser runner labelled each row with the requested engine but pinned

// The launch function to chromium, so results/benchmark_results.json carried

// Three chromium runs labelled chromium / firefox / webkit. Any consumer that

// Trusts the label reads a false cross-browser claim.

const root = path.resolve(import.meta.dirname, "..", "..")

const mod = (await import(
  path.join(root, "src", "scripts", "playwright.ts")
)) as {
  runBenchmark: (
    args: Readonly<Record<string, string | boolean>>,

    options: Readonly<{ browser?: "chromium" | "firefox" | "webkit" }>
  ) => Promise<{
    browser: string

    userAgent: string

    results: Record<string, string>[]

    collisions: Record<string, string>[]

    browserErrors: string[]

    rawLog: string

    generationPlan: string
  }>

  planPlaywrightWrite: (
    runCount: number,
    outPath: string
  ) => { write: boolean; message: string }

  startServer: () => Promise<{ close: () => Promise<void>; origin: string }>
}

const ENGINES = ["chromium", "firefox", "webkit"] as const

// Engine fingerprints taken from the real navigator.userAgent of each engine.

const MUST_MATCH: Record<string, RegExp> = {
  chromium: /HeadlessChrome\/\d+/u,

  firefox: /Firefox\/\d+/u,

  webkit: /Version\/\d+\.\d+ Safari\/\d+/u,
}

// A foreign engine's signature must never appear in this engine's row.

const MUST_NOT_MATCH: Record<string, RegExp> = {
  chromium: /^(?!.*HeadlessChrome).*$/u,

  firefox: /HeadlessChrome/u,

  webkit: /HeadlessChrome/u,
}

const N_SYNC = Number(process.env.PW_TEST_SYNC ?? 2000)

const N_ASYNC = Number(process.env.PW_TEST_ASYNC ?? 200)

const N_COLL = Number(process.env.PW_TEST_COLL ?? 20_000)

void test(
  "every engine row comes from the engine it claims, and the three agents differ",

  { timeout: 600_000 },

  async () => {
    const agents: string[] = []

    const server = await mod.startServer()

    try {
      const runEngine = async (index: number): Promise<void> => {
        if (index >= ENGINES.length) {
          return
        }

        const engine = ENGINES[index]

        const output = await mod.runBenchmark(
          {
            "n-async": String(N_ASYNC),

            "n-coll": String(N_COLL),

            "n-sync": String(N_SYNC),

            timeout: "300000",

            url: `${server.origin}/index.html`,
          },

          { browser: engine }
        )

        assert.equal(
          output.browser,
          engine,
          "the output must record the engine that was requested"
        )

        assert.match(
          output.userAgent,

          MUST_MATCH[engine],

          `expected a ${engine} user agent, got "${output.userAgent}"`
        )

        assert.doesNotMatch(
          output.userAgent,

          MUST_NOT_MATCH[engine],

          `the ${engine} row reports a foreign engine user agent: "${output.userAgent}"`
        )

        assert.deepEqual(
          output.browserErrors,
          [],
          `${engine} must report no browser errors`
        )

        assert.ok(
          output.results.length >= 6,
          `${engine} produced ${output.results.length} result rows`
        )

        assert.ok(
          output.collisions.length >= 6,
          `${engine} produced ${output.collisions.length} collision rows`
        )

        assert.equal(
          output.generationPlan,

          "compiled-direct-v8",

          `${engine} must record the production generation plan it ran`
        )

        agents.push(output.userAgent)

        return runEngine(index + 1)
      }

      await runEngine(0)
    } finally {
      await server.close()
    }

    assert.equal(
      new Set(agents).size,

      ENGINES.length,

      `expected ${ENGINES.length} distinct user agents, got: ${agents.join(" | ")}`
    )
  }
)
