import { test, expect } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fixtures, NOW } from "./fixtures.mjs";
import { startHarness, installNetwork } from "./harness.mjs";
const source = "/tmp/splatno-responsive-production-26defdc";
let harness, manifest;
test.beforeAll(async () => {
  manifest = JSON.parse(
    await readFile(
      resolve("artifacts/responsive-audit/2026-11-02/approved-baselines.json"),
      "utf8",
    ),
  );
  if (manifest.status !== "approved" || !manifest.macbookViewport)
    throw new Error(
      "BLOCKED: actual MacBook reference and approved visual baselines are missing; measurement screenshots are not approved baselines.",
    );
  harness = await startHarness(source, "visual-regression", 4376);
});
test.afterAll(async () => {
  await harness?.server.close();
});
for (const route of [
  "/dashboard",
  "/invoices",
  "/invoices/import",
  "/customers",
  "/reports",
  "/invoices/create",
]) {
  test(`protected reference ${route}`, async ({ page }) => {
    if (manifest.sourceCommit !== "26defdcc90f9ebaf979d40d23a6c5c7648dd0e0f")
      throw new Error(
        "Reference revision differs; recapture/review explicitly instead of updating snapshots.",
      );
    await page.setViewportSize(manifest.macbookViewport);
    const data = await fixtures(source);
    await page.clock.setFixedTime(new Date(NOW));
    await page.addInitScript((d) => (window.__AUDIT_DATA__ = d), data);
    await installNetwork(page, data, "normal", []);
    await page.goto(harness.url + route);
    await page.locator("h1").first().waitFor();
    await page.evaluate(() => document.fonts.ready);
    await expect(page.locator("[data-audit-error]")).toHaveCount(0);
    await expect(page).toHaveScreenshot(
      `${route.slice(1).replaceAll("/", "-")}-reference.png`,
      {
        fullPage: true,
        animations: "disabled",
        threshold: 0.2,
        maxDiffPixelRatio: 0.001,
      },
    );
  });
}
