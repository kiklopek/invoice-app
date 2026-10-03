// Render the actual invoice list with stress data, without a database session.
// Only navigation, data fetching and the shell are stubbed; markup and CSS are real.
import { readFileSync, mkdirSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createRequire } from "node:module";
import { runInNewContext } from "node:vm";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import ts from "typescript";
import { chromium } from "@playwright/test";

const require = createRequire(import.meta.url);
const output = join(tmpdir(), "invoice-responsive-check");
mkdirSync(output, { recursive: true });
const invoices = ["overdue", "pending", "paid", "cancelled"].map((status, index) => ({
  id: `stress-${index}`, status,
  invoice_number: index === 0 ? "FV-2026-DLOUHECISLOFAKTURY-123456789" : `FV-2026-${index + 1}`,
  variable_symbol: "20261234567890123456",
  counterparty_name: index === 0 ? "Mezinárodní stavební a obchodní společnost s velmi dlouhým názvem s.r.o." : "Zákazník s.r.o.",
  counterparty_email: "fakturace.dlouhaadresa@velmidlouhadomena-zakaznika.example.cz",
  amount: index === 0 ? 999999999999.99 : 1234567.89,
  paid_amount: status === "paid" ? 1234567.89 : 123456.78,
  currency: index === 0 ? "CHF" : "CZK", issue_date: "2026-09-01", due_date: "2026-10-15", reminders_sent: 12,
}));
const initialData = { invoices, total: 100, total_pages: 4, active_count: 4, can_manage: true, currencies: ["CZK", "EUR", "CHF"] };
const stubs = {
  "next/link": { __esModule: true, default: ({ children, ...props }) => React.createElement("a", props, children) },
  "next/navigation": { useRouter: () => ({}) },
  swr: { __esModule: true, default: () => ({ data: initialData, isLoading: false }) },
  "@/components/layout/app-shell": { AppFrame: ({ children }) => React.createElement("div", { className: "app-shell" }, React.createElement("aside", { className: "sidebar" }), React.createElement("main", { className: "content section-page" }, children)) },
  "@/components/icons": { Icon: () => React.createElement("svg", { width: 18, height: 18, "aria-hidden": true }) },
  "@/components/modal": { Modal: () => null },
  "@/components/optional-payment-assignment": { OptionalPaymentAssignment: () => null },
  "@/lib/assignable-bank-payment": { assignBankPaymentToInvoice: () => {} },
  "@/lib/reminders": { todayInTimeZone: () => "2026-10-03" },
  "@/lib/workspace-cache": { useInvalidateWorkspaceData: () => () => {} },
  "@/components/toast": { useToast: () => ({ showToast: () => {} }) },
};
function loadComponent(path) {
  const code = ts.transpileModule(readFileSync(path, "utf8"), { compilerOptions: { jsx: ts.JsxEmit.ReactJSX, module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText;
  const componentModule = { exports: {} };
  runInNewContext(code, { module: componentModule, exports: componentModule.exports, URLSearchParams, require: name => {
    if (stubs[name]) return stubs[name];
    if (name === "react" || name === "react/jsx-runtime") return require(name);
    throw new Error(`Unexpected UI dependency: ${name}`);
  } }, { filename: path });
  return componentModule.exports;
}
stubs["@/components/mobile-disclosure"] = loadComponent("src/components/mobile-disclosure.tsx");
const { InvoicesClient } = loadComponent("src/app/(workspace)/invoices/invoices-client.tsx");
const markup = renderToStaticMarkup(React.createElement(InvoicesClient, { initialData, initialQuery: { query: "", page: 1 }, initialKey: "/api/invoices?paged=1&page=1" }));
const css = ["src/app/globals.css", "src/app/minimal.css", "src/app/styles/responsive.css"].map(path => readFileSync(path, "utf8")).join("\n");
const html = `<!doctype html><html lang="cs"><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Invoice layout stress check</title><style>${css}</style><body>${markup}<script>document.querySelector('.mobile-disclosure-toggle').addEventListener('click', function() { const parent = this.parentElement; parent.classList.toggle('is-open'); this.setAttribute('aria-expanded', parent.classList.contains('is-open')); });</script></body></html>`;
writeFileSync(join(output, "preview.html"), html);
const executablePath = process.env.CHROME_PATH || ["C:/Program Files/Google/Chrome/Application/chrome.exe", "/usr/bin/google-chrome", "/usr/bin/chromium"].find(existsSync);
const browser = await chromium.launch({ executablePath, headless: true });
const page = await browser.newPage();
const results = [];
try {
  const viewports = [320, 360, 390, 479, 480, 600, 767, 768, 820, 821, 900, 1023, 1024, 1180, 1280, 1440, 1600, 1920].map(width => ({ width, height: 900 }));
  viewports.push({ width: 844, height: 390 }, { width: 1280, height: 500 });
  for (const { width, height } of viewports) {
    await page.setViewportSize({ width, height });
    await page.setContent(html);
    const toggle = page.locator(".mobile-disclosure-toggle");
    if (await toggle.isVisible()) await toggle.click();
    const failures = await page.evaluate(() => {
      const problems = [];
      for (const element of document.querySelectorAll(".invoice-list-header > div, .invoice-list-header .btn, .invoice-row, .invoice-row td, .invoice-row strong, .invoice-row small, .invoice-row .status, .invoice-row .btn, .invoice-mobile-action-status, .filter-row label, .filter-row input, .filter-row select, .export-button")) {
        if (!element.getClientRects().length) continue;
        const rect = element.getBoundingClientRect();
        if (rect.width === 0 || rect.height === 0) continue;
        const cell = element.closest("td") || element.closest(".filter-row") || element.closest(".active-invoice-table");
        const parent = cell === element ? element.parentElement : cell;
        const bounds = parent?.getBoundingClientRect();
        if (rect.left < -1 || rect.right > innerWidth + 1 || element.scrollWidth > element.clientWidth + 2 || (bounds && (rect.left < bounds.left - 2 || rect.right > bounds.right + 2))) {
          problems.push({ selector: element.className || element.tagName, text: element.textContent.slice(0, 45), width: Math.round(rect.width), scroll: element.scrollWidth });
        }
      }
      for (const row of document.querySelectorAll(".invoice-row")) {
        const cells = Array.from(row.children).filter(cell => getComputedStyle(cell).display !== "none" && cell.getBoundingClientRect().height > 0);
        for (let i = 0; i < cells.length; i++) {
          for (const other of cells.slice(i + 1)) {
            const left = cells[i].getBoundingClientRect();
            const right = other.getBoundingClientRect();
            if (Math.min(left.right, right.right) - Math.max(left.left, right.left) > 2 && Math.min(left.bottom, right.bottom) - Math.max(left.top, right.top) > 2) problems.push({ overlap: [cells[i].className, other.className] });
          }
        }
        const amount = row.querySelector(".invoice-card-amount");
        if (getComputedStyle(amount).display === "flex" && getComputedStyle(amount).textAlign !== "center") problems.push({ alignment: "amount is not centered" });
      }
      return problems;
    });
    results.push({ width, height, failures });
    if ([360, 768, 1024, 1280, 1600].includes(width)) await page.screenshot({ path: join(output, `${width}-${height}.png`), fullPage: true });
  }
} finally {
  await browser.close();
}
writeFileSync(join(output, "results.json"), JSON.stringify(results, null, 2));
console.log(JSON.stringify({ output, checked: results.length, failures: results.filter(result => result.failures.length) }, null, 2));
if (results.some(result => result.failures.length)) process.exitCode = 1;
