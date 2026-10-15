import { defineConfig, devices } from "@playwright/test";

// Public-only checks: no workspace login or database setup.
export default defineConfig({
  testDir: "./e2e",
  testMatch: ["landing-faq.spec.ts", "landing-breakpoints.spec.ts", "landing-process-motion.spec.ts", "public-responsive.spec.ts", "registration-flow.spec.ts"],
  outputDir: ".cache/faq-playwright",
  fullyParallel: true,
  workers: 1,
  retries: 0,
  use: {
    baseURL: "http://127.0.0.1:3000",
    storageState: { cookies: [], origins: [] },
    contextOptions: { reducedMotion: "reduce" },
    trace: "retain-on-failure",
  },
  projects: [
    { name: "desktop", use: { ...devices["Desktop Chrome"] } },
    { name: "webkit", use: { ...devices["Desktop Safari"] }, testMatch: ["landing-faq.spec.ts", "landing-breakpoints.spec.ts", "landing-process-motion.spec.ts", "registration-flow.spec.ts"] },
  ],
  webServer: {
    command: "corepack pnpm dev --hostname 127.0.0.1 --port 3000",
    url: "http://127.0.0.1:3000",
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});
