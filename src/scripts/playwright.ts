#!/usr/bin/env node
import { chromium, firefox, webkit } from "playwright"

import { nullValue, undefinedValue } from "./shared/runtime-values.ts"

import fs from "node:fs"

import http from "node:http"

import { once } from "node:events"

import path from "node:path"

type Browser = Awaited<ReturnType<typeof chromium.launch>>

const __dirname = import.meta.dirname

const root = path.resolve(__dirname, "..", "..")

const DEFAULT_TIMEOUT_MS = 600_000

const MIME: Record<string, string> = {
  ".css": "text/css",

  ".html": "text/html",

  ".js": "text/javascript",

  ".json": "application/json",

  ".mjs": "text/javascript",
}

// Firefox and WebKit refuse to load ES modules over file:// (cross-origin

// Module fetch is blocked), so the harness serves the repo root over HTTP and

// Loads index.html from there. Chromium works either way.

export const startServer = async (): Promise<{
  close: () => Promise<void>
  origin: string
}> => {
  const server = http.createServer((req, res) => {
    let urlPath = "/"

    if (typeof req.url === "string" && req.url.length > 0) {
      urlPath = decodeURIComponent(req.url.split("?")[0])
    }

    let rel = urlPath.replace(/^\/+/u, "")

    if (urlPath === "/") {
      rel = "index.html"
    }

    const filePath = path.resolve(root, rel)

    if (!filePath.startsWith(root) || !fs.existsSync(filePath)) {
      res.writeHead(404)

      res.end("not found")

      return
    }

    res.writeHead(200, {
      "content-type":
        MIME[path.extname(filePath)] || "application/octet-stream",
    })

    fs.createReadStream(filePath).pipe(res)
  })

  server.listen(0, "127.0.0.1")

  await once(server, "listening")

  const addr = server.address()

  let port = 0

  if (typeof addr === "object" && addr) {
    const { port: serverPort } = addr
    port = serverPort
  }

  return {
    close: async () => {
      server.closeAllConnections()

      server.close()

      await once(server, "close")
    },

    origin: `http://127.0.0.1:${port}`,
  }
}

type BrowserName = "chromium" | "firefox" | "webkit"

const BROWSERS: BrowserName[] = ["chromium", "firefox", "webkit"]

// Console errors that are benign for this static benchmark page and must not

// Fail the deployable gate. Mirrors the "Allowed Exceptions" pattern from

// Playwright best practices (fail on unexpected console errors only).

// Currently empty — the benchmark emits none — but kept as an explicit seam

// So a benign error (e.g. favicon 404) can be allowlisted without weakening

// The check for real errors.

const ALLOWED_CONSOLE_ERRORS: RegExp[] = []

const parseArgs = (
  argv: readonly string[],
): Record<string, string | boolean> => {
  const args: Record<string, string | boolean> = {}

  for (const raw of argv) {
    const m = /^--(?<name>[^=]+)(?:=(?<value>.*))?$/u.exec(raw)

    if (m) {
      const [, name, parsedValue] = m

      let value: string | boolean = true

      if (m.length > 2) {
        value = parsedValue
      }

      args[name] = value
    }
  }

  return args
}

interface LaunchOptions {
  headless?: boolean

  args?: readonly string[]

  executablePath?: string
}

type LaunchFn = (opts: Readonly<LaunchOptions>) => Promise<Browser>

interface BenchOptions {
  launch?: LaunchFn

  browser?: BrowserName
}

interface BenchInputs {
  nAsync: string

  nColl: string

  nSync: string
}

interface BenchOutput {
  browser: BrowserName

  browserErrors: string[]

  collisions: Record<string, string>[]

  htmlPath: string

  inputs: BenchInputs

  rawLog: string

  results: Record<string, string>[]

  timestamp: string

  userAgent: string

  /** The production generation plan the page reported it ran. */

  generationPlan: string
}

const ENGINES = { chromium, firefox, webkit }

