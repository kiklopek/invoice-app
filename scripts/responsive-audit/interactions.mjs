import { mkdir, writeFile, readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { chromium, webkit, expect } from "@playwright/test";
import { fixtures, NOW } from "./fixtures.mjs";
import { startHarness, installNetwork } from "./harness.mjs";
const source = "/tmp/splatno-responsive-production-26defdc",
  out = resolve("artifacts/responsive-audit/2026-11-02/interactions");
await mkdir(out, { recursive: true });
const h = await startHarness(source, "interactions", 4375),
  results = await readFile(resolve(out, "results.json"), "utf8")
    .then(JSON.parse)
    .catch(() => []);
const only = process.argv
  .find((a) => a.startsWith("--only="))
  ?.slice(7)
  .split(",");
const selectedEngine = process.argv
  .find((a) => a.startsWith("--engine="))
  ?.slice(9);
try {
  for (const engine of [chromium, webkit].filter(
    (e) => !selectedEngine || e.name() === selectedEngine,
  )) {
    const browser = await engine.launch();
    try {
      async function run(name, width, height, route, action, mobile = false) {
        if (only && !only.includes(name)) return;
        if (
          results.some(
            (r) =>
              r.name === name &&
              r.width === width &&
              r.engine === engine.name() &&
              r.status === "observed",
          )
        )
          return;
        const context = await browser.newContext({
            viewport: { width, height },
            screen: { width, height },
            hasTouch: mobile,
            isMobile: mobile,
            locale: "cs-CZ",
            timezoneId: "Europe/Prague",
            reducedMotion: "reduce",
          }),
          page = await context.newPage(),
          requests = [],
          errors = [];
        page.on("pageerror", (e) => errors.push(e.message));
        const data = await fixtures(source);
        await page.clock.setFixedTime(new Date(NOW));
        await page.addInitScript((d) => (window.__AUDIT_DATA__ = d), data);
        await installNetwork(page, data, "normal", requests);
        const row = {
          name,
          width,
          height,
          route,
          engine: engine.name(),
          requests,
          errors,
        };
        try {
          await page.goto(h.url + route);
          await page.locator("h1").first().waitFor();
          await page.evaluate(() => document.fonts.ready);
          row.evidence = await action(page, data, requests);
          row.screenshot = `${engine.name()}-${name}-${width}.png`;
          await page.screenshot({
            path: resolve(out, row.screenshot),
            fullPage: true,
            animations: "disabled",
          });
          row.status = "observed";
        } catch (e) {
          row.status = "failed-check";
          row.failure = String(e).slice(0, 700);
        }
        results.push(row);
        await writeFile(
          resolve(out, "results.json"),
          JSON.stringify(results, null, 2),
        );
        await context.close();
        console.log(`${engine.name()} ${name}: ${row.status}`);
      }
      await run(
        "mobile-navigation",
        390,
        844,
        "/invoices",
        async (p) => {
          await p
            .getByRole("button", { name: "Otevřít navigaci", exact: true })
            .click();
          const menu = p.getByRole("navigation", {
            name: "Mobilní navigace",
            exact: true,
          });
          await expect(menu).toBeVisible();
          const before = await p.evaluate(() => ({
            locked: document.body.classList.contains("mobile-navigation-lock"),
            width: innerWidth,
          }));
          await p.keyboard.press("Escape");
          await expect(
            p.getByRole("button", { name: "Otevřít navigaci", exact: true }),
          ).toHaveAttribute("aria-expanded", "false");
          return before;
        },
        true,
      );
      await run(
        "invoice-row-dialog",
        390,
        844,
        "/invoices",
        async (p) => {
          await p
            .getByRole("button", { name: /Akce faktury/ })
            .first()
            .click();
          const menu = p.getByRole("dialog", { name: /Akce faktury/ });
          await expect(menu).toBeVisible();
          const box = await menu.boundingBox();
          await menu
            .getByRole("button", { name: "Potvrdit úhradu", exact: true })
            .click();
          const dialog = p.locator("dialog[open]");
          await expect(dialog).toBeVisible();
          const b = await dialog.boundingBox();
          await p
            .getByRole("button", {
              name: "Zavřít potvrzení úhrady",
              exact: true,
            })
            .click();
          await expect(dialog).toHaveCount(0);
          return {
            menu: box,
            dialog: b,
            menuWithinViewport: box.x >= 0 && box.x + box.width <= 390,
            dialogWithinViewport: b.x >= 0 && b.x + b.width <= 390,
          };
        },
        true,
      );
      for (const width of [390, 768, 1024, 1280, 1440])
        await run(
          "customer-contact-access",
          width,
          1024,
          "/customers",
          async (p) => {
            const buttons = p.getByRole("button", {
              name: /Upravit e-mail zákazníka/,
            });
            const count = await buttons.count();
            const visible = await buttons.evaluateAll(
              (nodes) =>
                nodes.filter(
                  (n) =>
                    n.getBoundingClientRect().width > 0 &&
                    n.getBoundingClientRect().height > 0,
                ).length,
            );
            if (visible) {
              await buttons.filter({ visible: true }).first().click();
              await expect(
                p.locator(".customer-email-edit input"),
              ).toBeVisible();
            }
            return {
              accessibleEmailButtons: count,
              visibleEmailEditors: visible,
              visibleContactCells: await p
                .locator(".customer-contact-cell")
                .evaluateAll(
                  (nodes) =>
                    nodes.filter((n) => n.getBoundingClientRect().width > 0)
                      .length,
                ),
            };
          },
        );
      await run(
        "invoice-table-small-laptop",
        1024,
        768,
        "/invoices",
        async (p) => {
          const container = p.locator("[data-invoice-table]");
          const result = await container.evaluate((n) => ({
            clientWidth: n.clientWidth,
            scrollWidth: n.scrollWidth,
            overflow: getComputedStyle(n).overflowX,
          }));
          await container.evaluate((n) => (n.scrollLeft = n.scrollWidth));
          return result;
        },
      );
      await run(
        "manual-form-validation",
        1440,
        900,
        "/invoices/new",
        async (p, data, requests) => {
          const form = p
            .locator("form")
            .filter({ has: p.locator('input[name="invoice_number"]') });
          const target = (await form.count())
            ? form
            : p.locator("main form").first();
          await target.evaluate((n) => n.requestSubmit());
          return {
            invalidInputs: await p.locator("main :invalid").count(),
            writeRequests: requests.filter(
              (r) =>
                !["GET", "HEAD"].includes(r.method) &&
                r.path !== "/api/auth/access",
            ).length,
          };
        },
      );
      await run(
        "creation-retained-values",
        390,
        844,
        "/invoices/create",
        async (p) => {
          const input = p.getByRole("textbox", {
            name: "Název položky 1",
            exact: true,
          });
          await input.fill("Audit — zachovat rozepsaný řádek");
          await p.setViewportSize({ width: 768, height: 1024 });
          await p.setViewportSize({ width: 390, height: 844 });
          await expect(input).toHaveValue("Audit — zachovat rozepsaný řádek");
          return { valueRetained: true };
        },
        true,
      );
      await run(
        "orientation-recovery",
        390,
        844,
        "/invoices/create",
        async (p) => {
          const input = p.getByRole("textbox", {
            name: "Název položky 1",
            exact: true,
          });
          await input.fill("Audit orientace");
          await p.setViewportSize({ width: 844, height: 390 });
          const guard = p.getByRole("heading", {
            name: "Otočte telefon na výšku",
          });
          let appeared = false;
          try {
            await expect(guard).toBeVisible({ timeout: 2000 });
            appeared = true;
          } catch {}
          await p.setViewportSize({ width: 390, height: 844 });
          await expect(guard).not.toBeVisible();
          await expect(input).toHaveValue("Audit orientace");
          return {
            guardObserved: appeared,
            valueRetained: true,
            note: appeared
              ? ""
              : "Browser emulation did not expose phone screen orientation; not a physical-device guard pass",
          };
        },
        true,
      );
      await run(
        "text-200-percent",
        390,
        844,
        "/customers",
        async (p) => {
          await p.evaluate(() => {
            document.documentElement.style.fontSize = "200%";
          });
          return {
            method: "root font size 200%; absolute px text is unaffected",
            overflow: await p.evaluate(
              () => document.documentElement.scrollWidth > innerWidth + 1,
            ),
          };
        },
        true,
      );
      await run(
        "import-csv-state",
        1440,
        900,
        "/invoices/import",
        async (p) => {
          await p.getByRole("button", { name: /Hromadný import/ }).click();
          await expect(p.locator(".csv-dropzone")).toBeVisible();
          return { csvVisible: true };
        },
      );
      await run(
        "text-only-enlargement",
        390,
        844,
        "/customers",
        async (p) => {
          await p.evaluate(() => {
            const nodes = [...document.querySelectorAll("main,main *")].filter(
              (n) => n instanceof HTMLElement,
            );
            const sizes = nodes.map((n) => {
              const s = getComputedStyle(n);
              return {
                n,
                size: parseFloat(s.fontSize),
                line: parseFloat(s.lineHeight),
              };
            });
            for (const { n, size, line } of sizes) {
              n.style.fontSize = 2 * size + "px";
              if (Number.isFinite(line)) n.style.lineHeight = 2 * line + "px";
            }
          });
          return {
            method:
              "all main element font sizes and explicit line heights doubled in DOM; CSS pixel boxes retained",
            overflow: await p.evaluate(
              () => document.documentElement.scrollWidth > innerWidth + 1,
            ),
          };
        },
        true,
      );
      await run(
        "import-processing-boundary",
        1440,
        900,
        "/invoices/import",
        async (p) => {
          await p
            .locator("input[type=file]")
            .first()
            .setInputFiles({
              name: "audit.txt",
              mimeType: "text/plain",
              buffer: Buffer.from("synthetic invalid upload"),
            });
          return {
            visibleValidationMessages: await p
              .locator(".form-error,[role=alert]")
              .allTextContents(),
            note: "Invalid-file boundary only. OCR queue/processing/review not claimed covered.",
          };
        },
      );
    } finally {
      await browser.close();
    }
  }
} finally {
  await h.server.close();
}
