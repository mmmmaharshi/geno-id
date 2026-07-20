#!/usr/bin/env node
import fs from "node:fs"
import http from "node:http"
import path from "node:path"
import { chromium, firefox, webkit, type Browser, type LaunchOptions } from "playwright"

const __dirname = import.meta.dirname
const root = path.resolve(__dirname, "..")

const MIME: Record<string, string> = {
  ".css": "text/css",
  ".html": "text/html",
  ".js": "text/javascript",
  ".json": "application/json",
  ".mjs": "text/javascript",
}

// Firefox and WebKit refuse to load ES modules over file:// (cross-origin
// module fetch is blocked), so the harness serves the repo root over HTTP and
// loads index.html from there. Chromium works either way.
function startServer(): Promise<{ close: () => Promise<void>; origin: string }> {
  const server = http.createServer((req, res) => {
    const urlPath = decodeURIComponent((req.url || "/").split("?")[0])
    const rel = urlPath === "/" ? "index.html" : urlPath.replace(/^\/+/, "")
    const filePath = path.resolve(root, rel)
    if (!filePath.startsWith(root) || !fs.existsSync(filePath)) {
      res.writeHead(404)
      res.end("not found")
      return
    }
    res.writeHead(200, {
      "content-type": MIME[path.extname(filePath)] || "application/octet-stream",
    })
    fs.createReadStream(filePath).pipe(res)
  })
  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      const addr = server.address()
      const port = typeof addr === "object" && addr ? addr.port : 0
      resolve({
        close: () =>
          new Promise<void>((r) => server.close(() => r())),
        origin: `http://127.0.0.1:${port}`,
      })
    })
  })
}

type BrowserName = "chromium" | "firefox" | "webkit"
const BROWSERS: BrowserName[] = ["chromium", "firefox", "webkit"]

// Console errors that are benign for this static benchmark page and must not
// fail the deployable gate. Mirrors the "Allowed Exceptions" pattern from
// Playwright best practices (fail on unexpected console errors only).
// Currently empty — the benchmark emits none — but kept as an explicit seam
// so a benign error (e.g. favicon 404) can be allowlisted without weakening
// the check for real errors.
const ALLOWED_CONSOLE_ERRORS: RegExp[] = []

function parseArgs(argv: string[]): Record<string, string | boolean> {
  const args: Record<string, string | boolean> = {}
  for (const raw of argv) {
    const m = raw.match(/^--([^=]+)(?:=(.*))?$/)
    if (m) {
      args[m[1]] = m[2] === undefined ? true : m[2]
    }
  }
  return args
}

interface LaunchFn {
  (opts: LaunchOptions): Promise<Browser>
}

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
}

const ENGINES = { chromium, firefox, webkit }

function makeLaunch(browser: BrowserName): LaunchFn {
  const engine = ENGINES[browser]
  return (opts: LaunchOptions) => engine.launch(opts)
}