const makeLaunch = (browser: BrowserName): LaunchFn => {
  const engine = ENGINES[browser]

  return async (opts: Readonly<LaunchOptions>): Promise<Browser> => {
    const engineOpts: Parameters<typeof engine.launch>[0] = {}

    if (opts.headless !== undefinedValue) {
      engineOpts.headless = opts.headless
    }

    if (opts.args !== undefinedValue) {
      engineOpts.args = [...opts.args]
    }

    if (opts.executablePath !== undefinedValue) {
      engineOpts.executablePath = opts.executablePath
    }

    const instance = await engine.launch(engineOpts)

    return instance
  }
}

const toObjects = (
  headers: readonly string[],

  rows: readonly  string[][],
): Record<string, string>[] =>
  rows.map((r) => Object.fromEntries(headers.map((h, i) => [h, r[i]])))

const runBenchmark = async (
  args: Readonly<Record<string, string | boolean>>,

  { launch, browser = "chromium" }: Readonly<BenchOptions> = {},
): Promise<BenchOutput> => {
  // The launch function must follow the requested engine. Binding it as a

  // Destructuring default pinned every caller to chromium, so the firefox

  // And webkit rows in results/benchmark_results.json were chromium runs

  // Under a different label. Resolve it from `browser` instead.

  const start = launch ?? makeLaunch(browser)

  let htmlPath = path.join(root, "index.html")

  if (typeof args.html === "string") {
    htmlPath = args.html
  }

  htmlPath = path.resolve(htmlPath)

  if (!fs.existsSync(htmlPath)) {
    throw new Error(`HTML file not found: ${htmlPath}`)
  }

  let timeout = DEFAULT_TIMEOUT_MS

  if (typeof args.timeout === "string") {
    timeout = Math.trunc(Number(args.timeout))
  }

  const headless = args.headless !== "false"

  // Playwright manages engine-appropriate launch args itself; passing

  // Chrome-only flags (e.g. --no-sandbox) breaks Firefox/WebKit launches.

  // Chromium sandbox flags are added only for chromium.

  const launchOpts: LaunchOptions = { headless }

  if (browser === "chromium") {
    launchOpts.args = [
      "--no-sandbox",
      "--disable-setuid-sandbox",
      "--disable-dev-shm-usage",
    ]
  }

  const executablePath = args["executable-path"]

  if (
    (typeof executablePath === "string" && executablePath.length > 0) ||
    executablePath === true
  ) {
    launchOpts.executablePath = String(executablePath)
  }

  console.log(`Launching ${browser} (headless=${headless})...`)

  const browserInstance = await start(launchOpts)

  const page = await browserInstance.newPage()

  const browserErrors: string[] = []

  const isAllowed = (text: string): boolean =>
    ALLOWED_CONSOLE_ERRORS.some((pattern) => pattern.test(text))

  page.on("pageerror", (err: unknown) => {
    const text = String(err)

    if (!isAllowed(text)) {
      browserErrors.push(text)
    }
  })

  page.on("console", (msg) => {
    if (msg.type() === "error") {
      const text = msg.text()

      if (!isAllowed(text)) {
        browserErrors.push(text)
      }
    }
  })

  let pageUrl = `file://${htmlPath}`

  if (typeof args.url === "string") {
    pageUrl = args.url
  }

  try {
    console.log(`Loading ${pageUrl} ...`)

    await page.goto(pageUrl, { waitUntil: "load" })

    await page.waitForFunction(
      () => {
        const element = document.querySelector("#samples")

        if (!element) {
          return false
        }

        const text =
          (element as unknown as { textContent: string | null }).textContent ??
          ""

        return text.trim().length > 0
      },

      undefinedValue,

      { timeout: 15_000 },
    )

    const setInput = async (
      id: string,
      val: string | boolean | undefined,
    ): Promise<void> => {
      if (val === undefinedValue) {
        return
      }

      await page.$eval(
        `#${id}`,

        (el, v) => {
          ;(el as HTMLInputElement).value = v
        },

        String(val),
      )
    }

    await setInput("nSync", args["n-sync"])

    await setInput("nAsync", args["n-async"])

    await setInput("nColl", args["n-coll"])

    console.log("Starting benchmark run (runAll())...")

    // Schedule runAll on a macrotask and return immediately. page.click /

    // DispatchEvent would block waiting for the long-running (mostly

    // Synchronous) benchmark handler to settle; this fires-and-forgets so the

    // Subsequent waitForFunction can poll #log for "Done." instead.

    await page.evaluate(() => {
      setTimeout(() => {
        ;(globalThis as unknown as { runAll: () => void }).runAll()
      }, 0)
    })

    await page.waitForFunction(
      () => {
        const element = document.querySelector("#log")

        if (!element) {
          return false
        }

        return (
          (element as unknown as { textContent: string | null }).textContent ??
          ""
        ).includes("Done.")
      },

      undefinedValue,

      { timeout },
    )

    const logText = await page.$eval(
      "#log",

      (el) =>
        (el as unknown as { textContent: string | null }).textContent ?? "",
    )

    const scrapeTable = async (id: string): Promise<string[][]> => {
      const result = await page.$$eval(
        `#${id} tbody tr`,
        (rows: readonly Readonly<Element>[]) =>
          rows.map((tr) =>
            [...tr.children].map((td) =>
              (
                (td as unknown as { textContent: string | null }).textContent ??
                ""
              ).trim(),
            ),
          ),
      )

      return result
    }

    const headersOf = async (id: string): Promise<string[]> => {
      const result = await page.$$eval(
        `#${id} thead th`,
        (ths: readonly Readonly<Element>[]) =>
          ths.map((th) =>
            (
              (th as unknown as { textContent: string | null }).textContent ??
              ""
            ).trim(),
          ),
      )

      return result
    }

    const resultsHeaders = await headersOf("resultsTable")

    const resultsRows = await scrapeTable("resultsTable")

    const collHeaders = await headersOf("collTable")

    const collRows = await scrapeTable("collTable")

    const output: BenchOutput = {
      browser,

      browserErrors,

      collisions: toObjects(collHeaders, collRows),

      generationPlan: await page.evaluate(() => {
        const el = document.querySelector("#planLabel")

        let text = ""

        if (el) {
          text =
            (el as unknown as { textContent: string | null }).textContent ?? ""
        }

        const match = /Generation plan:\s*(?<plan>\S+)/u.exec(text)

        let plan = "unknown"

        if (match) {
          const [, parsedPlan] = match
          plan = parsedPlan
        }

        return plan
      }),

      htmlPath,

      inputs: {
        nAsync: await page.$eval(
          "#nAsync",

          (el: Readonly<Element>) => (el as unknown as HTMLInputElement).value,
        ),

        nColl: await page.$eval(
          "#nColl",

          (el: Readonly<Element>) => (el as unknown as HTMLInputElement).value,
        ),

        nSync: await page.$eval(
          "#nSync",

          (el: Readonly<Element>) => (el as unknown as HTMLInputElement).value,
        ),
      },

      rawLog: logText,

      results: toObjects(resultsHeaders, resultsRows),

      timestamp: new Date().toISOString(),

      userAgent: await page.evaluate(() => navigator.userAgent),
    }

    return output
  } catch (error) {
    try {
      let outName = "benchmark_results.json"

      if (typeof args.out === "string") {
        outName = args.out
      }

      const shotPath = path.resolve(
        `${outName.replace(/\.json$/u, "")}_${browser}_failure.png`,
      )

      await page.screenshot({ fullPage: true, path: shotPath })

      console.error(`Saved failure screenshot to ${shotPath}`)
    } catch {
      /* Best-effort */
    }

    throw error
  } finally {
    await browserInstance.close()
  }
}

