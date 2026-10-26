import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";
import { chromium, expect } from "@playwright/test";
import { reportsFixture } from "./reports-design-fixtures.mjs";
const project = process.cwd(),
  fixture = resolve(".cache/reports-design"),
  output = resolve("docs/redesign/visual-validation/reports");
await mkdir(fixture, { recursive: true });
await mkdir(output, { recursive: true });
await writeFile(
  resolve(fixture, "index.html"),
  '<html lang="cs"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><div id="root"></div><script type="module" src="/entry.tsx"></script></html>',
);
await writeFile(
  resolve(fixture, "link.tsx"),
  "import{createElement}from'react';export default function Link({children,prefetch:_p,...props}){return createElement('a',props,children)}",
);
await writeFile(
  resolve(fixture, "image.tsx"),
  "import{createElement}from'react';export default function Image({priority:_p,preload:_pr,fill:_f,unoptimized:_u,...props}){return createElement('img',props)}",
);
await writeFile(
  resolve(fixture, "navigation.tsx"),
  "export function usePathname(){return location.pathname}export function useRouter(){return{push:url=>location.assign(url),replace:url=>location.replace(url),prefetch:()=>{},refresh:()=>{}}}export function useSearchParams(){return new URLSearchParams(location.search)}",
);
await writeFile(
  resolve(fixture, "entry.tsx"),
  `import React from 'react';import{createRoot}from'react-dom/client';import '${project}/src/app/globals.css';import '${project}/src/app/minimal.css';import '${project}/src/app/styles/responsive.css';import{AppShell}from'${project}/src/components/layout/app-shell';import{WorkspaceDataProvider}from'${project}/src/components/workspace-data-provider';import{ToastProvider}from'${project}/src/components/toast';import{ReportsClient}from'${project}/src/app/(workspace)/reports/reports-client';import{reportsFixture}from'${project}/scripts/reports-design-fixtures.mjs';const q=new URLSearchParams(location.search);createRoot(document.getElementById('root')).render(<WorkspaceDataProvider><ToastProvider><AppShell initialProfile={{role:q.get('role')||'admin',name:'Tomáš R.',email:'fixture@example.invalid',companyName:'Demo firma s.r.o.',vatPayer:q.get('vat')!=='false'}}><ReportsClient initialData={reportsFixture(q.get('mode')||'populated')} initialFrom="2026-01-01" initialTo="2026-10-23" initialGeneratedAt="2026-10-23T08:00:00Z"/></AppShell></ToastProvider></WorkspaceDataProvider>);`,
);
const require = createRequire(import.meta.url),
  vr = createRequire(require.resolve("vitest/config"));