async function runBenchmark(
  args: Record<string, string | boolean>,
  { launch = makeLaunch("chromium"), browser = "chromium" }: BenchOptions = {},
): Promise<BenchOutput> {
  const htmlPath = path.resolve(
    typeof args.html === "string" ? args.html : path.join(root, "index.html"),
  )
  if (!fs.existsSync(htmlPath)) {
    throw new Error(`HTML file not found: ${htmlPath}`)
  }

  const timeout =
    typeof args.timeout === "string"
      ? Number.parseInt(args.timeout, 10)
      : 300_000
  const headless = args.headless === "false" ? false : true

  // Playwright manages engine-appropriate launch args itself; passing
  // Chrome-only flags (e.g. --no-sandbox) breaks Firefox/WebKit launches.
  // Chromium sandbox flags are added only for chromium.
  const launchOpts: LaunchOptions = { headless }
  if (browser === "chromium") {
    launchOpts.args = ["--no-sandbox", "--disable-setuid-sandbox", "--disable-dev-shm-usage"]
  }
  if (args["executable-path"]) {
    launchOpts.executablePath = String(args["executable-path"])
  }

  console.log(`Launching ${browser} (headless=${headless})...`)
  const browserInstance = await launch(launchOpts)
  const page = await browserInstance.newPage()

  const browserErrors: string[] = []
  const isAllowed = (text: string) =>
    ALLOWED_CONSOLE_ERRORS.some((pattern) => pattern.test(text))
  page.on("pageerror", (err: unknown) => {
    const text = String(err)
    if (!isAllowed(text)) browserErrors.push(text)
  })
  page.on("console", (msg) => {
    if (msg.type() === "error") {
      const text = msg.text()
      if (!isAllowed(text)) browserErrors.push(text)
    }
  })

  const pageUrl =
    typeof args.url === "string" ? args.url : `file://${htmlPath}`

  try {
    console.log(`Loading ${pageUrl} ...`)
    await page.goto(pageUrl, { waitUntil: "load" })

    await page.waitForFunction(
      () =>
        (document.querySelector("#samples") as HTMLElement).textContent!.trim()
          .length > 0,
      undefined,
      { timeout: 15_000 },
    )

    async function setInput(
      id: string,
      val: string | boolean | undefined,
    ): Promise<void> {
      if (val === undefined) {
        return
      }
      await page.$eval(
        `#${id}`,
        (el, v) => {
          ;(el as HTMLInputElement).value = v as string
        },
        String(val),
      )
    }
    await setInput("nSync", args["n-sync"])
    await setInput("nAsync", args["n-async"])
    await setInput("nColl", args["n-coll"])

    console.log("Starting benchmark run (runAll())...")
    // Schedule runAll on a macrotask and return immediately. page.click /
    // dispatchEvent would block waiting for the long-running (mostly
    // synchronous) benchmark handler to settle; this fires-and-forgets so the
    // subsequent waitForFunction can poll #log for "Done." instead.
    await page.evaluate(() => {
      setTimeout(() => (window as unknown as { runAll: () => void }).runAll(), 0)
    })

    await page.waitForFunction(
      () =>
        (document.querySelector("#log") as HTMLElement).textContent!.includes(
          "Done.",
        ),
      undefined,
      { timeout },
    )

    const logText = await page.$eval(
      "#log",
      (el) => (el as HTMLElement).textContent!,
    )

    async function scrapeTable(id: string): Promise<string[][]> {
      return page.$$eval(`#${id} tbody tr`, (rows: Element[]) =>
        rows.map((tr: Element) =>
          [...tr.children].map((td) => (td as HTMLElement).textContent!.trim()),
        ),
      )
    }
    const headersOf = (id: string): Promise<string[]> =>
      page.$$eval(`#${id} thead th`, (ths: Element[]) =>
        ths.map((th: Element) => (th as HTMLElement).textContent!.trim()),
      )

    const resultsHeaders = await headersOf("resultsTable")
    const resultsRows = await scrapeTable("resultsTable")
    const collHeaders = await headersOf("collTable")
    const collRows = await scrapeTable("collTable")

    const toObjects = (
      headers: string[],
      rows: string[][],
    ): Record<string, string>[] =>
      rows.map((r) => Object.fromEntries(headers.map((h, i) => [h, r[i]])))

    const output: BenchOutput = {
      browser,
      browserErrors,
      collisions: toObjects(collHeaders, collRows),
      htmlPath,
      inputs: {
        nAsync: await page.$eval(
          "#nAsync",
          (el: Element) => (el as HTMLInputElement).value,
        ),
        nColl: await page.$eval(
          "#nColl",
          (el: Element) => (el as HTMLInputElement).value,
        ),
        nSync: await page.$eval(
          "#nSync",
          (el: Element) => (el as HTMLInputElement).value,
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
      const shotPath = path.resolve(
        ((typeof args.out === "string"
          ? args.out
          : "benchmark_results.json") as string).replace(/\.json$/, "") +
          `_${browser}_failure.png`,
      )
      await page.screenshot({ path: shotPath, fullPage: true })
      console.error("Saved failure screenshot to " + shotPath)
    } catch {
      /* best-effort */
    }
    throw error
  } finally {
    await browserInstance.close()
  }
}

function assertRun(output: BenchOutput): void {
  const structured = output.results.find((r) =>
    r["Algorithm"]?.includes("GenoID-structured"),
  )
  const collisionFail = output.collisions.some((c) => Number(c["Collisions found"]) > 0)
  if (output.browserErrors.length) {
    throw new Error(`[${output.browser}] browserErrors: ${output.browserErrors.join("; ")}`)
  }
  if (!structured) {
    throw new Error(`[${output.browser}] GenoID-structured entry missing`)
  }
  if (collisionFail) {
    throw new Error(`[${output.browser}] collisions detected`)
  }
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2))
  const browserArg = typeof args.browser === "string" ? args.browser : "all"
  const targetBrowsers: BrowserName[] =
    browserArg === "all" ? BROWSERS : [browserArg as BrowserName]

  const server = await startServer()
  const runArgs =
    typeof args.url === "string" || typeof args.html === "string"
      ? args
      : { ...args, url: `${server.origin}/index.html` }

  const runs: BenchOutput[] = []
  let failed = false
  try {
    for (const b of targetBrowsers) {
      try {
        const output = await runBenchmark(runArgs, { browser: b })
        runs.push(output)
        console.log(`\n=== Results (${b}) ===`)
        console.table(output.results)
        console.log(`\n=== Collision test (${b}) ===`)
        console.table(output.collisions)
        if (output.browserErrors.length) {
          console.log(`\n=== Browser console errors (${b}) ===`)
          for (const e of output.browserErrors) console.log(" -", e)
        }
        assertRun(output)
        console.log(`[${b}] deployable check PASSED`)
      } catch (error) {
        failed = true
        console.error(`[${b}] run failed:`, (error as Error).message)
      }
    }
  } finally {
    await server.close()
  }

  const outPath = path.resolve(
    typeof args.out === "string" ? args.out : "benchmark_results.json",
  )
  try {
    fs.writeFileSync(outPath, JSON.stringify({ runs }, null, 2))
    console.log(`\nFull JSON written to ${outPath}`)
  } catch (error) {
    console.error(`Failed to write ${outPath}: ${(error as Error).message}`)
  }

  if (failed) {
    process.exitCode = 1
  }
}

if (process.argv[1] === import.meta.filename) {
  main()
}

export { parseArgs, runBenchmark, BROWSERS }
export type { BenchOutput, BrowserName }