const assertRun = (output: Readonly<BenchOutput>): void => {
  const structured = output.results.find((r) =>
    (
      (r as Readonly<Record<string, string | undefined>>).Algorithm ?? ""
    ).includes("GenoID-structured"),
  )

  const collisionFail = output.collisions.some(
    (c) => Number(c["Collisions found"]) > 0,
  )

  if (output.browserErrors.length > 0) {
    throw new Error(
      `[${output.browser}] browserErrors: ${output.browserErrors.join("; ")}`,
    )
  }

  if (!structured) {
    throw new Error(`[${output.browser}] GenoID-structured entry missing`)
  }

  if (collisionFail) {
    throw new Error(`[${output.browser}] collisions detected`)
  }
}

interface PlaywrightWritePlan {
  write: boolean

  message: string
}

// Results/benchmark_results.json is a tracked artifact. A browser run in

// Which every engine failed to launch produces an empty run set, and

// Writing that would silently destroy the committed evidence. Refuse the

// Write instead and say why.

export const planPlaywrightWrite = (
  runCount: number,
  outPath: string,
): PlaywrightWritePlan => {
  if (runCount === 0) {
    return {
      message:
        `No browser produced a result; ${outPath} was left untouched. ` +
        `Fix the launch failure (or point --out at a scratch file) before rerunning.`,

      write: false,
    }
  }

  return { message: `Full JSON written to ${outPath}`, write: true }
}

