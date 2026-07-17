import fs from "node:fs"
import path from "node:path"
import { pathToFileURL } from "node:url"
import { JSDOM } from "jsdom"
import type { Browser } from "puppeteer"

const __dirname = import.meta.dirname
const root = path.resolve(__dirname, "..")

interface MockPage {
  _pendingRunAll: Promise<void> | null
  $$eval: <T>(selector: string, fn: (els: Element[]) => T) => Promise<T>
  $eval: <T,>(
    selector: string,
    fn: (el: Element, ...args: unknown[]) => T,
    ...args: unknown[]
  ) => Promise<T>
  click: (selector: string) => Promise<void>
  evaluate: <T>(fn: () => T) => Promise<T>
  goto: () => Promise<void>
  on: () => void
  screenshot: () => Promise<void>
  waitForFunction: (
    fn: () => boolean,
    opts?: { timeout?: number },
  ) => Promise<boolean>
}

interface MockBrowser {
  close: () => Promise<void>
  newPage: () => Promise<MockPage>
}

async function makeMockBrowser(): Promise<MockBrowser> {
  const htmlPath = path.join(root, "index.html")
  const html = fs.readFileSync(htmlPath, "utf-8")

  const dom = new JSDOM(html, {
    runScripts: "outside-only",
    url: `file://${htmlPath}`,
  })
  const { window } = dom
  const nodeCrypto = (await import("node:crypto")) as unknown as {
    webcrypto: Crypto
  }
  if (!window.crypto || !window.crypto.subtle) {
    Object.defineProperty(window, "crypto", {
      configurable: true,
      value: nodeCrypto.webcrypto,
    })
  }
  if (!window.performance) {
    Object.defineProperty(window, "performance", {
      configurable: true,
      value: (await import("node:perf_hooks")).performance,
    })
  }

  const benchmarkUrl = pathToFileURL(path.join(root, "dist/benchmark.js")).href
  const benchModule = (await import(benchmarkUrl)) as {
    init: (host: Window & typeof globalThis) => void
  }

  Object.defineProperty(globalThis, "document", {
    configurable: true,
    value: window.document,
  })

  benchModule.init(window as unknown as Window & typeof globalThis)

  const page: MockPage = {
    _pendingRunAll: null,
    async $$eval<T,>(selector: string, fn: (els: Element[]) => T): Promise<T> {
      const els = [...window.document.querySelectorAll(selector)]
      return fn(els)
    },
    async $eval<T,>(
      selector: string,
      fn: (el: Element, ...args: unknown[]) => T,
      ...args: unknown[]
    ): Promise<T> {
      const el = window.document.querySelector(selector)!
      return fn(el, ...args)
    },
    async click(selector: string): Promise<void> {
      if (selector === "#runBtn") {
        page._pendingRunAll = (window as any).runAll()
      }
    },
    async evaluate<T,>(fn: () => T): Promise<T> {
      return fn()
    },
    async goto(): Promise<void> {},
    on(): void {},
    async screenshot(): Promise<void> {},
    async waitForFunction(
      fn: () => boolean,
      opts: { timeout?: number } = {},
    ): Promise<boolean> {
      const timeout = opts.timeout || 30000
      const start = Date.now()
      while (true) {
        if (fn()) return true
        if (Date.now() - start > timeout)
          throw new Error("waitForFunction timed out")
        await new Promise((r) => setTimeout(r, 10))
      }
    },
  }

  const browser: MockBrowser = {
    async close(): Promise<void> {},
    async newPage(): Promise<MockPage> {
      return page
    },
  }

  return browser
}

const { runBenchmark } = await import("./puppeteer.js")
;(async () => {
  const args: Record<string, string> = {
    "n-async": "200",
    "n-coll": "5000",
    "n-sync": "2000",
    out: "/tmp/dry_run_results.json",
  }
  const output = await runBenchmark(args, {
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    launch: ((_opts: Record<string, unknown>) =>
      makeMockBrowser()) as unknown as (
      opts: Record<string, unknown>,
    ) => Promise<Browser>,
  })

  console.log("OK: runBenchmark completed via mocked browser.")
  console.log(
    "results rows:",
    output.results.length,
    "(expect 6: v4, v7, hash, mathrandom, GenoID, GenoID-structured)",
  )
  console.log("collisions rows:", output.collisions.length, "(expect 6)")
  console.log('rawLog includes "Done.":', output.rawLog.includes("Done."))
  console.log("sample results[0]:", JSON.stringify(output.results[0]))
  console.log("sample collisions[0]:", JSON.stringify(output.collisions[0]))

  const namesResults = output.results.map((r) => r["Algorithm"])
  const namesColl = output.collisions.map((r) => r["Algorithm"])
  const expectedNames = [
    "crypto.randomUUID (v4)",
    "UUIDv7 (custom, RFC 9562)",
    "SHA-256 hash-derived (v5-style)",
    "Math.random (v4-format)",
    "GenoID (proposed, GA-inspired, v8)",
    "GenoID-structured (dbkey, v8)",
  ]
  const namesMatch =
    JSON.stringify(namesResults) === JSON.stringify(expectedNames) &&
    JSON.stringify(namesColl) === JSON.stringify(expectedNames)
  console.log("algorithm names match expected set/order:", namesMatch)

  if (
    output.results.length !== 6 ||
    output.collisions.length !== 6 ||
    !output.rawLog.includes("Done.") ||
    !namesMatch
  ) {
    console.error("DRY RUN FAILED \u2014 see checks above")
    process.exit(1)
  }
  console.log("\nDRY RUN PASSED.")
})().catch((error: Error) => {
  console.error("DRY RUN THREW:", error)
  process.exit(1)
})
