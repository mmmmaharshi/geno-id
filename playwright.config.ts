import { defineConfig } from "@playwright/test"

export default defineConfig({
  testDir: "./tests",
  timeout: 300_000,
  fullyParallel: false,
  reporter: [["list"]],
  use: {
    headless: true,
    launchOptions: {
      args: ["--no-sandbox", "--disable-setuid-sandbox", "--disable-dev-shm-usage"],
    },
  },
  projects: [
    { name: "chromium", use: { browserName: "chromium" } },
  ],
})
