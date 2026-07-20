import { test, expect, type Page } from "@playwright/test"
import http from "node:http"
import fs from "node:fs"
import path from "node:path"

const root = path.resolve(import.meta.dirname, "..")

const MIME: Record<string, string> = {
  ".css": "text/css",
  ".html": "text/html",
  ".js": "text/javascript",
  ".json": "application/json",
  ".mjs": "text/javascript",
}

// Firefox/WebKit refuse ES modules over file://, so serve the repo root over
// HTTP. Mirrors scripts/playwright.ts startServer().
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
        close: () => new Promise<void>((r) => server.close(() => r())),
        origin: `http://127.0.0.1:${port}`,
      })
    })
  })
}

async function runBenchmark(page: Page): Promise<void> {
  await page.waitForFunction(
    () =>
      ((document.querySelector("#samples") as HTMLElement | null)?.textContent
        ?.trim().length ?? 0) > 0,
    undefined,
    { timeout: 15_000 },
  )
  await page.evaluate(() => {
    setTimeout(
      () => (window as unknown as { runAll: () => void }).runAll(),
      0,
    )
  })
  await page.waitForFunction(
    () =>
      (document.querySelector("#log") as HTMLElement | null)?.textContent?.includes(
        "Done.",
      ) ?? false,
    undefined,
    { timeout: 300_000 },
  )
}

let server: { close: () => Promise<void>; origin: string }

test.beforeAll(async () => {
  server = await startServer()
})

test.afterAll(async () => {
  await server?.close()
})

test("benchmark page loads with no console errors", async ({ page }) => {
  const errors: string[] = []
  page.on("pageerror", (e) => errors.push(String(e)))
  page.on("console", (m) => {
    if (m.type() === "error") errors.push(m.text())
  })
  await page.goto(`${server.origin}/index.html`, { waitUntil: "load" })
  await expect(page).toHaveTitle(/.+/)
  expect(errors).toEqual([])
})

test("running the benchmark shows GenoID-structured and zero collisions", async ({
  page,
}) => {
  const errors: string[] = []
  page.on("pageerror", (e) => errors.push(String(e)))

  await page.goto(`${server.origin}/index.html`, { waitUntil: "load" })
  await runBenchmark(page)

  // The structured v8 entry must be present in the results table.
  const structuredRow = page.locator("#resultsTable tbody tr", {
    hasText: "GenoID-structured",
  })
  await expect(structuredRow).toHaveCount(1)

  // Every algorithm row's "Collisions found" column (3rd column) must read 0.
  const collRows = page.locator("#collTable tbody tr")
  const count = await collRows.count()
  expect(count).toBeGreaterThan(0)
  for (let i = 0; i < count; i++) {
    const cells = collRows.nth(i).locator("td")
    const collVal = (await cells.nth(2).textContent())?.trim() ?? ""
    expect(collVal).toBe("0")
  }

  expect(errors).toEqual([])
})
