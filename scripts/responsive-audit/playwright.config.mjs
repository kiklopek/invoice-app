import { defineConfig } from "@playwright/test";
export default defineConfig({
  testDir: ".",
  testMatch: "visual.spec.mjs",
  workers: 1,
  fullyParallel: false,
  updateSnapshots: "none",
  outputDir: "../../.cache/responsive-audit/playwright-results",
  reporter: "list",
  snapshotPathTemplate:
    "../../artifacts/responsive-audit/approved/{platform}/{projectName}/{testFilePath}/{arg}{ext}",
  use: {
    locale: "cs-CZ",
    timezoneId: "Europe/Prague",
    reducedMotion: "reduce",
  },
  projects: [
    { name: "chromium", use: { browserName: "chromium" } },
    { name: "webkit", use: { browserName: "webkit" } },
  ],
});