const { createServer } = await import(pathToFileURL(vr.resolve("vite")).href);
const server = await createServer({
  configFile: false,
  root: fixture,
  publicDir: resolve("public"),
  logLevel: "error",
  server: {
    host: "127.0.0.1",
    port: 4351,
    strictPort: true,
    fs: { allow: [project] },
  },
  esbuild: { jsx: "automatic" },
  css: { postcss: { plugins: [] } },
  resolve: {
    alias: [
      { find: "next/link", replacement: resolve(fixture, "link.tsx") },
      { find: "next/image", replacement: resolve(fixture, "image.tsx") },
      {
        find: "next/navigation",
        replacement: resolve(fixture, "navigation.tsx"),
      },
      { find: "@", replacement: resolve("src") },
    ],
    dedupe: ["react", "react-dom"],
  },
});
await server.listen();
const browser = await chromium.launch();
const results = [];
async function pageFor(width = 1536, height = 1024, query = "") {
  const page = await browser.newPage({
      viewport: { width, height },
      locale: "cs-CZ",
    }),
    requests = [],
    errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.route("**/api/**", async (route) => {
    const url = new URL(route.request().url());
    requests.push(url);
    if (url.pathname === "/api/reports") {
      if (url.searchParams.get("format") === "xlsx")
        return route.fulfill({
          contentType:
            "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
          body: "isolated-export",
        });
      return route.fulfill({
        json: reportsFixture(
          url.searchParams.get("currency") === "EUR" ? "eur" : "populated",
        ),
      });
    }
    if (url.pathname === "/api/notifications") return route.fulfill({ json: { items: [], unread_count: 0, total: 0, has_more: false, through: "2026-10-25T10:00:00Z", next_cursor: null } });
    return route.fulfill({
      json: { count: 35, invoices: [], items: [], unread: 0 },
    });
  });
  await page.goto(`http://127.0.0.1:4351/reports${query}`);
  await expect(page.getByRole("tabpanel")).toBeVisible();
  await page.evaluate(() => document.fonts.ready);
  return { page, requests, errors };
}
async function check(name, run) {
  await run();
  results.push({ name, passed: true });
  console.log("PASS " + name);
}
try {
  for (const width of [320, 390, 1536]) {
    await check(`notification bell and panel ${width}px`, async () => {
      const c = await pageFor(width, 844);
      try {
        const bell = c.page.getByTitle("Oznámení", { exact: true });
        await expect(bell).toBeVisible();
        const centered = await bell.evaluate(element => {
          const b = element.getBoundingClientRect(), i = element.querySelector("svg").getBoundingClientRect();
          return Math.abs(b.width - b.height) < 1 && Math.abs(b.x + b.width / 2 - i.x - i.width / 2) < 1 && Math.abs(b.y + b.height / 2 - i.y - i.height / 2) < 1;
        });
        expect(centered).toBe(true);
        await bell.click();
        const panel = c.page.getByRole("region", { name: "Panel oznámení" });
        await expect(panel).toBeVisible();
        await expect(panel).toContainText("Zatím žádná oznámení");
        const box = await panel.boundingBox();
        expect(box.x).toBeGreaterThanOrEqual(0);
        expect(box.x + box.width).toBeLessThanOrEqual(width);
        await c.page.screenshot({ path: resolve(output, `notifications-${width}.png`), fullPage: false });
        await c.page.keyboard.press("Escape");
        await expect(panel).not.toBeVisible();
        await expect(bell).toBeFocused();
        await c.page.keyboard.press("Enter");
        await expect(panel).toBeVisible();
        await c.page.mouse.click(2, 500);
        await expect(panel).not.toBeVisible();
        expect(c.errors).toEqual([]);
      } finally { await c.page.close(); }
    });
  }
  for (const [width, height] of [
    [1536, 1024],
    [1440, 900],
    [390, 844],
    [320, 568],
    [768, 1024],
    [1024, 768],
    [1280, 800],
    [1920, 1080],
  ])
    await check(`four reports layout ${width}x${height}`, async () => {
      const c = await pageFor(width, height);
      try {
        for (const [label, key] of [
          ["Tržby", "revenue"],
          ["DPH", "vat"],
          ["Pohledávky", "receivables"],
          ["Platby", "payments"],
        ]) {
          await c.page.getByRole("tab", { name: label, exact: true }).click();
          await expect(
            c.page.getByRole("heading", { name: label, exact: true }),
          ).toBeVisible();
          expect(
            await c.page.evaluate(
              () => document.documentElement.scrollWidth <= innerWidth,
            ),
          ).toBe(true);
          if (key === "receivables") {
            await expect(
              c.page.getByRole("heading", {
                name: "Struktura pohledávek",
                exact: true,
              }),
            ).toHaveCount(0);
            const discipline = c.page.getByRole("heading", {
              name: "Platební disciplína",
              exact: true,
            });
            await expect(discipline).toBeVisible();
            await expect(
              discipline.locator("xpath=ancestor::article"),
            ).toContainText("18,5 dní");
          }
          const summary = c.page.getByRole("group", {
            name: "Souhrn reportu",
            exact: true,
          });
          const topEdges = await summary
            .locator("article:visible")
            .evaluateAll((elements) =>
              elements.map((element) =>
                Math.round(element.getBoundingClientRect().top),
              ),
            );
          expect(new Set(topEdges).size).toBe(1);
          const firstValue = summary.locator("article:visible > strong").first();
          await expect(firstValue).toHaveAttribute("title", /.+/);
          const invalidAmounts = await c.page
            .getByRole("tabpanel")
            .locator("article:visible > strong")
            .evaluateAll((elements) =>
              elements
                .filter((element) => {
                  const box = element.getBoundingClientRect();
                  const range = document.createRange();
                  range.selectNodeContents(element);
                  const text = range.getBoundingClientRect();
                  return (
                    element.scrollWidth > element.clientWidth + 1 ||
                    text.width > box.width + 1 ||
                    text.height >
                      parseFloat(getComputedStyle(element).lineHeight) + 1
                  );
                })
                .map((element) => element.textContent),
            );
          expect(invalidAmounts).toEqual([]);
          await c.page.screenshot({
            path: resolve(output, `${key}-${width}x${height}.png`),
            fullPage: true,
          });
        }
        expect(c.errors).toEqual([]);
      } finally {
        await c.page.close();
      }
    });
  for (const width of [320, 390, 768, 1024, 1280, 1440, 1536, 1920]) {
    await check(
      `aging alignment with changing amounts ${width}px`,
      async () => {
        const c = await pageFor(width, 1024, "?mode=changing-aging");
        try {
          await c.page
            .getByRole("tab", { name: "Pohledávky", exact: true })
            .click();
          const list = c.page.getByRole("list", {
            name: "Pohledávky podle stáří",
          });
          const geometry = await list.evaluate((element) => {
            const listBox = element.getBoundingClientRect();
            const cardBox = element.closest("article").getBoundingClientRect();
            return {
              centered:
                Math.abs(
                  listBox.left - cardBox.left - (cardBox.right - listBox.right),
                ) < 2,
              bars: [...element.querySelectorAll(":scope > div > i")].map(
                (bar) => ({
                  left: bar.getBoundingClientRect().left,
                  width: bar.getBoundingClientRect().width,
                }),
              ),
              amounts: [
                ...element.querySelectorAll(":scope > div > strong"),
              ].map((amount) => ({
                right: amount.getBoundingClientRect().right,
                fits:
                  amount.scrollWidth <= amount.clientWidth + 1 &&
                  amount.getBoundingClientRect().right <= listBox.right + 1,
              })),
            };
          });
          expect(geometry.centered).toBe(true);
          expect(geometry.bars).toHaveLength(5);
          expect(
            Math.max(...geometry.bars.map((bar) => bar.left)) -
              Math.min(...geometry.bars.map((bar) => bar.left)),
          ).toBeLessThan(1);
          expect(
            Math.max(...geometry.bars.map((bar) => bar.width)) -
              Math.min(...geometry.bars.map((bar) => bar.width)),
          ).toBeLessThan(1);
          expect(geometry.amounts.every((amount) => amount.fits)).toBe(true);
          expect(
            Math.max(...geometry.amounts.map((amount) => amount.right)) -
              Math.min(...geometry.amounts.map((amount) => amount.right)),
          ).toBeLessThan(1);
          if (width === 1536 || width === 390)
            await c.page.screenshot({
              path: resolve(output, `aging-changing-${width}.png`),
              fullPage: true,
            });
          expect(c.errors).toEqual([]);
        } finally {
          await c.page.close();
        }
      },
    );
  }
  for (const width of [1536, 390]) {
    await check(`real export chevron and close icon ${width}px`, async () => {
      const c = await pageFor(width, width === 390 ? 844 : 1024);
      try {
        if (width < 768) {
          const trigger = c.page.getByRole("button", { name: "Exportovat report", exact: true });
          await trigger.click();
          await expect(c.page.getByRole("dialog", { name: "Exportovat", exact: true })).toBeVisible();
          await c.page.keyboard.press("Escape");
          await expect(trigger).toBeFocused();
        } else {
        const trigger = c.page
          .locator("summary")
          .filter({ hasText: "Exportovat" });
        const arrow = trigger.locator(".ui-chevron");
        const centered = await trigger.evaluate((element) => {
          const box = element.getBoundingClientRect(),
            icon = element.querySelector(".ui-chevron").getBoundingClientRect();
          return (
            Math.abs(box.top + box.height / 2 - icon.top - icon.height / 2) < 1
          );
        });
        expect(centered).toBe(true);
        const box = await arrow.boundingBox();
        await c.page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
        await expect(
          c.page.getByRole("button", {
            name: "Exportovat do Excelu",
            exact: true,
          }),
        ).toBeVisible();
        await expect
          .poll(() =>
            arrow.evaluate(
              (element) => new DOMMatrix(getComputedStyle(element).transform).a,
            ),
          )
          .toBeCloseTo(-1, 2);
        await trigger.press("Space");
        await expect
          .poll(() =>
            arrow.evaluate((element) => {
              const value = getComputedStyle(element).transform;
              return value === "none" ? 1 : new DOMMatrix(value).a;
            }),
          )
          .toBeCloseTo(1, 2);
        }
        await c.page
          .getByRole("button", { name: "Přehled odběratelů", exact: true })
          .click();
        const close = c.page.getByRole("button", {
          name: "Zavřít přehled odběratelů",
          exact: true,
        });
        expect(
          await close.evaluate((element) => {
            const box = element.getBoundingClientRect(),
              icon = element
                .querySelector(".ui-close-icon")
                .getBoundingClientRect();
            return (
              Math.abs(box.top + box.height / 2 - icon.top - icon.height / 2) <
                1 &&
              Math.abs(box.left + box.width / 2 - icon.left - icon.width / 2) <
                1
            );
          }),
        ).toBe(true);
        const cross = await close.locator(".ui-close-icon").boundingBox();
        await c.page.mouse.click(
          cross.x + cross.width / 2,
          cross.y + cross.height / 2,
        );
        await expect(c.page.getByRole("dialog")).toHaveCount(0);
        expect(c.errors).toEqual([]);
      } finally {
        await c.page.close();
      }
    });
  }
  for (const width of [1536, 390]) {
    await check(`searchable customer modal ${width}px`, async () => {
      const c = await pageFor(width, width === 390 ? 844 : 1024);
      try {
        const trigger = c.page.getByRole("button", {
          name: "Přehled odběratelů",
          exact: true,
        });
        await trigger.click();
        const dialog = c.page.getByRole("dialog", {
          name: "Přehled odběratelů",
          exact: true,
        });
        await expect(dialog).toBeVisible();
        const search = dialog.getByRole("searchbox", {
          name: "Hledat odběratele",
        });
        await expect(search).toBeFocused();
        expect(
          await search.evaluate((element) => {
            const style = getComputedStyle(element);
            return style.outlineStyle === "none" && style.boxShadow === "none";
          }),
        ).toBe(true);
        const list = dialog.getByLabel("Seznam odběratelů");
        expect(
          await list.evaluate(
            (element) => element.scrollHeight > element.clientHeight,
          ),
        ).toBe(true);
        expect(
          await dialog.evaluate((element) => {
            const r = element.getBoundingClientRect();
            return (
              r.left >= 0 &&
              r.right <= innerWidth &&
              r.top >= 0 &&
              r.bottom <= innerHeight
            );
          }),
        ).toBe(true);
        await c.page.screenshot({
          path: resolve(output, `customers-modal-${width}.png`),
          fullPage: false,
        });
        await search.fill("nenalezeny_odberatel_xyz");
        await expect(dialog).toContainText(
          "Žádný odběratel neodpovídá hledání.",
        );
        await c.page.keyboard.press("Escape");
        await expect(dialog).toHaveCount(0);
        await expect(trigger).toBeFocused();
        await trigger.click();
        await expect(search).toHaveValue("");
        await search.fill("jedenact");
        await expect(
          dialog.getByRole("button", { name: /Odběratel jedenáct/ }),
        ).toBeVisible();
        await expect(list).not.toContainText("0 Kč");
        await dialog
          .getByRole("button", { name: /Odběratel jedenáct/ })
          .click();
        await expect(dialog).toHaveCount(0);
        await expect
          .poll(() => c.requests.at(-1)?.searchParams.get("customer"))
          .toBe("Odběratel jedenáct");
        if (width < 768) {
          const trigger = c.page.getByRole("button", { name: "Otevřít filtry", exact: true });
          await expect(trigger.locator("span")).toHaveText("1");
          await trigger.click();
          const sheet = c.page.getByRole("dialog", { name: "Filtry", exact: true });
          await expect(sheet.getByLabel("Odběratel", { exact: true })).toHaveValue("Odběratel jedenáct");
          await sheet.getByRole("button", { name: "Resetovat", exact: true }).click();
          await sheet.getByRole("button", { name: "Použít filtry", exact: true }).click();
          await expect(c.page.getByRole("tabpanel")).toBeVisible();
          await expect(trigger.locator("span")).toHaveCount(0);
        } else {
        const activeFilters = c.page.getByRole("group", {
          name: "Aktivní filtry",
          exact: true,
        });
        await expect(activeFilters).toContainText("Odběratel jedenáct");
        await c.page.screenshot({
          path: resolve(output, `customer-filter-${width}.png`),
          fullPage: true,
        });
        await activeFilters
          .getByRole("button", { name: "Zrušit filtr odběratele", exact: true })
          .click();
        await expect(activeFilters).toHaveCount(0);
        await c.page.getByText("Další filtry", { exact: false }).click();
        await expect(
          c.page.getByLabel("Odběratel", { exact: true }),
        ).toHaveValue("all");
        await expect(c.page.getByLabel("Měna", { exact: true })).toHaveValue(
          "CZK",
        );
        await expect(c.page.getByLabel("Od", { exact: true })).toHaveValue(
          "2026-01-01",
        );
        }
        expect(c.errors).toEqual([]);
      } finally {
        await c.page.close();
      }
    });
  }
  await check(
    "filters persist across tabs and currency uses only returned filtered data",
    async () => {
      const c = await pageFor();
      try {
        await c.page.getByText("Další filtry", { exact: false }).click();
        const selects = await c.page
          .locator("select")
          .evaluateAll((elements) =>
            elements.map((element) => ({
              name: element.getAttribute("aria-label"),
              image: getComputedStyle(element).backgroundImage,
              padding: parseFloat(getComputedStyle(element).paddingRight),
            })),
          );
        expect(selects.length).toBeGreaterThanOrEqual(4);
        for (const select of selects) {
          expect(select.image, select.name).toContain("data:image/svg+xml");
          expect(select.padding, select.name).toBeGreaterThanOrEqual(40);
        }
        await c.page.getByLabel("Měna", { exact: true }).selectOption("EUR");
        await expect(c.page.getByRole("tabpanel")).toContainText("1 210,5");
        await c.page.getByRole("tab", { name: "DPH", exact: true }).click();
        await expect(c.page.getByLabel("Měna", { exact: true })).toHaveValue(
          "EUR",
        );
        await expect(c.page.getByRole("tabpanel")).toContainText("1 000,41");
        await c.page
          .getByLabel("Stav", { exact: true })
          .selectOption("cancelled");
        await expect
          .poll(() => c.requests.at(-1)?.searchParams.get("status"))
          .toBe("cancelled");
        await c.page.getByRole("tab", { name: "Platby", exact: true }).click();
        await expect(
          c.page.getByText("Celá firma, všechny měny.", { exact: false }),
        ).toBeVisible();
        await c.page.getByRole("tab", { name: "Tržby", exact: true }).click();
        await expect(c.page.getByLabel("Stav", { exact: true })).toHaveValue(
          "cancelled",
        );
        await c.page.getByRole("tab", { name: "DPH", exact: true }).focus();
        await c.page.keyboard.press("ArrowRight");
        await expect(
          c.page.getByRole("tab", { name: "Pohledávky", exact: true }),
        ).toBeFocused();
      } finally {
        await c.page.close();
      }
    },
  );
  await check(
    "customer drilldown, keyboard chart tooltip and constrained table details",
    async () => {
      const c = await pageFor();
      try {
        const chart = c.page.locator('[aria-label^="led "]').first();
        const column = c.page
          .locator('[role="tabpanel"] [role="tooltip"]')
          .first()
          .locator("..");
        await column.focus();
        await expect(column.getByRole("tooltip")).toBeVisible();
        await c.page.getByRole("button", { name: /WOOD & PAPER/ }).click();
        await expect
          .poll(() => c.requests.at(-1)?.searchParams.get("customer"))
          .toBe("WOOD & PAPER a.s.");
        await c.page
          .getByRole("tab", { name: "Pohledávky", exact: true })
          .click();
        await expect(
          c.page.getByRole("tabpanel").locator("tbody tr"),
        ).toHaveCount(7); // five debtors plus collapsed DSO's two rows
        void chart;
      } finally {
        await c.page.close();
      }
    },
  );
  await check(
    "loading, error, retry and export disabled until current filter resolves",
    async () => {
      const c = await pageFor();
      try {
        let fail = true;
        await c.page.route("**/api/reports?**", async (route) => {
          await new Promise((r) => setTimeout(r, 250));
          return fail
            ? route.fulfill({ status: 500, json: { error: "Fixture failure" } })
            : route.fulfill({ json: reportsFixture() });
        });
        await c.page.getByText("Další filtry", { exact: false }).click();
        await c.page.getByLabel("Od", { exact: true }).fill("2026-02-01");
        await expect(
          c.page.getByRole("status").filter({ hasText: "Připravuji report" }),
        ).toBeVisible();
        await expect(c.page.getByRole("alert")).toContainText(
          "Report se nepodařilo načíst",
        );
        await expect(c.page.getByRole("tabpanel")).toHaveCount(0);
        fail = false;
        await c.page.getByRole("button", { name: "Zkusit znovu" }).click();
        await expect(c.page.getByRole("tabpanel")).toBeVisible();
        await c.page
          .locator("summary")
          .filter({ hasText: "Exportovat" })
          .click();
        const [exportRequest] = await Promise.all([
          c.page.waitForRequest(
            (r) => new URL(r.url()).searchParams.get("format") === "xlsx",
          ),
          c.page.getByRole("button", { name: "Exportovat do Excelu" }).click(),
        ]);
        expect(new URL(exportRequest.url()).searchParams.get("from")).toBe(
          "2026-02-01",
        );
      } finally {
        await c.page.close();
      }
    },
  );
  for (const mode of ["empty", "negative"])
    await check(`all reports ${mode}`, async () => {
      const c = await pageFor(390, 844, `?mode=${mode}`);
      try {
        for (const label of ["Tržby", "DPH", "Pohledávky", "Platby"]) {
          await c.page.getByRole("tab", { name: label, exact: true }).click();
          expect(
            await c.page.evaluate(
              () => document.documentElement.scrollWidth <= innerWidth,
            ),
          ).toBe(true);
        }
        expect(c.errors).toEqual([]);
      } finally {
        await c.page.close();
      }
    });
  await check(
    "viewer can export reports but cannot follow operations links; non VAT payer notice",
    async () => {
      const c = await pageFor(1440, 900, "?role=viewer&vat=false");
      try {
        await c.page.getByRole("tab", { name: "DPH", exact: true }).click();
        await expect(
          c.page.getByText(/Firma je nastavena jako neplátce/),
        ).toBeVisible();
        await c.page.getByRole("tab", { name: "Platby", exact: true }).click();
        await expect(
          c.page.getByRole("tabpanel").getByRole("link"),
        ).toHaveCount(0);
        await c.page
          .locator("summary")
          .filter({ hasText: "Exportovat" })
          .click();
        await expect(
          c.page.getByRole("button", { name: "Exportovat do Excelu" }),
        ).toBeEnabled();
      } finally {
        await c.page.close();
      }
    },
  );
  await check(
    "print uses existing complete report and no screen layout",
    async () => {
      const c = await pageFor();
      try {
        await c.page.emulateMedia({ media: "print" });
        await expect(c.page.locator(".report-print-document")).toBeVisible();
        await expect(c.page.getByRole("tablist")).toBeHidden();
        await c.page.pdf({
          path: resolve(output, "report.pdf"),
          format: "A4",
          printBackground: true,
        });
      } finally {
        await c.page.close();
      }
    },
  );
} finally {
  await browser.close();
  await server.close();
  await writeFile(
    resolve(output, "validation.json"),
    JSON.stringify(
      {
        scope:
          "Real shared AppShell/ReportsClient/print; synthetic read-only fixtures; no remote writes",
        results,
      },
      null,
      2,
    ),
  );
}
