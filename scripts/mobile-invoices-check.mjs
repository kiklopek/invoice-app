import { mkdir, writeFile, readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { resolve } from "node:path";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";
import { chromium, expect } from "@playwright/test";
import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import sharp from "sharp";
import {
  invoiceRows,
  invoicePage,
  invoiceTotals,
  initialQuery,
} from "./invoices-design-fixtures.mjs";

function detailFixture(scenario = "normal") {
  const row = structuredClone(
    invoiceRows[
      scenario === "paid"
        ? 7
        : scenario === "partial"
          ? 5
          : scenario === "pending"
            ? 4
            : 0
    ],
  );
  if (scenario === "cancelled") row.status = "cancelled";
  if (scenario === "stress") {
    row.counterparty_name = "DlouhýNázevSpolečnostiBezMezer".repeat(8);
    row.invoice_number = "FAKTURA-2026-".repeat(7);
    row.amount = 999999999999.99;
  }
  return {
    invoice: {
      ...row,
      file_url: scenario === "empty" ? null : "test/fixture.pdf",
    },
    payments: [],
    can_manage: scenario !== "viewer",
    suppression: null,
    events: [],
    reminders: [],
  };
}
const root = process.cwd();
const fixture = resolve(root, ".cache/mobile-invoices-fixture");
const output = resolve(root, "docs/redesign/visual-validation/mobile-invoices");
const before = process.argv.includes("--before");
if (before && existsSync(resolve(output, "current-before.png")))
  throw new Error("Baseline already exists");
await mkdir(fixture, { recursive: true });
await mkdir(output, { recursive: true });
const invoice = {
  invoice_number: "1443260157",
  variable_symbol: "1443260157",
  counterparty_name: "WOOD & PAPER a.s.",
  counterparty_ico: "26229854",
  counterparty_dic: "CZ26229854",
  counterparty_email: "fakturace@example.invalid",
  amount_without_vat: 219990.91,
  vat_rate: 21,
  amount: 266189,
  currency: "CZK",
  issue_date: "2026-09-15",
  due_date: "2026-09-23",
  reminder_policy_id: "default",
  notes: "",
  source: "ocr",
};
const sources = Object.fromEntries(
  Object.entries(invoice)
    .filter(([key]) => !["source", "notes", "reminder_policy_id"].includes(key))
    .map(([key, value], index) => [
      key,
      {
        page: [
          "due_date",
          "amount",
          "amount_without_vat",
          "vat_rate",
          "currency",
        ].includes(key)
          ? 2
          : 1,
        line: index + 1,
        text: String(value),
        method: "pdf_text",
        confidence: 0.97,
        bounds: null,
      },
    ]),
);
const decisions = Object.fromEntries(
  Object.keys(sources).map((key) => [
    key,
    { status: "verified", confidence: 0.97, reasons: [], candidates: [] },
  ]),
);
const pdf = await PDFDocument.create();
const font = await pdf.embedFont(StandardFonts.Helvetica);
for (let number = 1; number <= 3; number++) {
  const page = pdf.addPage([595, 842]);
  page.drawText(
    number === 1
      ? "FAKTURA - danovy doklad"
      : `Priloha faktury / strana ${number}`,
    { x: 36, y: 800, size: 20, font },
  );
  page.drawRectangle({
    x: 28,
    y: 28,
    width: 539,
    height: 740,
    borderWidth: 0.7,
    borderColor: rgb(0.2, 0.25, 0.22),
  });
  let y = 744;
  for (const [key, source] of Object.entries(sources).filter(
    ([, source]) => source.page === number,
  )) {
    page.drawText(key.replaceAll("_", " "), {
      x: 36,
      y,
      size: 11,
      font,
      color: rgb(0.4, 0.45, 0.45),
    });
    page.drawText(source.text, { x: 220, y, size: 15, font });
    source.bounds = {
      x: 220 / 595,
      y: (842 - y - 15 * 0.75) / 842,
      width: font.widthOfTextAtSize(source.text, 15) / 595,
      height: 15 / 842,
    };
    y -= 48;
  }
  page.drawText("Nazev polozky / sluzby", { x: 36, y: 354, size: 10, font });
  page.drawText("Mnozstvi     Cena bez DPH     DPH       Celkem", {
    x: 270,
    y: 354,
    size: 10,
    font,
  });
  for (let row = 0; row < 15; row++) {
    const lineY = 338 - row * 18;
    page.drawLine({
      start: { x: 28, y: lineY - 4 },
      end: { x: 567, y: lineY - 4 },
      thickness: 0.3,
      color: rgb(0.75, 0.79, 0.77),
    });
    page.drawText(`Polozka ${row + 1} - fakturovane sluzby`, {
      x: 36,
      y: lineY,
      size: 9,
      font,
    });
    page.drawText(`${row + 1} ks`, { x: 278, y: lineY, size: 9, font });
    page.drawText("1 200,00", { x: 345, y: lineY, size: 9, font });
    page.drawText("21 %", { x: 438, y: lineY, size: 9, font });
    page.drawText("1 452,00", { x: 495, y: lineY, size: 9, font });
  }
  page.drawText(
    "Testovaci doklad pro vizualni kontrolu - zadna skutecna faktura",
    { x: 36, y: 44, size: 9, font },
  );
}
const pdfBytes = Buffer.from(await pdf.save());
const imageBytes = await sharp(
  Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="595" height="842"><rect width="595" height="842" fill="white"/><text x="60" y="110" font-size="22">1443260157</text><text x="60" y="160" font-size="18">Original image invoice fixture</text></svg>`,
  ),
)
  .png()
  .toBuffer();
await writeFile(resolve(fixture, "invoice.pdf"), pdfBytes);
await writeFile(
  resolve(fixture, "index.html"),
  '<html lang="cs"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><div id="root"></div><script type="module" src="/entry.tsx"></script></html>',
);
await writeFile(
  resolve(fixture, "link.tsx"),
  `import{createElement}from'react';export default function Link({href,children,prefetch:_p,...props}){return createElement('a',{...props,href},children)}`,
);
await writeFile(
  resolve(fixture, "image.tsx"),
  `import{createElement}from'react';export default function Image({src,alt,unoptimized:_u,preload:_pr,priority:_pi,fill:_f,...props}){return createElement('img',{...props,src,alt})}`,
);
await writeFile(
  resolve(fixture, "navigation.tsx"),
  `export function usePathname(){return location.pathname}export function useRouter(){return{push:url=>window.__navigation=url,replace:()=>{},prefetch:()=>{},refresh:()=>{}}}export function useSearchParams(){return new URLSearchParams(location.search)}`,
);
await writeFile(
  resolve(fixture, "storage.ts"),
  `export function createClient(){return{storage:{from:()=>({uploadToSignedUrl:async()=>({error:null})})}}}`,
);
await writeFile(
  resolve(fixture, "entry.tsx"),
  `
import{createElement}from'react';import{createRoot}from'react-dom/client';
import '${root}/src/app/globals.css';import '${root}/src/app/minimal.css';import '${root}/src/app/styles/responsive.css';import '${root}/src/app/styles/invoice-cards.css';
import{AppShell}from'${root}/src/components/layout/app-shell';import{WorkspaceDataProvider}from'${root}/src/components/workspace-data-provider';import{ToastProvider}from'${root}/src/components/toast';import Page from '${root}/src/app/(workspace)/invoices/import/page';
import NewPage from '${root}/src/app/(workspace)/invoices/new/page';
import {InvoicesClient} from '${root}/src/app/(workspace)/invoices/invoices-client';
import {InvoiceDetailClient} from '${root}/src/app/(workspace)/invoices/[id]/invoice-detail-client';
const screenScenario=new URLSearchParams(location.search).get('scenario')||'normal';
const lists=${JSON.stringify(Object.fromEntries(["normal", "stress", "empty", "viewer"].map((key) => [key, invoicePage(undefined, key)])))};
const list=lists[screenScenario]||lists.normal,totals=${JSON.stringify(invoiceTotals())}, initialQuery=${JSON.stringify(initialQuery)};
const detailCases=${JSON.stringify(Object.fromEntries(["normal", "paid", "partial", "pending", "cancelled", "viewer", "empty", "stress"].map((s) => [s, detailFixture(s)])))};const detail=detailCases[screenScenario]||detailCases.normal;
const profile={role:screenScenario==='viewer'?'viewer':'admin',name:'Tomáš Adamec',email:'tomas@example.invalid',companyName:'Demo firma s.r.o.'};
createRoot(document.getElementById('root')).render(createElement(WorkspaceDataProvider,null,createElement(ToastProvider,null,createElement(AppShell,{initialProfile:profile},location.pathname==='/invoices'?createElement(InvoicesClient,{initialData:list,initialTotals:totals,initialQuery,initialKey:'/api/invoices?paged=1&page=1',initialNow:'2026-10-19T08:00:00Z'}):location.pathname==='/invoices/new'?createElement(NewPage):location.pathname==='/invoices/import'?createElement(Page):createElement(InvoiceDetailClient,{id:detail.invoice.id,initialData:detail})))));`,
);
const require = createRequire(import.meta.url);
const viteRequire = createRequire(require.resolve("vitest/config"));
const { createServer } = await import(
  pathToFileURL(viteRequire.resolve("vite")).href
);
const originalFiles = [
  "src/app/(workspace)/invoices/import/page.tsx",
  "src/components/invoice-form.tsx",
  "src/components/document-preview.tsx",
];
const originals = new Map(
  before
    ? originalFiles.map((path) => [
        resolve(root, path),
        execFileSync("git", ["show", `HEAD:${path}`], { encoding: "utf8" }),
      ])
    : [],
);
const server = await createServer({
  define: { "process.env.NEXT_PUBLIC_OCR_PROVIDER": JSON.stringify("local") },
  configFile: false,
  root: fixture,
  publicDir: resolve(root, "public"),
  logLevel: "error",
  plugins: [
    {
      name: "original-baseline",
      enforce: "pre",
      load: (id) => originals.get(id),
    },
  ],
  server: {
    host: "127.0.0.1",
    port: 4366,
    strictPort: true,
    fs: { allow: [root] },
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
      {
        find: "@/lib/supabase-browser",
        replacement: resolve(fixture, "storage.ts"),
      },
      { find: "@", replacement: resolve(root, "src") },
    ],
    dedupe: ["react", "react-dom"],
  },
});
await server.listen();
const browser = await chromium.launch({ headless: true });
if (process.argv.includes("--processing")) {
  try {
    const { runProcessingChecks } = await import("./ocr-processing-checks.mjs");
    await runProcessingChecks({
      browser,
      invoice,
      sources,
      decisions,
      pdfBytes,
      root,
    });
  } finally {
    await browser.close();
    await server.close();
  }
  process.exit(0);
}
const checks = [];
async function open(
  width = 1536,
  height = 1024,
  scenario = "normal",
  count = 1,
  screen = "review",
) {
  const page = await browser.newPage({
    viewport: { width, height },
    locale: "cs-CZ",
    timezoneId: "Europe/Prague",
  });
  const errors = [],
    saves = [],
    requests = [];
  if (scenario === "identifiers")
    await page.addInitScript(() => {
      delete HTMLElement.prototype.showPopover;
      delete HTMLElement.prototype.hidePopover;
    });
  page.on("pageerror", (error) => errors.push(error.message));
  let extractionCount = 0;
  await page.route("**/*", async (route) => {
    const request = route.request(),
      url = new URL(request.url());
    requests.push({ url: url.pathname, method: request.method() });
    if (url.hostname !== "127.0.0.1") return route.abort();
    if (!url.pathname.startsWith("/api/")) return route.continue();
    if (url.pathname === "/api/notifications")
      return route.fulfill({
        json: { items: [], unread_count: 0, through: "2026-10-24T00:00:00Z" },
      });
    if (url.pathname === "/api/invoices/totals")
      return route.fulfill({ json: invoiceTotals(url, scenario) });
    if (url.pathname === "/api/invoices" && request.method() === "GET")
      return route.fulfill({ json: invoicePage(url, scenario) });
    if (url.pathname.endsWith("/document") || url.pathname.endsWith("/pdf"))
      return route.fulfill({ contentType: "application/pdf", body: pdfBytes });
    if (url.pathname.endsWith("/page-data"))
      return route.fulfill({ json: detailFixture(scenario) });
    if (url.pathname === "/api/invoices/upload")
      return route.fulfill({
        json: { path: `test/${request.postDataJSON().name}`, token: "fixture" },
      });
    if (url.pathname === "/api/invoices/upload/verify")
      return route.fulfill({ json: { verified: true } });
    if (url.pathname === "/api/invoices/extract") {
      extractionCount++;
      if (scenario === "ocr-error")
        return route.fulfill({
          status: 503,
          json: { error: "Testovací výpadek OCR" },
        });
      const currentInvoice = {
        ...invoice,
        file_url: request.postDataJSON().path,
        ...(count > 1
          ? {
              invoice_number: `${invoice.invoice_number.slice(0, -1)}${extractionCount}`,
            }
          : {}),
      };
      const currentDecisions = structuredClone(decisions);
      const currentSources = structuredClone(sources);
      if (scenario === "image")
        currentSources.invoice_number = {
          ...currentSources.invoice_number,
          method: "ocr",
          bounds: { x: 0.1, y: 0.1, width: 0.3, height: 0.04 },
        };
      if (scenario === "review") {
        currentDecisions.due_date = {
          status: "review",
          confidence: 0.6,
          reasons: ["Datum splatnosti vyžaduje ověření."],
          candidates: [
            {
              value: "2026-09-23",
              page: 2,
              text: "2026-09-23",
              method: "pdf_text",
              confidence: 0.6,
              role: "document",
            },
            {
              value: "2026-09-24",
              page: 3,
              text: "2026-09-24",
              method: "ocr",
              confidence: 0.5,
              role: "document",
            },
          ],
        };
        currentDecisions.counterparty_email = {
          status: "missing",
          confidence: 0,
          reasons: ["Doplňte e-mail pro upomínky."],
          candidates: [],
        };
        currentInvoice.counterparty_email = "";
        delete currentSources.counterparty_email;
      }
      if (scenario === "identifiers") {
        currentInvoice.counterparty_ico = "";
        currentInvoice.counterparty_dic = "";
        for (const [field, reason] of [
          [
            "counterparty_ico",
            "IČO bez jednoznačné vazby na sekci odběratele nebylo přiřazeno. Zkontrolujte IČO ručně.",
          ],
          [
            "counterparty_dic",
            "DIČ uvedené u jiné osoby nebo firmy nebylo přiřazeno odběrateli. Zkontrolujte DIČ ručně.",
          ],
        ]) {
          currentDecisions[field] = {
            status: "missing",
            confidence: 0,
            reasons: [reason],
            candidates: [],
          };
          delete currentSources[field];
        }
      }
      if (scenario === "many-warnings") {
        for (const field of [
          "invoice_number",
          "due_date",
          "counterparty_ico",
          "counterparty_email",
          "amount",
        ]) {
          currentDecisions[field] = {
            status: "review",
            confidence: 0.55,
            reasons: ["Zkontrolujte tento údaj proti originálnímu dokladu."],
            candidates: [],
          };
        }
      }
      if (scenario === "prepayment")
        currentInvoice.money_evidence = {
          original_total: invoice.amount,
          total_source: "read",
          adjustment: 0,
          adjustment_reason: "",
          adjustment_confirmed: false,
          initial_paid: 1000,
          initial_paid_confirmed: false,
          multi_rate: false,
        };
      return route.fulfill({
        json: {
          extraction: {
            invoice: currentInvoice,
            confidence: 0.97,
            warnings:
              scenario === "review"
                ? [
                    "Datum splatnosti vyžaduje ověření.",
                    "E-mail nebyl rozpoznán.",
                  ]
                : [],
            document_kind: "issued_invoice",
            issuer_matches_organization: true,
            reminder_policy_assignment: {
              status: "remembered",
              counterparty_ico: invoice.counterparty_ico,
              policy_id: "default",
              policy_name: "Výchozí upomínky",
            },
            field_sources: currentSources,
            field_decisions: currentDecisions,
          },
        },
      });
    }
    if (url.pathname === "/api/settings/reminder-policies")
      return route.fulfill({
        json: {
          policies: [
            {
              id: "default",
              name: "Výchozí upomínky",
              is_default: true,
              archived_at: null,
            },
            {
              id: "other",
              name: "Individuální upomínky",
              is_default: false,
              archived_at: null,
            },
          ],
        },
      });
    if (url.pathname === "/api/customers/search")
      return route.fulfill({
        json: {
          customers: [
            {
              id: "customer",
              name: "Nový odběratel",
              ico: "12345678",
              dic: "CZ12345678",
              email: "novy@example.invalid",
            },
          ],
        },
      });
    if (url.pathname === "/api/invoices/reminder-policy-preference")
      return route.fulfill({ json: { assignment: null } });
    if (url.pathname === "/api/invoices" && request.method() === "POST") {
      saves.push(request.postDataJSON());
      if (scenario === "duplicate")
        return route.fulfill({
          status: 409,
          json: { error: "Faktura s tímto číslem již existuje." },
        });
      await new Promise((resolve) => setTimeout(resolve, 150));
      return route.fulfill({ json: { invoice: { id: "saved-invoice" } } });
    }
    return route.fulfill({ json: {} });
  });
  await page.goto(
    "http://127.0.0.1:4366" +
      {
        list: "/invoices",
        detail: "/invoices/" + invoiceRows[0].id,
        manual: "/invoices/new",
        import: "/invoices/import",
        review: "/invoices/import",
      }[screen] +
      "?scenario=" +
      scenario,
  );
  if (screen !== "review") {
    await page.locator("main").waitFor();
    await page.evaluate(() => document.fonts.ready);
    await page.waitForTimeout(200);
    return { page, errors, saves, requests };
  }
  await page
    .locator("input[type=file][multiple]")
    .setInputFiles(
      Array.from({ length: count }, (_, i) => ({
        name: `144326015${count > 1 ? i + 1 : 7}.${scenario === "image" ? "png" : "pdf"}`,
        mimeType: scenario === "image" ? "image/png" : "application/pdf",
        buffer: scenario === "image" ? imageBytes : pdfBytes,
      })),
    );
  await page
    .getByRole("button", {
      name:
        count === 1
          ? "Nahrát a načíst údaje"
          : `Nahrát a načíst ${count} dokumentů`,
      exact: true,
    })
    .click();
  await expect(page.locator("#manual-invoice-form form")).toBeVisible();
  if (scenario !== "ocr-error")
    await expect(
      page
        .locator(
          scenario === "image"
            ? ".document-preview-image img"
            : ".document-preview canvas",
        )
        .first(),
    ).toBeAttached();
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(200);
  return { page, errors, saves, requests };
}
async function check(name, fn) {
  await fn();
  checks.push(name);
  console.log("PASS", name);
}

const baseline = process.argv.includes("--baseline");
if(baseline && existsSync(resolve(output,"before-list-768.json")))throw new Error("Existing pre-redesign baseline must not be overwritten");
try {
  for (const width of process.argv.includes("--functional")
    ? []
    : baseline
      ? [768, 1024, 1440]
      : [
          320, 360, 375, 390, 414, 430, 480, 600, 767, 768, 1024, 1280, 1440,
          1920,
        ]) {
    for (const screen of ["list", "detail", "manual", "import", "review"]) {
      const requested = process.argv
        .find((arg) => arg.startsWith("--screen="))
        ?.slice(9);
      if (requested && screen !== requested) continue;
      const { page, errors } = await open(
        width,
        width < 768 ? 844 : 1024,
        "normal",
        1,
        screen,
      );
      try {

        if (screen === "detail")
          await expect(page.locator("canvas[data-ready=true]")).toBeAttached();
        const prefix = baseline ? "before" : "after";
        await page.screenshot({
          path: resolve(output, `${prefix}-${screen}-${width}.png`),
          fullPage: true,
          animations: "disabled",
        });
        const metrics = await page.locator("main").evaluate((n) => ({
          rect: [
            n.getBoundingClientRect().x,
            n.getBoundingClientRect().y,
            n.getBoundingClientRect().width,
            n.getBoundingClientRect().height,
          ],
          nodes: [...n.querySelectorAll("input,select,button,h1,h2,table")]
            .filter(
              (e) =>
                e.getClientRects().length &&
                getComputedStyle(e).visibility !== "hidden",
            )
            .map((e) => {
              const r = e.getBoundingClientRect();
              return [
                e.tagName,
                e.textContent?.slice(0, 40),
                r.x,
                r.y,
                r.width,
                r.height,
              ];
            }),
        }));
        await writeFile(
          resolve(output, `${prefix}-${screen}-${width}.json`),
          JSON.stringify(metrics),
        );
        if (!baseline) {
          expect(
            await page.evaluate(() => document.documentElement.scrollWidth),
          ).toBeLessThanOrEqual(width);
          expect(errors).toEqual([]);
        }
        if (!baseline && [768, 1024, 1440].includes(width) && !(screen === "import" && process.argv.includes("--ocr-upload-redesign"))) {
          const previous = JSON.parse(
            await readFile(
              resolve(output, `before-${screen}-${width}.json`),
              "utf8",
            ),
          );
          // Closed native <details> can return transient client rectangles in Chromium.
          // Their actions are verified by interaction tests, not visible-layout comparison.
          const closedButtons=await page.locator('main details:not([open]) button').evaluateAll(nodes=>nodes.map(node=>node.textContent?.slice(0,40)));
          const canonical=value=>({...value,nodes:value.nodes.filter(node=>node[0]!=="BUTTON"||!closedButtons.includes(node[1]))});
          expect(canonical(metrics)).toEqual(canonical(previous));
        }
        console.log("PASS " + prefix + " " + screen + " " + width);
      } finally {
        await page.close();
      }
    }
  }

  if (process.argv.includes("--date-filters")) {
    for (const width of [320, 390, 430, 600, 767]) {
      const { page } = await open(width, 844, "normal", 1, "list");
      try {
        await page.getByRole("button", { name: "Filtry faktur", exact: true }).click();
        const modal = page.getByRole("dialog", { name: "Filtry faktur" });
        for (const [label, value] of [["Vystaveno od", "2026-01-01"], ["Vystaveno do", "2026-12-31"], ["Splatnost od", "2026-01-01"], ["Splatnost do", "2026-12-31"]]) {
          // Native date inputs do not expose a textbox role in Chromium.
          const date = modal.getByLabel(label, { exact: true });
          await date.fill(value);
          await expect(date).toHaveValue(value);
          expect(await date.evaluate(n => n.getBoundingClientRect().width)).toBeGreaterThan(165);
        }
        expect(await modal.evaluate(n => n.scrollWidth <= n.clientWidth + 1)).toBe(true);
        await modal.getByLabel("Vystaveno od", { exact: true }).scrollIntoViewIfNeeded();
        await page.screenshot({ path: resolve(output, `date-filters-${width}.png`) });
        await modal.getByRole("button", { name: "Resetovat", exact: true }).click();
        await expect(modal.getByLabel("Vystaveno od", { exact: true })).toHaveValue("");
        await expect(modal.getByLabel("Splatnost do", { exact: true })).toHaveValue("");
        console.log(`PASS date filter layout and reset ${width}`);
      } finally { await page.close(); }
    }
  }
  if (
    !baseline &&
    !process.argv.includes("--date-filters") &&
    !process.argv.includes("--visual-only") &&
    !process.argv.some((arg) => arg.startsWith("--screen="))
  ) {
    await check(
      "mobile list: compact rows, partial payments, search, status and accessible filters",
      async () => {
        const { page, requests } = await open(390, 844, "normal", 1, "list");
        try {
          const rows = page.locator("tbody tr[data-invoice-id]");
          await expect(rows).toHaveCount(8);
          await expect(rows.locator("[role=progressbar]:visible")).toHaveCount(
            1,
          );
          const before = requests.length;
          await page
            .getByRole("button", { name: "Filtry faktur", exact: true })
            .click();
          const modal = page.getByRole("dialog", { name: "Filtry faktur" });
          await expect(modal).toBeVisible();
          expect(requests.length).toBe(before);
          await modal
            .getByRole("combobox", { name: "Stav", exact: true })
            .selectOption("overdue");
          await modal
            .getByRole("button", { name: "Zobrazit výsledky" })
            .click();
          await expect(rows).toHaveCount(3);
          await page
            .getByRole("searchbox", { name: "Hledat ve fakturách" })
            .fill("WOOD");
          await expect(rows).toHaveCount(1);
          await page
            .getByRole("button", { name: "Vymazat filtry", exact: true })
            .click();
          await expect(rows).toHaveCount(8);
          const checkbox = rows.first().getByRole("checkbox");
          await checkbox.check();
          await expect(page.getByText("Vybráno: 1")).toBeVisible();
          await page.getByRole("button", { name: "Zrušit výběr" }).click();
          await rows
            .first()
            .getByRole("button", { name: /Akce faktury/ })
            .click();
          const menu = page.getByRole("dialog", { name: /Akce faktury/ });
          await expect(
            menu.getByRole("link", { name: "Otevřít detail" }),
          ).toBeVisible();
          await page.keyboard.press("Escape");
          await expect(menu).not.toBeVisible();
        } finally {
          await page.close();
        }
      },
    );
    async function fillManual(page) {
      const section = (n) => page.locator(`[data-invoice-form-section="${n}"]`);
      await section(1)
        .getByLabel("Číslo faktury *", { exact: true })
        .fill("MOBILE-2026-001");
      await section(1)
        .getByLabel("Variabilní symbol", { exact: true })
        .fill("2026001");
      await section(1)
        .getByLabel("Datum vystavení *", { exact: true })
        .fill("2026-10-01");
      await section(1)
        .getByLabel("Datum splatnosti *", { exact: true })
        .fill("2026-11-01");
      await page
        .getByRole("button", { name: "Pokračovat", exact: false })
        .click();
      await expect(section(2)).toBeVisible();
      await section(2)
        .getByRole("textbox", { name: "Název odběratele *", exact: true })
        .fill("Mobilní odběratel s.r.o.");
      await section(2)
        .getByLabel("E-mail pro upomínky *", { exact: false })
        .fill("test@example.invalid");
      await page
        .getByRole("button", { name: "Pokračovat", exact: false })
        .click();
      await expect(section(3)).toBeVisible();
      await section(3)
        .getByLabel("Částka bez DPH *", { exact: true })
        .fill("1000");
      await expect(
        section(3).getByLabel("Celková hodnota faktury *", { exact: false }),
      ).toHaveValue("1210");
      await section(3)
        .getByLabel("Sazba DPH (%) *", { exact: false })
        .fill("12");
      await expect(
        section(3).getByLabel("Celková hodnota faktury *", { exact: false }),
      ).toHaveValue("1120");
      await section(3).getByLabel("Měna", { exact: false }).selectOption("EUR");
      await section(3)
        .getByLabel("Interní poznámka", { exact: false })
        .fill("Přetrvá při změně kroku");
    }
    await check(
      "manual: step validation, retained values, VAT/currency and one save",
      async () => {
        const { page, saves } = await open(320, 568, "normal", 1, "manual");
        try {
          await page
            .getByRole("button", { name: "Pokračovat", exact: false })
            .click();
          await expect(
            page.locator('[data-invoice-form-section="1"]'),
          ).toBeVisible();
          await fillManual(page);
          await page
            .getByRole("link", { name: "Zpět na faktury", exact: true })
            .click();
          const discard = page.getByRole("dialog", {
            name: "Opustit stránku bez uložení?",
          });
          await expect(discard).toBeVisible();
          await discard
            .getByRole("button", { name: "Zrušit", exact: true })
            .click();
          await page.getByRole("button", { name: "Zpět", exact: true }).click();
          await expect(
            page.getByRole("textbox", {
              name: "Název odběratele *",
              exact: true,
            }),
          ).toHaveValue("Mobilní odběratel s.r.o.");
          await page.getByRole("button", { name: "Zpět", exact: true }).click();
          await expect(
            page.getByLabel("Číslo faktury *", { exact: true }),
          ).toHaveValue("MOBILE-2026-001");
          await page
            .getByRole("button", { name: "Pokračovat", exact: false })
            .click();
          await page
            .getByRole("button", { name: "Pokračovat", exact: false })
            .click();
          await expect(
            page.getByLabel("Celková hodnota faktury *", { exact: false }),
          ).toHaveValue("1120");
          await expect(page.getByLabel("Měna", { exact: false })).toHaveValue(
            "EUR",
          );
          expect(saves.length).toBe(0);
          await page
            .getByRole("button", { name: "Uložit fakturu", exact: true })
            .dblclick();
          await expect.poll(() => saves.length).toBe(1);
          await expect
            .poll(() => page.evaluate(() => window.__navigation))
            .toBe("/invoices/saved-invoice");
          expect(saves[0]).toMatchObject({
            invoice_number: "MOBILE-2026-001",
            amount_without_vat: 1000,
            vat_rate: 12,
            amount: 1120,
            currency: "EUR",
            notes: "Přetrvá při změně kroku",
          });
        } finally {
          await page.close();
        }
      },
    );
    await check(
      "manual: failed save retains entered values and permits retry",
      async () => {
        const { page, saves } = await open(390, 844, "duplicate", 1, "manual");
        try {
          await fillManual(page);
          await page
            .getByRole("button", { name: "Uložit fakturu", exact: true })
            .click();
          await expect(page.getByRole("alert")).toContainText("již existuje");
          await expect(
            page.getByLabel("Celková hodnota faktury *", { exact: false }),
          ).toHaveValue("1120");
          expect(saves.length).toBe(1);
          await page
            .getByRole("button", { name: "Uložit fakturu", exact: true })
            .click();
          await expect.poll(() => saves.length).toBe(2);
        } finally {
          await page.close();
        }
      },
    );
    await check(
      "detail: overview, document, payments, reminders, state and confirmation",
      async () => {
        const { page, requests } = await open(390, 844, "normal", 1, "detail");
        try {
          await expect(
            page.getByRole("heading", { name: /Faktura č/ }),
          ).toBeVisible();
          await page.getByRole("tab", { name: "Doklad", exact: true }).click();
          await expect(
            page.getByRole("region", { name: "Dokument faktury" }),
          ).toBeVisible();
          await page.getByRole("tab", { name: "Platby", exact: true }).click();
          await expect(
            page.getByText(
              "K této faktuře zatím nejsou přiřazené žádné platby.",
            ),
          ).toBeVisible();
          await page
            .getByRole("tab", { name: "Upomínky", exact: true })
            .click();
          await expect(page.getByRole("switch")).toBeVisible();
          await page.getByRole("tab", { name: "Přehled", exact: true }).click();
          await expect(
            page.getByRole("region", { name: "Odběratel a kontakt" }),
          ).toBeVisible();
          await page
            .getByRole("button", { name: "Potvrdit úhradu", exact: true })
            .click();
          await expect(page.getByRole("dialog")).toBeVisible();
          expect(requests.some((r) => r.method === "PATCH")).toBe(false);
          await page
            .getByRole("button", { name: "Zrušit", exact: true })
            .click();
          await page
            .getByLabel("Další akce s fakturou", { exact: true })
            .click();
          await page
            .getByRole("button", { name: "Smazat fakturu", exact: true })
            .click();
          await expect(page.getByRole("dialog")).toContainText("smazat");
          expect(requests.some((r) => r.method === "DELETE")).toBe(false);
        } finally {
          await page.close();
        }
      },
    );
    await check(
      "OCR: actual warnings, corrections and data/document tabs retain values",
      async () => {
        const { page, saves } = await open(390, 844, "review", 1, "review");
        try {
          await expect(page.locator(".ocr-review-summary")).toContainText(
            "2 údaje",
          );
          await page.locator(".ocr-review-summary").click();
          await expect(
            page.locator('[data-ocr-field="due_date"] input'),
          ).toBeFocused();
          await page
            .locator('[data-ocr-field="counterparty_email"] input')
            .fill("oprava@example.invalid");
          await page.getByRole("tab", { name: "Doklad", exact: true }).click();
          await expect(
            page.locator(".document-preview canvas").first(),
          ).toBeVisible();
          await page.getByRole("tab", { name: "Údaje", exact: true }).click();
          await expect(
            page.locator('[data-ocr-field="counterparty_email"] input'),
          ).toHaveValue("oprava@example.invalid");
          expect(saves.length).toBe(0);
        } finally {
          await page.close();
        }
      },
    );
    await check(
      "OCR: per-document corrections survive switching through a batch",
      async () => {
        const { page } = await open(390, 844, "normal", 2, "review");
        try {
          await expect(page.locator("[data-ocr-batch]")).toContainText(
            "Faktura 1 z 2",
          );
          await page.locator("textarea").fill("První dokument");
          await page.getByLabel("Vybrat fakturu", { exact: true }).click();
          await page
            .getByRole("group", { name: "Výběr faktury" })
            .getByRole("button")
            .nth(1)
            .click();
          await page.locator("textarea").fill("Druhý dokument");
          await page.getByLabel("Vybrat fakturu", { exact: true }).click();
          await page
            .getByRole("group", { name: "Výběr faktury" })
            .getByRole("button")
            .nth(0)
            .click();
          await expect(page.locator("textarea")).toHaveValue("První dokument");
        } finally {
          await page.close();
        }
      },
    );
    for (const scenario of [
      "paid",
      "partial",
      "pending",
      "cancelled",
      "viewer",
      "empty",
      "stress",
    ])
      await check("mobile detail state " + scenario, async () => {
        const { page, errors } = await open(320, 568, scenario, 1, "detail");
        try {
          expect(
            await page.evaluate(() => document.documentElement.scrollWidth),
          ).toBeLessThanOrEqual(320);
          if (["paid", "cancelled", "viewer"].includes(scenario))
            await expect(
              page.getByRole("button", {
                name: "Potvrdit úhradu",
                exact: true,
              }),
            ).toHaveCount(0);
          if (scenario === "partial")
            await expect(
              page.getByText("Částečně uhrazeno", { exact: true }),
            ).toBeVisible();
          if (scenario === "empty") {
            await page
              .getByRole("tab", { name: "Doklad", exact: true })
              .click();
            await expect(
              page.getByText("K této faktuře není přiložen dokument."),
            ).toBeVisible();
          }
          if (scenario === "viewer") {
            await page
              .getByRole("tab", { name: "Upomínky", exact: true })
              .click();
            await expect(page.getByRole("switch")).toBeDisabled();
          }
          expect(errors).toEqual([]);
        } finally {
          await page.close();
        }
      });
    for (const scenario of ["empty", "stress", "viewer"])
      await check("mobile list state " + scenario, async () => {
        const { page, errors } = await open(320, 568, scenario, 1, "list");
        try {
          expect(
            await page.evaluate(() => document.documentElement.scrollWidth),
          ).toBeLessThanOrEqual(320);
          if (scenario === "empty")
            await expect(page.locator("tbody tr")).toHaveCount(0);
          if (scenario === "viewer") {
            await page
              .locator("tbody tr")
              .first()
              .getByRole("button", { name: /Akce faktury/ })
              .click();
            await expect(
              page.getByRole("button", {
                name: "Potvrdit úhradu",
                exact: true,
              }),
            ).toHaveCount(0);
          }
          expect(errors).toEqual([]);
        } finally {
          await page.close();
        }
      });
    await check(
      "import: selection, long filename and unsupported file error remain available",
      async () => {
        const { page, requests } = await open(320, 568, "normal", 1, "import");
        try {
          await page
            .locator("input[type=file][multiple]")
            .setInputFiles([
              {
                name: "VelmiDlouhyNazevSouboru".repeat(8) + ".gif",
                mimeType: "image/gif",
                buffer: Buffer.from("GIF89a"),
              },
            ]);
          await expect(page.getByText("1 vybraný dokument")).toBeVisible();
          expect(
            await page.evaluate(() => document.documentElement.scrollWidth),
          ).toBeLessThanOrEqual(320);
          await page
            .getByRole("button", { name: "Nahrát a načíst údaje", exact: true })
            .click();
          await expect(
            page.getByText("Podporujeme PDF, JPG, PNG a WEBP.", {
              exact: true,
            }),
          ).toBeVisible();
          expect(
            requests.filter((r) => r.url === "/api/invoices/upload").length,
          ).toBe(0);
        } finally {
          await page.close();
        }
      },
    );
    await writeFile(
      resolve(output, "functional.json"),
      JSON.stringify(checks, null, 2),
    );
  }
} finally {
  await browser.close();
  await server.close();
}
