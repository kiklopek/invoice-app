// Real React UI + CSS with synthetic read-only HTTP fixtures. No Next auth bootstrap,
// Supabase, mail or billing connections. This is a presentation/browser contract check,
// not a substitute for authenticated Next.js staging E2E.
import { mkdir, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";
import {
  invoices,
  scenarioSummary,
  scenarioReport,
  scenarioInvoiceDetail,
  scenarioInvoiceCount,
} from "./dashboard-design-fixtures.mjs";
import { chromium, webkit } from "@playwright/test";

// Vite is already a pinned transitive dependency of Vitest in this project.
const require = createRequire(import.meta.url);
const vitestRequire = createRequire(require.resolve("vitest/config"));
const { createServer } = await import(
  pathToFileURL(vitestRequire.resolve("vite")).href
);

const project = process.cwd();

const revision = process.argv.find((arg) => arg.startsWith("--revision="))?.slice(11);
if (revision && !/^[a-z0-9-]+$/.test(revision)) throw new Error("Invalid revision");
const before = process.argv.includes("--before");
const quick = process.argv.includes("--quick");
const shellOnly = process.argv.includes("--shell-only");
const engine = process.argv.includes("--webkit") ? "webkit" : "chromium";
const fixture = resolve(project, `.cache/dashboard-design-fixture-${engine}`);
const browserPort = engine === "webkit" ? 4320 : 4319;
const output = resolve(
  project,
  `artifacts/dashboard-design/${revision || (before ? "before" : shellOnly ? "fluid-routes" : "fluid")}-${engine}`,
);
if (before && existsSync(resolve(output, "results.json"))) {
  throw new Error(
    "The original before baseline already exists; refusing to overwrite it with changed UI.",
  );
}
await mkdir(fixture, { recursive: true });
await mkdir(output, { recursive: true });

await writeFile(
  resolve(fixture, "index.html"),
  '<!doctype html><html lang="cs"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><div id="root"></div><script type="module" src="/entry.tsx"></script></html>',
);
await writeFile(
  resolve(fixture, "link.tsx"),
  `import { createElement } from 'react'; export default function Link({href, children, prefetch: _prefetch, replace: _replace, scroll: _scroll, ...props}) { return createElement('a', {...props, href}, children); }`,
);
await writeFile(
  resolve(fixture, "image.tsx"),
  `import { createElement } from 'react'; export default function Image({priority: _priority, preload: _preload, fill: _fill, unoptimized: _unoptimized, ...props}) { return createElement('img', props); }`,
);
await writeFile(
  resolve(fixture, "navigation.tsx"),
  `import {useSyncExternalStore} from 'react'; function subscribe(callback){window.addEventListener('popstate',callback);return()=>window.removeEventListener('popstate',callback)} export function usePathname(){return useSyncExternalStore(subscribe,()=>window.location.pathname,()=>'/dashboard')} export function useRouter(){return {push:(url)=>window.location.assign(url),replace:(url)=>window.location.replace(url),refresh:()=>{}}} export function useSearchParams(){return new URLSearchParams(window.location.search)}`,
);
await writeFile(
  resolve(fixture, "entry.tsx"),
  `
import {createElement} from 'react'; import {createRoot} from 'react-dom/client';
import '${project}/src/app/globals.css'; import '${project}/src/app/minimal.css';
import '${project}/src/app/styles/responsive.css'; import '${project}/src/app/styles/invoice-cards.css';
import {AppShell,AppFrame} from '${project}/src/components/layout/app-shell';
import {WorkspaceDataProvider} from '${project}/src/components/workspace-data-provider';
import {DashboardClient} from '${project}/src/app/(workspace)/dashboard/dashboard-client';
const scenario=new URLSearchParams(location.search).get('scenario')||'normal';
const profile={role:scenario==='viewer'?'viewer':'admin',name:'Anna Nováková',email:'anna@example.invalid',companyName:'Ukázková společnost s.r.o.'};
const scenarios=${JSON.stringify({ normal: scenarioSummary("normal"), empty: scenarioSummary("empty"), stress: scenarioSummary("stress") })};
const base=scenarios[scenario]||scenarios.normal;
createRoot(document.getElementById('root')).render(createElement(WorkspaceDataProvider,null,createElement(AppShell,{initialProfile:profile},location.pathname==='/dashboard'?createElement(DashboardClient,{initialData:base,initialNow:'2026-10-17T08:00:00.000Z'}):createElement(AppFrame,null,createElement('header',{className:'section-header'},createElement('h1',null,'Kontrola sdíleného rozložení')),createElement('section',{className:'card',style:{minHeight:'1100px'}},createElement('h2',null,'Obsah podstránky'),createElement('p',null,'Prezentace společné navigace a pozadí; obsah konkrétní podstránky není součástí této fixture.'),createElement('button',null,'Ovládací prvek'))))));
`,
);

const server = await createServer({
  configFile: false,
  root: fixture,
  publicDir: resolve(project, "public"),
  logLevel: "error",
  server: {
    host: "127.0.0.1",
    port: browserPort,
    strictPort: true,
    fs: { allow: [project] },
  },
  esbuild: { jsx: "automatic" },
  css: { postcss: { plugins: [] } },
  resolve: {
    alias: [
      { find: /^next\/link$/, replacement: resolve(fixture, "link.tsx") },
      { find: /^next\/image$/, replacement: resolve(fixture, "image.tsx") },
      {
        find: /^next\/navigation$/,
        replacement: resolve(fixture, "navigation.tsx"),
      },
      { find: "@", replacement: resolve(project, "src") },
    ],
    dedupe: ["react", "react-dom"],
  },
});
await server.listen();
const browser = await { chromium, webkit }[engine].launch({ headless: true });
const results = [];
try {
  for (const scenario of shellOnly
    ? []
    : before
      ? ["normal"]
      : quick
        ? ["normal"]
        : ["normal", "viewer", "empty", "stress", "chart-error"]) {
    const sizes = quick
      ? [
          [1536, 1024],
          [1440, 900],
          [1280, 800],
          [1366, 768],
          [1440, 820],
          [1280, 740],
          [1280, 700],
          [1280, 660],
          [1180, 820],
          [1180, 660],
          [1180, 740],
          [1194, 768],
          [390, 844],
        ]
      : !before && scenario === "normal"
        ? [
            [320, 740],
            [375, 812],
            [390, 844],
            [430, 932],
            [599, 900],
            [600, 900],
            [767, 1024],
            [768, 1024],
            [820, 1180],
            [844, 390],
            [899, 900],
            [900, 900],
            [1023, 900],
            [1024, 900],
            [1199, 900],
            [1200, 900],
            [1279, 900],
            [1280, 900],
            [1280, 800],
            [1366, 768],
            [1440, 820],
            [1280, 740],
            [1280, 700],
            [1280, 660],
            [1180, 820],
            [1180, 660],
            [1180, 740],
            [1194, 768],
            [1440, 900],
            [1536, 1024],
            [1440, 1000],
            [1600, 1000],
            [1920, 1080],
            [1920, 1200],
          ]
        : [
            [1440, 1000],
            [820, 1180],
            [390, 844],
          ];
    for (const [width, height] of sizes) {
      const page = await browser.newPage({
        viewport: { width, height },
        reducedMotion: "reduce",
      });
      const errors = [];
      const unexpectedRequests = [];
      page.on("pageerror", (error) => errors.push(error.message));
      page.on("console", (message) => {
        if (
          message.type() === "error" &&
          !message.text().includes("status of 503")
        )
          errors.push(message.text());
      });
      await page.route("**/*", async (route) => {
        const request = route.request();
        const url = new URL(request.url());
        if (url.hostname !== "127.0.0.1") {
          unexpectedRequests.push(request.url());
          return route.abort();
        }
        if (!url.pathname.startsWith("/api/")) return route.continue();
        // Explicit in-memory control fixture; no mutation reaches a real service.
        if (request.method() !== "GET") {
          unexpectedRequests.push(`${request.method()} ${url.pathname}`);
          return route.fulfill({
            status: 405,
            json: { error: "Fixture only allows reads" },
          });
        }
        const empty = scenario === "empty";
        if (url.pathname === "/api/notifications") return route.fulfill({ json: { items: [], unread_count: 0, total: 0, has_more: false, next_cursor: null, through: new Date().toISOString() } });
        if (url.pathname === "/api/settings/reminders")
          return route.fulfill({ json: { active: true } });
        if (url.pathname === "/api/search")
          return route.fulfill({ json: { results: empty ? [] : [
            { id: invoices[0].id, type: "invoice", title: `Faktura ${invoices[0].invoice_number}`, subtitle: `${invoices[0].counterparty_name} · 125 000 Kč`, href: `/invoices/${invoices[0].id}` },
            { id: "customer-fixture", type: "customer", title: "Ukázková firma s.r.o.", subtitle: "IČO 12345678", href: "/customers?highlight=customer-fixture" },
            { id: "payment-fixture", type: "payment", title: "Ukázková platba", subtitle: "17. 10. 2026 · 125 000 Kč", href: "/invoices/payments/archive?highlight=payment-fixture#payment-payment-fixture" },
          ], unavailable: [] } });
        if (url.pathname === "/api/dashboard")
          return route.fulfill({ json: scenarioSummary(scenario) });
        if (url.pathname === "/api/invoices")
          return route.fulfill({
            json: {
              invoices: empty ? [] : invoices,
              total: scenarioInvoiceCount(url, scenario),
              currencies: empty ? [] : ["CZK", "EUR"],
              active_count: empty ? 0 : 25,
            },
          });
        const detailMatch = url.pathname.match(
          /^\/api\/invoices\/([^/]+)\/page-data$/,
        );
        if (detailMatch)
          return route.fulfill({
            json: {
              ...scenarioInvoiceDetail(detailMatch[1], scenario),
              invoice: {
                ...scenarioInvoiceDetail(detailMatch[1], scenario).invoice,
                reminders_paused: false,
              },
            },
          });
        if (url.pathname === "/api/reports") {
          if (scenario === "chart-error")
            return route.fulfill({
              status: 503,
              json: { error: "Graf se nepodařilo načíst." },
            });
          return route.fulfill({ json: scenarioReport(url, empty) });
        }
        unexpectedRequests.push(url.pathname);
        return route.fulfill({
          status: 404,
          json: { error: "Unknown fixture endpoint" },
        });
      });
      await page.goto(
        `http://127.0.0.1:${browserPort}/dashboard?scenario=${scenario}`,
      );
      await page.locator("main").waitFor();
      await page.waitForTimeout(800);
      const overflow = await page.evaluate(() => ({
        document: document.documentElement.scrollWidth,
        viewport: innerWidth,
        body: document.body.scrollWidth,
      }));
      if (overflow.document > width + 1 || overflow.body > width + 1)
        errors.push(`Horizontal overflow: ${JSON.stringify(overflow)}`);
      if (!before) {
        if ((await page.getByRole("heading", { level: 1 }).count()) !== 1)
          errors.push("Expected one page h1");
        const importLink = page.locator('main a[href="/invoices/import"]');
        if (scenario === "viewer" && (await importLink.count()))
          errors.push("Viewer can see import action");
        if (scenario !== "viewer" && !(await importLink.count()))
          errors.push("Missing import action");
        if (scenario === "normal" && width === 1536) {
          await page.keyboard.press("Control+k");
          if (
            !(await page
              .getByRole("combobox", { name: "Hledat faktury, klienty a platby", exact: true })
              .evaluate((el) => document.activeElement === el))
          )
            errors.push("Search shortcut failed");
          await page.getByRole("combobox", { name: "Hledat faktury, klienty a platby", exact: true }).fill("125 000,50 Kč");
          const amountLink = page.getByRole("link", {
            name: "Vyhledat podle částky: 125 000,50 Kč",
          });
          if (
            (await amountLink.getAttribute("href")) !==
            "/invoices?amount_min=125000.5&amount_max=125000.5&currency=CZK"
          )
            errors.push(
              "Amount suggestion did not use existing amount filters",
            );
          await page.keyboard.press("Escape");
          if (await amountLink.isVisible())
            errors.push("Amount suggestion did not dismiss");
          await page.getByRole("combobox", { name: "Hledat faktury, klienty a platby", exact: true }).fill("");
          const overview = page.locator('aside[aria-labelledby="dashboard-reminders-heading"]');
          if (await overview.locator("select,ol").count()) errors.push("Company reminder overview still contains invoice-detail controls");
          if (await overview.locator("ul li").count() !== 4) errors.push("Company reminder overview omitted nearest schedules");
          const reminderScroll = await overview.locator("[data-reminder-scroll]").evaluate((element) => {
            const before = element.scrollTop;
            element.scrollTop = element.scrollHeight;
            const moved = element.scrollTop > before;
            const last = element.lastElementChild.getBoundingClientRect();
            const viewport = element.getBoundingClientRect();
            element.scrollTop = 0;
            return { moved, overflows: element.scrollHeight > element.clientHeight + 1, lastVisible: last.bottom <= viewport.bottom + 1 };
          });
          if ((reminderScroll.overflows && !reminderScroll.moved) || !reminderScroll.lastVisible) errors.push("Upcoming reminders cannot be browsed inside their scroll area");
          if (await overview.getByRole("link", { name: "Zobrazit všechny upomínky" }).count()) errors.push("Removed reminder footer link is still present");
        }
        if (scenario === "normal" && width === 1440) {
          await page.getByRole("combobox", { name: "Hledat faktury, klienty a platby", exact: true }).fill("Ukázková firma");
          await page.locator('[role="listbox"] [role="option"]').first().waitFor();
          await page.getByRole("combobox", { name: "Hledat faktury, klienty a platby", exact: true }).press("Enter");
          if (!page.url().includes(`/invoices/${invoices[0].id}`))
            errors.push("Search did not navigate to invoice search");
          // The fixture uses document navigation for Next's router. Let its
          // read requests finish before navigating back: WebKit otherwise
          // reports expected navigation cancellations as access-control errors.
          await page.waitForLoadState("networkidle");
          const sharedBackground = await page
            .locator(".sidebar")
            .evaluate((element) => getComputedStyle(element).backgroundColor);
          if (sharedBackground !== "rgba(249, 251, 248, 0.4)")
            errors.push(
              `Shared sidebar background differs across routes: ${sharedBackground}`,
            );
          await page.goto(
            `http://127.0.0.1:${browserPort}/dashboard?scenario=${scenario}`,
          );
          await page.locator("main").waitFor();
          await page.waitForTimeout(500);
        }
        if (scenario === "normal" && (width === 1536 || width === 390)) {
          if (width < 768) await page.getByRole("button", { name: "Otevřít vyhledávání" }).click();
          const searchInput = page.getByRole("combobox", { name: "Hledat faktury, klienty a platby", exact: true });
          await searchInput.fill("Ukázková");
          await page.locator('[role="listbox"] [role="option"]').first().waitFor();
          const types = await page.locator('[data-search-type]').evaluateAll(elements => elements.map(element => {
            const icon = element.lastElementChild;
            return { type: element.getAttribute('data-search-type'), right: icon.getBoundingClientRect().right <= element.getBoundingClientRect().right, color: getComputedStyle(icon).color };
          }));
          if (types.length !== 3 || types.some(type => !type.right || type.color !== "rgb(43, 119, 83)")) errors.push("Global search lost result types or green icons on the right");
          const bounds = await page.locator('[role="listbox"]').evaluate(element => { const rect = element.getBoundingClientRect(); return { left: rect.left, right: rect.right, bottom: rect.bottom }; });
          if (bounds.left < 0 || bounds.right > width + 1 || bounds.bottom > height + 1) errors.push("Global search results leave the viewport");
          await page.screenshot({ path: resolve(output, `search-dropdown-${width}x${height}.png`), fullPage: true });
          await searchInput.press("ArrowDown");
          await searchInput.press("ArrowDown");
          if (!(await page.locator('[role="option"][aria-selected="true"]').textContent()).includes("IČO")) errors.push("Global search keyboard selection failed");
          await searchInput.press("Escape");
          if (await page.locator('[role="listbox"]').count()) errors.push("Global search Escape failed");
          if (width >= 768) await searchInput.fill("");
        }
        if (width < 1024) await page.getByRole("button", {name:"Otevřít navigaci",exact:true}).click();
        await page.getByRole("button", { name: "Esko", exact: true }).filter({visible:true}).click();
        await page.getByRole("dialog", { name: "Esko" }).waitFor();
        await page.keyboard.press("Escape");
        if (await page.getByRole("dialog", { name: "Esko" }).count()) errors.push("Esko Escape failed");
        if (width < 1024) {
          await page
            .getByRole("button", { name: "Otevřít navigaci", exact: true })
            .click();
          await page
            .getByRole("dialog", { name: "Navigace aplikace" })
            .waitFor();
          await page.keyboard.press("Escape");
          if (
            await page
              .getByRole("dialog", { name: "Navigace aplikace" })
              .count()
          )
            errors.push("Navigation Escape failed");
        }
      }
      if (
        !before &&
        scenario === "empty" &&
        !(await page
          .getByRole("heading", { name: "V tomto období nejsou žádné faktury" })
          .count())
      )
        errors.push("Opening Esko changed the empty tenant fixture");
      await page.locator("h1").click(); // Remove keyboard test focus from the visual reference only.
      const shell = await page.locator(".sidebar").evaluate((element) => ({
        background: getComputedStyle(element).backgroundColor,
        brandTop: element.querySelector(".brand")?.getBoundingClientRect().top,
        navigationTop: element
          .querySelector(".desktop-navigation")
          ?.getBoundingClientRect().top,
      }));
      const layout = await page.evaluate(() => {
        const bottom = (id) =>
          document
            .getElementById(id)
            ?.closest("section,aside")
            ?.getBoundingClientRect().bottom;
        const innerScroll = [...document.querySelectorAll("main *")].filter(
          (el) =>
            !el.hasAttribute("data-reminder-scroll") &&
            /auto|scroll/.test(getComputedStyle(el).overflowY) &&
            el.scrollHeight > el.clientHeight + 1,
        ).length;
        const invoiceTable = document.getElementById("dashboard-invoices-heading")?.closest("section")?.querySelector("table");
        return {
          invoiceColumns: invoiceTable ? [...invoiceTable.querySelectorAll("thead th")].map((cell) => ({
            name: cell.textContent,
            width: cell.getBoundingClientRect().width,
            align: getComputedStyle(cell).textAlign,
          })) : [],
          invoiceAmountWeight: invoiceTable?.querySelector("tbody td:nth-child(3)")
            ? Number(getComputedStyle(invoiceTable.querySelector("tbody td:nth-child(3)")).fontWeight)
            : null,
          greetingHeight: document.querySelector("main h1").closest("header").getBoundingClientRect().height,
          rows: getComputedStyle(document.querySelector("main"))
            .gridTemplateRows,
          sections: [...document.querySelector("main").children].map((el) => ({
            tag: el.tagName,
            height: el.getBoundingClientRect().height,
          })),
          documentHeight: document.documentElement.scrollHeight,
          viewportHeight: innerHeight,
          scrolls: document.documentElement.scrollHeight > innerHeight + 1,
          invoiceBottom: bottom("dashboard-invoices-heading"),
          reminderBottom: bottom("dashboard-reminders-heading"),
          innerScroll,
        };
      });
      if (
        layout.invoiceBottom > layout.documentHeight + 1 ||
        layout.reminderBottom > layout.documentHeight + 1
      )
        errors.push("Document scroll range does not contain lower panels");
      const metricDetails = await page
        .locator('section[aria-label="Souhrn pohledávek"] > article')
        .evaluateAll((cards) =>
          cards.map((card) => {
            const detail = card.querySelector("strong")?.nextElementSibling;
            const rect = detail.getBoundingClientRect(),
              outer = card.getBoundingClientRect();
            return {
              text: detail.textContent,
              iconCenterOffset: (() => {
                const icon = card.querySelector(":scope > span").getBoundingClientRect();
                return Math.abs(icon.top + icon.height / 2 - (outer.top + outer.height / 2));
              })(),
              visible:
                getComputedStyle(detail).display !== "none" &&
                getComputedStyle(detail).visibility !== "hidden" &&
                rect.height > 0,
              bottom: rect.bottom,
              withinCard:
                rect.bottom <= outer.bottom + 1 &&
                rect.left >= outer.left &&
                rect.right <= outer.right + 1,
            };
          }),
        );
      if (
        metricDetails.length !== 4 ||
        metricDetails.some((detail) => !detail.visible || !detail.withinCard)
      )
        errors.push("KPI amount/comparison missing or outside its card");
      if (metricDetails.some((detail) => detail.iconCenterOffset > 2))
        errors.push("KPI icon is not vertically centred within its card");
      if (scenario === "normal" && width >= 1180 && height >= 660 &&
          height - Math.max(layout.invoiceBottom, layout.reminderBottom) > 26)
        errors.push("Dashboard leaves unused space below its panels");
      if (scenario === "normal" && width >= 1180 && height >= 660 &&
          (layout.greetingHeight > 140 || Math.abs(layout.invoiceBottom - layout.reminderBottom) > 1))
        errors.push("Greeting absorbed excess height or lower panels lost alignment");
      if (await page.getByText("Nejasná platba", { exact: true }).count())
        errors.push("Removed payment review row is still present in invoice status");
      if (scenario === "normal" && !metricDetails[0]?.text.includes("Za celé období"))
        errors.push(
          "Default all-time period was not reflected in the KPI detail",
        );
      if (
        scenario === "normal" &&
        width >= 1180 &&
        height >= 660 &&
        metricDetails.some((detail) => detail.bottom > height + 1)
      )
        errors.push("KPI details outside single-screen viewport");
      if (layout.invoiceColumns.some((column) => column.width > 0 && column.align !== "center"))
        errors.push("Invoice column heading lost its centred alignment");
      if (layout.invoiceAmountWeight !== null && layout.invoiceAmountWeight < 700)
        errors.push("Invoice amount lost its bold emphasis");
      if (layout.innerScroll)
        errors.push("Dashboard contains nested scrolling panels");
      if (
        scenario === "normal" &&
        width >= 1180 &&
        height >= 660 &&
        layout.scrolls
      )
        errors.push(`Single-screen target failed: ${JSON.stringify(layout)}`);
      if (await page.locator('[data-esko-launcher],[data-esko-restore]').count()) errors.push("Unexpected floating assistant");
      await page.screenshot({
        path: resolve(output, `${scenario}-${width}x${height}.png`),
        fullPage: true,
      });
      const fallbacks = {};
      if (
        !before &&
        scenario === "normal" &&
        width === 1536 &&
        height === 1024
      ) {
        const point = page
          .locator('[tabindex="0"][aria-label^="2025-"]')
          .first();
        await point.focus();
        const tooltip = point.locator('[aria-hidden="true"]');
        if (!(await tooltip.isVisible()))
          errors.push("Keyboard chart tooltip is not visible");
        await page.screenshot({
          path: resolve(output, "chart-keyboard-tooltip.png"),
        });
        await point.evaluate((el) => el.blur());
        const details = page.locator("details[data-chart-values]");
        await page.getByLabel("Nastavení grafu").click();
        await page
          .getByRole("button", { name: "Zobrazit hodnoty grafu" })
          .click();
        await page.waitForFunction(
          () => document.querySelector("details[data-chart-values]")?.open,
        );
        await page.evaluate(
          () =>
            new Promise((resolve) =>
              requestAnimationFrame(() => requestAnimationFrame(resolve)),
            ),
        );
        const expanded = await page.evaluate(() => {
          const chart = document
            .getElementById("dashboard-trend-heading")
            .closest("section");
          const invoices = document
            .getElementById("dashboard-invoices-heading")
            .closest("section");
          const table = chart
            .querySelector("details table")
            .getBoundingClientRect();
          return {
            open: chart.querySelector("details[data-chart-values]").open,
            tableHeight: table.height,
            tableWithinCard:
              table.bottom <= chart.getBoundingClientRect().bottom,
            scrolls: document.documentElement.scrollHeight > innerHeight + 1,
            overlap:
              invoices.getBoundingClientRect().top <
              chart.getBoundingClientRect().bottom,
          };
        });
        fallbacks.expandedChart = expanded;
        await page.screenshot({
          path: resolve(output, "expanded-chart-values.png"),
          fullPage: true,
        });
        if (
          !expanded.open ||
          !expanded.scrolls ||
          !expanded.tableWithinCard ||
          expanded.overlap
        )
          errors.push(
            "Expanded chart table must grow naturally without overlap",
          );
        await details.locator("summary").click();
        await page.evaluate(() => {
          document.documentElement.style.zoom = "2";
          window.scrollTo(0, 0);
        });
        fallbacks.cssZoom200 = await page.evaluate(() => ({
          scrolls: document.documentElement.scrollHeight > innerHeight + 1,
          horizontalOverflow:
            document.documentElement.scrollWidth > innerWidth + 1,
          hidden: getComputedStyle(document.body).overflowY === "hidden",
        }));
        if (
          !fallbacks.cssZoom200.scrolls ||
          fallbacks.cssZoom200.horizontalOverflow ||
          fallbacks.cssZoom200.hidden
        )
          errors.push("200% CSS zoom fallback clipped or failed to grow");
        await page.screenshot({
          path: resolve(output, "css-zoom-200.png"),
          fullPage: true,
        });
      }
      results.push({
        scenario,
        width,
        height,
        errors,
        unexpectedRequests,
        overflow,
        shell,
        layout,
        metricDetails,
        fallbacks,
      });
      await page.close();
    }
  }
  // Route chrome uses the real AppShell/AppFrame; representative content only.
  // This checks shared CSS and menus without claiming authenticated page E2E.
  for (const path of [
    "/invoices",
    "/invoices/new",
    "/invoices/import",
    "/invoices/payments",
    "/invoices/payments/archive",
    "/reminders",
    "/customers",
    "/reports",
    "/settings",
    "/settings/email-template",
    "/predplatne",
  ]) {
    for (const [width, height] of [
      [1536, 1024],
      [1024, 768],
      [1280, 600],
      [390, 844],
    ]) {
      const page = await browser.newPage({ viewport: { width, height } });
      const errors = [];
      page.on("pageerror", (e) => errors.push(e.message));
      await page.route("**/api/**", (route) =>
        route.fulfill({ status: 200, json: {} }),
      );
      await page.goto(`http://127.0.0.1:${browserPort}${path}`);
      await page.locator("main").waitFor();
      await page.evaluate(() => document.fonts.ready);
      if (width >= 768 && await page.getByRole("link", { name: "Nová faktura", exact: true }).count()) {
        const create = await page.getByRole("link", { name: "Nová faktura", exact: true }).boundingBox();
        const bell = await page.getByTitle("Oznámení", { exact: true }).boundingBox();
        if (!create || !bell || bell.x-create.x-create.width>14 || Math.abs(create.y+create.height/2-bell.y-bell.height/2)>1)
          errors.push("Notification bell separated from invoice actions");
      }
      const shell = await page.evaluate(() => {
        const bg = document.querySelector(".workspace-background");
        const main = document.querySelector("main");
        return {
          width: innerWidth,
          innerHeight,
          documentWidth: document.documentElement.scrollWidth,
          backgrounds: document.querySelectorAll(".workspace-background")
            .length,
          bgPosition: getComputedStyle(bg).position,
          bgPointerEvents: getComputedStyle(bg).pointerEvents,
          backgroundMarkup: bg.querySelector("svg").outerHTML,
          mainLeft: main.getBoundingClientRect().left,
          sidebarWidth: document
            .querySelector(".sidebar")
            .getBoundingClientRect().width,
          links: [
            ...document.querySelectorAll(
              ".desktop-navigation .nav-item-group>a",
            ),
          ].map((a) => a.getAttribute("href")),
        };
      });
      if (shell.documentWidth > width + 1)
        errors.push("Shared shell horizontal overflow");
      if (
        shell.backgrounds !== 1 ||
        shell.bgPosition !== "fixed" ||
        shell.bgPointerEvents !== "none"
      )
        errors.push("Incorrect shared decorative layer");
      if (width >= 1024 && shell.mainLeft < shell.sidebarWidth)
        errors.push("Content behind sidebar");
      if (width >= 1024) {
        const subrouteColors = await page
          .locator(".desktop-navigation .nav-subitems a")
          .evaluateAll((links) =>
            links.map((link) => getComputedStyle(link).color),
          );
        if (
          subrouteColors.some(
            (color) => !["rgb(86, 98, 93)", "rgb(32, 93, 64)"].includes(color),
          )
        )
          errors.push("Subroute text lost its readable light-theme color");

        const logout = page.getByRole("button", { name: "Odhlásit se", exact: true });
        await logout.scrollIntoViewIfNeeded();
        const bounds = await logout.boundingBox();
        if (!bounds || bounds.x < 0 || bounds.y < 0 || bounds.x + bounds.width > width || bounds.y + bounds.height > height)
          errors.push("Logout control outside viewport");
        const icon = await logout.locator("svg").boundingBox();
        if (!bounds || !icon || Math.abs(bounds.x + bounds.width / 2 - icon.x - icon.width / 2) > 1.1 || Math.abs(bounds.y + bounds.height / 2 - icon.y - icon.height / 2) > 1.1)
          errors.push("Logout icon is not centered");
      } else {
        await page.getByRole("button", { name: "Otevřít navigaci" }).click();
        if (
          !(await page
            .getByRole("navigation", { name: "Mobilní navigace" })
            .isVisible())
        )
          errors.push("Missing mobile navigation");
        await page.keyboard.press("Escape");
      }
      await page.screenshot({
        path: resolve(
          output,
          `shell-${path.replaceAll("/", "-").slice(1)}-${width}x${height}.png`,
        ),
      });
      await page.evaluate(() => scrollTo(0, 600));
      if (
        (await page
          .locator(".workspace-background")
          .evaluate((el) => Math.abs(el.getBoundingClientRect().top))) > 1
      )
        errors.push("Background moves while scrolling");
      results.push({
        scenario: "shared-shell",
        path,
        width,
        height,
        errors,
        unexpectedRequests: [],
        shell,
      });
      await page.close();
    }
  }
} finally {
  await browser.close();
  await server.close();
  await writeFile(
    resolve(output, "results.json"),
    JSON.stringify(
      {
        type: "real-component browser fixture; not authenticated Next E2E",
        results,
      },
      null,
      2,
    ),
  );
}
const failures = results.filter(
  (result) => result.errors.length || result.unexpectedRequests.length,
);
console.log(
  JSON.stringify({ output, checked: results.length, failures }, null, 2),
);
if (failures.length) process.exitCode = 1;