const main = async (): Promise<void> => {
  const args = parseArgs(process.argv.slice(2))

  let browserArg = "all"

  if (typeof args.browser === "string") {
    browserArg = args.browser
  }

  let targetBrowsers = BROWSERS

  if (browserArg !== "all") {
    targetBrowsers = [browserArg as BrowserName]
  }

  const server = await startServer()

  const runArgs = Object.fromEntries(
    Object.entries(args),
  ) as Record<string, string | boolean>

  if (typeof args.url !== "string" && typeof args.html !== "string") {
    runArgs.url = `${server.origin}/index.html`
  }

  const runs: BenchOutput[] = []

  const runBrowser = async (index: number): Promise<boolean> => {
    if (index >= targetBrowsers.length) {
      return false
    }

    const b = targetBrowsers[index]

    let browserFailed = false

    try {
      const output = await runBenchmark(runArgs, { browser: b })

      runs.push(output)

      console.log(`\n=== Results (${b}) ===`)

      console.table(output.results)

      console.log(`\n=== Collision test (${b}) ===`)

      console.table(output.collisions)

      if (output.browserErrors.length > 0) {
        console.log(`\n=== Browser console errors (${b}) ===`)

        for (const e of output.browserErrors) {
          console.log(" -", e)
        }
      }

      assertRun(output)

      console.log(`[${b}] deployable check PASSED`)
    } catch (error) {
      browserFailed = true

      console.error(`[${b}] run failed:`, (error as Error).message)
    }

    const nextFailed = await runBrowser(index + 1)

    return browserFailed || nextFailed
  }

  let failed = false

  try {
    failed = await runBrowser(0)
  } finally {
    await server.close()
  }

  let outName = "results/benchmark_results.json"

  if (typeof args.out === "string") {
    outName = args.out
  }

  const outPath = path.resolve(outName)

  const plan = planPlaywrightWrite(runs.length, outPath)

  if (plan.write) {
    try {
      fs.writeFileSync(outPath, JSON.stringify({ runs }, nullValue, 2))

      console.log(`\n${plan.message}`)
    } catch (error) {
      console.error(`Failed to write ${outPath}: ${(error as Error).message}`)
    }
  } else {
    console.error(`\n${plan.message}`)
  }

  if (failed) {
    process.exitCode = 1
  }
}

if (process.argv[1] === path.resolve(root, "src", "scripts", "playwright.ts")) {
  await main()
}

export { parseArgs, runBenchmark, BROWSERS }

export type { BenchOutput, BrowserName }
