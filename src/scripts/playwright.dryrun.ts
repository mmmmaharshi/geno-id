import fs from "node:fs"
import path from "node:path"
import { setTimeout as delay } from "node:timers/promises"
import { pathToFileURL } from "node:url"

import { JSDOM } from "jsdom"
import type { Browser } from "playwright"

const __dirname = import.meta.dirname
const root = path.resolve(__dirname, "..", "..")

interface MockPage {
  $$eval: <T>(
    selector: string,
    fn: (els: readonly Readonly<Element>[]) => T
  ) => Promise<T>
  $eval: <T>(
    selector: string,
    fn: (el: Readonly<Element>, ...args: readonly unknown[]) => T,
    ...args: readonly unknown[]
  ) => Promise<T>
  evaluate: <T>(fn: () => T) => Promise<T>
  goto: (_url: string, _opts?: unknown) => Promise<void>
  on: () => void
  screenshot: () => Promise<void>
  waitForFunction: (
    fn: () => boolean,
    _arg?: unknown,
    opts?: Readonly<{ timeout?: number }>
  ) => Promise<boolean>
}

interface MockBrowser {
  close: () => Promise<void>
  newPage: () => Promise<MockPage>
}

const makeMockBrowser = async (): Promise<MockBrowser> => {
  const htmlPath = path.join(root, "index.html")
  const html = fs.readFileSync(htmlPath, "utf8")
  const dom = new JSDOM(html, {
    runScripts: "outside-only",
    url: `file://${htmlPath}`,
  })
  const { window } = dom
  const nodeCrypto = (await import("node:crypto")) as unknown as {
    webcrypto: Crypto
  }
  const browserWindow = window as unknown as {
    crypto?: { subtle?: SubtleCrypto }
    performance?: Performance
  }
  const browserCrypto = browserWindow.crypto
  let installCrypto = false
  if (!browserCrypto) {
    installCrypto = true
  } else if (!browserCrypto.subtle) {
    installCrypto = true
  }
  if (installCrypto) {
    Object.defineProperty(window, "crypto", {
      configurable: true,
      value: nodeCrypto.webcrypto,
    })
  }
  if (!browserWindow.performance) {
    const perfHooks = await import("node:perf_hooks")
    Object.defineProperty(window, "performance", {
      configurable: true,
      value: perfHooks.performance,
    })
  }

  const benchmarkUrl = pathToFileURL(path.join(root, "dist/benchmark.js")).href
  const benchModule = (await import(benchmarkUrl)) as {
    init: (host: Readonly<object>) => void
  }
  Object.defineProperty(globalThis, "document", {
    configurable: true,
    value: window.document,
  })
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: window,
  })
  benchModule.init(window)

  const page: MockPage = {
    $$eval: async <T>(
      selector: string,
      fn: (els: readonly Readonly<Element>[]) => T
    ): Promise<T> => {
      const result = await Promise.resolve(
        fn([...window.document.querySelectorAll(selector)])
      )
      return result
    },
    $eval: async <T>(
      selector: string,
      fn: (el: Readonly<Element>, ...args: readonly unknown[]) => T,
      ...args: readonly unknown[]
    ): Promise<T> => {
      const element = window.document.querySelector(selector)
      if (!element) {
        throw new Error(`mock page missing ${selector}`)
      }
      const result = await Promise.resolve(fn(element, ...args))
      return result
    },
    evaluate: async <T>(fn: () => T): Promise<T> => {
      const result = await Promise.resolve(fn())
      return result
    },
    goto: async (): Promise<void> => {
      await Promise.resolve()
    },
    on: (): void => {
      // Noop
    },
    screenshot: async (): Promise<void> => {
      await Promise.resolve()
    },
    waitForFunction: async (
      fn: () => boolean,
      _arg?: unknown,
      opts: Readonly<{ timeout?: number }> = {}
    ): Promise<boolean> => {
      const timeout = opts.timeout ?? 30_000
      const start = Date.now()
      const poll = async (): Promise<boolean> => {
        if (fn()) {
          return true
        }
        if (Date.now() - start > timeout) {
          throw new Error("waitForFunction timed out")
        }
        await delay(10)
        return poll()
      }
      const result = await poll()
      return result
    },
  }

  return {
    close: async (): Promise<void> => {
      await Promise.resolve()
    },
    newPage: async (): Promise<MockPage> => {
      const result = await Promise.resolve(page)
      return result
    },
  }
}

const { runBenchmark } = await import("./playwright.js")

const main = async (): Promise<void> => {
  const args: Record<string, string> = {
    "n-async": "200",
    "n-coll": "5000",
    "n-sync": "2000",
    out: "/tmp/dry_run_results.json",
  }
  const output = await runBenchmark(args, {
    launch: async (_opts: object): Promise<Browser> => {
      const browser = await makeMockBrowser()
      return browser as unknown as Browser
    },
  })

  console.log("OK: runBenchmark completed via mocked browser.")
  console.log(
    "results rows:",
    output.results.length,
    "(expect 6: v4, v7, hash, mathrandom, GenoID, GenoID-structured)"
  )
  console.log("collisions rows:", output.collisions.length, "(expect 6)")
  console.log('rawLog includes "Done.":', output.rawLog.includes("Done."))
  console.log("sample results[0]:", JSON.stringify(output.results[0]))
  console.log("sample collisions[0]:", JSON.stringify(output.collisions[0]))

  const namesResults = output.results.map((r) => r.Algorithm)
  const namesColl = output.collisions.map((r) => r.Algorithm)
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
    console.error("DRY RUN FAILED — see checks above")
    process.exitCode = 1
    return
  }
  console.log("\nDRY RUN PASSED.")
}

try {
  await main()
} catch (error) {
  console.error("DRY RUN THREW:", error)
  process.exitCode = 1
}
