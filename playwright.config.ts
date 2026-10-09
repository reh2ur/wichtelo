import { config } from "dotenv";
import { defineConfig, devices } from "@playwright/test";

config({ path: ".env.e2e.local", quiet: true });

const baseURL = process.env.PLAYWRIGHT_BASE_URL ?? "https://localhost:3000";
const isExternalTarget = !!process.env.PLAYWRIGHT_BASE_URL;

export default defineConfig({
  testDir: "./e2e",
  globalTeardown: "./e2e/global-teardown",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: process.env.CI
    ? [
        ["list"],
        ["github"],
        ["json", { outputFile: "playwright-report/results.json" }],
        ["html", { open: "never" }],
      ]
    : "list",
  use: {
    baseURL,
    trace: "on-first-retry",
    ignoreHTTPSErrors: baseURL.includes("localhost"),
    // Same headers as e2e/helpers.ts browserExtraHeaders(): Vercel bypass plus
    // the shared secret that unlocks server-side E2E backdoors (devOtp).
    extraHTTPHeaders: {
      ...(process.env.VERCEL_AUTOMATION_BYPASS_SECRET
        ? {
            "x-vercel-protection-bypass":
              process.env.VERCEL_AUTOMATION_BYPASS_SECRET,
          }
        : {}),
      ...(process.env.E2E_TEST_SECRET
        ? { "x-e2e-secret": process.env.E2E_TEST_SECRET }
        : {}),
    },
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
  webServer:
    process.env.CI || isExternalTarget
      ? undefined
      : {
          command: "pnpm dev",
          url: baseURL,
          reuseExistingServer: true,
        },
});
