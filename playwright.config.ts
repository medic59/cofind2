import { defineConfig, devices } from "@playwright/test";

// E2E_BASE_URL points at a disposable stack in CI (specs register users / create
// listings, so do NOT run register/create against production).
const baseURL = process.env.E2E_BASE_URL || "http://localhost:8092";

export default defineConfig({
  testDir: "./e2e",
  timeout: 30_000,
  expect: { timeout: 10_000 },
  fullyParallel: false,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [["github"], ["list"]] : "list",
  use: {
    baseURL,
    trace: "on-first-retry",
    screenshot: "only-on-failure"
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }]
});
