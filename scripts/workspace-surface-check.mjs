// Exercise overlays and drafts inside the scaled workspace without real writes.
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { chromium, webkit, expect } from "@playwright/test";
import { startHarness, installNetwork } from "./responsive-audit/harness.mjs";
import { fixtures, NOW } from "./responsive-audit/fixtures.mjs";
const out = resolve("artifacts/workspace-proportions-2026-11-02");
await mkdir(out, { recursive: true });
const harness = await startHarness(process.cwd(), "workspace-surfaces", 4384),
  results = [];
try {
  for (const [engineName, engine] of Object.entries({ chromium, webkit })) {
    const browser = await engine.launch();
    try {
      for (const [width, height] of [
        [2560, 1817],
        [1920, 600],
      ])
        for (const route of [
          "/invoices",
          "/invoices/new",
          "/invoices/create",
          "/reports",
        ]) {
          const context = await browser.newContext({
              viewport: { width, height },
              locale: "cs-CZ",
              timezoneId: "Europe/Prague",
            }),
            page = await context.newPage(),
            requests = [];
          const data = await fixtures(process.cwd());
          await page.clock.setFixedTime(new Date(NOW));
          await page.addInitScript((d) => {
            window.__AUDIT_DATA__ = d;
          }, data);
          await installNetwork(page, data, "normal", requests);
          const result = {
            engine: engineName,
            route,
            width,
            height,
            status: "failed",
          };
          try {
            await page.goto(harness.url + route);
            await page.locator("h1").first().waitFor();
            if (route === "/invoices") {
              await page
                .getByRole("button", { name: /^Akce faktury/ })
                .first()
                .click();
              const menu = page.getByRole("dialog", { name: /^Akce faktury/ });
              await expect(menu).toBeVisible();
              result.menu = await menu.boundingBox();
              await menu
                .getByRole("button", { name: "Potvrdit úhradu", exact: true })
                .click();
              const dialog = page.locator("dialog[open]");
              await expect(dialog).toBeVisible();
              result.dialog = await dialog.boundingBox();
              await page
                .getByRole("button", {
                  name: "Zavřít potvrzení úhrady",
                  exact: true,
                })
                .click();
              await expect(dialog).toHaveCount(0);
            } else if (route === "/invoices/new") {
              const input = page.getByLabel("Číslo faktury *", { exact: true });
              await input.fill("ROZEPSANA-2026");
              await page.setViewportSize({ width: 1440, height: 900 });
              await expect(input).toHaveValue("ROZEPSANA-2026");
              await page.setViewportSize({ width, height });
              await expect(input).toHaveValue("ROZEPSANA-2026");
              result.draftPreserved = true;
            } else if (route === "/invoices/create") {
              await page
                .getByRole("button", {
                  name: "Pravidla číslování",
                  exact: true,
                })
                .click();
              const dialog = page.getByRole("dialog", {
                name: "Číslo a variabilní symbol",
                exact: true,
              });
              await expect(dialog).toBeVisible();
              result.dialog = await dialog.boundingBox();
              await dialog
                .getByRole("button", { name: "Rozumím", exact: true })
                .click();
              await expect(dialog).not.toBeVisible();
            } else {
              await page
                .getByRole("button", { name: "Exportovat report", exact: true })
                .click();
              const dialog = page.getByRole("dialog", {
                name: "Exportovat finanční report",
                exact: true,
              });
              await expect(dialog).toBeVisible();
              result.dialog = await dialog.boundingBox();
              await page
                .getByRole("button", { name: "Zavřít export", exact: true })
                .click();
              await expect(dialog).not.toBeVisible();
            }
            for (const box of [result.menu, result.dialog].filter(Boolean)) {
              expect(box.x).toBeGreaterThanOrEqual(-1);
              expect(box.y).toBeGreaterThanOrEqual(-1);
              expect(box.x + box.width).toBeLessThanOrEqual(width + 1);
              expect(box.y + box.height).toBeLessThanOrEqual(height + 1);
            }
            result.status = "passed";
          } catch (error) {
            result.failure = String(error);
            process.exitCode = 1;
          }
          result.syntheticRequests = requests;
          results.push(result);
          await writeFile(
            resolve(out, "surface-checks.json"),
            JSON.stringify(results, null, 2),
          );
          console.log(
            `${engineName} ${route} ${width}x${height}: ${result.status}${result.failure ? " " + result.failure : ""}`,
          );
          await context.close();
        }
    } finally {
      await browser.close();
    }
  }
} finally {
  await harness.server.close();
}
