import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const source = (path: string) => readFileSync(join(process.cwd(), path), "utf8");
const css = source("src/app/minimal.css");
const navigationCss = source("src/components/layout/mobile-navigation.css");
const responsiveCss = source("src/app/styles/responsive.css");
const disclosure = source("src/components/mobile-disclosure.tsx");
const remindersPage = source("src/app/(workspace)/reminders/reminders-client.tsx");
const dashboardPage = source("src/app/(workspace)/dashboard/dashboard-client.tsx");
const invoiceForm = source("src/components/invoice-form.tsx");
const customersPage = source("src/app/(workspace)/customers/customers-client.tsx");

const czechUiSources = [
  "src/components/layout/app-shell.tsx",
  "src/components/invoice-form.tsx",
  "src/components/document-preview.tsx",
  "src/app/(workspace)/invoices/import/page.tsx",
  "src/app/(workspace)/dashboard/page.tsx",
  "src/app/(workspace)/dashboard/dashboard-client.tsx",
  "src/app/(workspace)/invoices/page.tsx",
  "src/app/(workspace)/invoices/invoices-client.tsx",
  "src/app/(workspace)/invoices/[id]/page.tsx",
  "src/app/(workspace)/invoices/[id]/invoice-detail-client.tsx",
  "src/app/(workspace)/reminders/page.tsx",
  "src/app/(workspace)/reminders/reminders-client.tsx",
  "src/app/(workspace)/reports/page.tsx",
  "src/app/(workspace)/reports/reports-client.tsx",
  "src/app/(workspace)/settings/page.tsx",
  "src/app/(workspace)/settings/settings-client.tsx",
  "src/app/(auth)/login/page.tsx",
  "src/app/(auth)/mfa/page.tsx",
];

describe("mobile application layout", () => {
  it("keeps the desktop dashboard in one viewport with independent list scrolling", () => {
    expect(css).toContain("@media screen and (min-width: 1181px)");
    expect(css).toContain("height: 100dvh");
    expect(css).toContain(".dashboard-invoice-table,");
    expect(css).toContain("scrollbar-gutter: stable");
    expect(css).toContain(".dashboard-invoice-table thead { position: sticky");
    expect(css).toContain("grid-template-rows: minmax(0, 1fr)");
  });

  it("keeps the attention count in the compact header without a redundant list subtitle", () => {
    expect(dashboardPage).toContain('className="dashboard-attention-count"');
    expect(dashboardPage).toContain('className="dashboard-invoice-compact-list"');
    expect(dashboardPage).toContain("dashboard-invoice-compact-row");
    expect(dashboardPage).toContain('dashboard-invoice-compact-row${invoice.status === "paid" ? " is-paid" : ""}');
    expect(dashboardPage).toContain('invoice-row${invoice.status === "paid" ? " is-paid" : ""}');
    expect(dashboardPage).toContain('<Icon name="document" />');
    expect(dashboardPage).toContain('<Icon name="clock" />');
    expect(dashboardPage).toContain('<Icon name="mail" />');
    expect(dashboardPage).not.toContain("Nejbližší upomínky");
    expect(css).toContain(".dashboard-attention-count");
    expect(css).not.toContain(".dashboard-timeline-title");
    expect(responsiveCss).toContain(".dashboard-invoice-compact-meta");
    expect(responsiveCss).toContain(".dashboard-invoice-compact-statuses");
    expect(responsiveCss).toContain(".dashboard-invoice-table > table");
    expect(responsiveCss).toContain('"statuses statuses"');
    expect(responsiveCss).toContain("padding: 15px 16px 13px");
    expect(responsiveCss).toContain(".dashboard-invoice-table th:nth-child(5)");
    expect(responsiveCss).toContain("text-align: center");
  });

  it("keeps all navigation destinations and account actions reachable from the mobile menu", () => {
    const shell = source("src/components/layout/app-shell.tsx");
    // Navigace v case roste, takze pocet odkazu je nahodna vlastnost -- driv
    // se tu porovnaval s pevnym cislem a test spadl pokazde, kdyz pribyla
    // sekce. Invariant, na kterem skutecne zalezi, je opacny: zadny cil
    // z mobilniho menu nesmi zmizet. Pridani noveho cile test nerozbije,
    // odebrani stavajiciho ano.
    const destinations = (shell.match(/href: "(\/[^"]*)"/g) ?? []).map(entry => entry.slice(7, -1));
    for (const destination of [
      "/dashboard", "/invoices", "/invoices/new", "/invoices/import", "/invoices/archive",
      "/invoices/payments", "/invoices/payments/archive", "/customers", "/reports",
      "/settings", "/reminders",
    ]) {
      expect(destinations).toContain(destination);
    }
    expect(shell).toContain("mobile-navigation-toggle");
    expect(shell).toContain('aria-controls="mobile-navigation-panel"');
    expect(shell).toContain('role="dialog"');
    expect(shell).toContain('aria-modal="true"');
    expect(shell).toContain("main.inert = true");
    expect(shell).toContain("toggle?.focus({ preventScroll: true })");
    expect(shell).toContain('event.key !== "Tab"');
    expect(shell).toContain('aria-label="Mobilní navigace"');
    expect(shell).toContain("mobile-navigation-profile");
    expect(shell).toContain("Odhlásit se");
    expect(shell.match(/const selected = active && !item\.children\?\.some\(\(child\) => isChildActive\(child\.href\)\);/g)).toHaveLength(2);
    expect(shell).toContain("{active && item.children && item.children.length > 0 ? (");
    expect(navigationCss).toContain("grid-template-columns: minmax(0, 1fr)");
    expect(navigationCss).toContain("width: min(390px, 92vw)");
    expect(navigationCss).toContain("border-radius: 22px 0 0 0");
    expect(navigationCss).toContain("justify-items: start");
    expect(navigationCss).toContain("width: fit-content !important");
    expect(navigationCss).toMatch(/\.mobile-navigation-subitems \{[\s\S]*?gap: 7px;[\s\S]*?\}/);
    expect(navigationCss).toMatch(/\.mobile-navigation-subitems a \{[\s\S]*?min-height: 48px;[\s\S]*?align-items: center;[\s\S]*?justify-content: center;[\s\S]*?padding: 0 12px;[\s\S]*?text-align: center;[\s\S]*?\}/);
    expect(navigationCss).toMatch(/\.mobile-navigation-subitems a:hover,[\s\S]*?\.mobile-navigation-subitems a:focus-visible \{\s*background: #f3f7f4;\s*\}/);
    expect(navigationCss).toContain("env(safe-area-inset-top)");
    expect(navigationCss).toContain("env(safe-area-inset-bottom)");
    expect(navigationCss).toContain("--mobile-navigation-height: 72px");
    expect(navigationCss).toContain("width: 48px");
    expect(navigationCss).toContain("font-size: 18px");
    expect(navigationCss).toContain("padding-left: 8px");
    expect(navigationCss).toContain("calc(var(--mobile-navigation-height) + env(safe-area-inset-top))");
    expect(navigationCss).toContain(".mobile-navigation-backdrop");
    expect(navigationCss).toContain(".mobile-navigation-links a.active");
    expect(responsiveCss).toContain("grid-template-columns: 34px minmax(0, 1fr) 40px");
    expect(responsiveCss).toContain(".user-card > button span");
    expect(responsiveCss).toContain("display: none !important");
  });

  it("uses the agreed mobile breakpoints and touch-safe controls", () => {
    expect(navigationCss).toContain("@media screen and (max-width: 1023px)");
    expect(navigationCss).toContain("@media screen and (max-width: 479px)");
    expect(navigationCss).not.toMatch(/@media\s*\(max-width/);
    expect(responsiveCss).toContain("@media screen and (max-width: 1023px)");
    expect(responsiveCss).toContain("@media screen and (min-width: 1024px) and (max-width: 1279px)");
    expect(responsiveCss).toContain("container-name: invoice-table");
    expect(responsiveCss).toContain("container-name: dashboard-invoices");
    expect(responsiveCss).toContain("@container invoice-table (max-width: 1180px)");
    expect(responsiveCss).toContain("@container invoice-table (max-width: 820px)");
    expect(responsiveCss).toContain("@container dashboard-invoices (max-width: 800px)");
    expect(responsiveCss).toContain("@container dashboard-invoices (max-width: 680px)");
    expect(responsiveCss).toContain("@media screen and (max-width: 767px)");
    expect(responsiveCss).toContain("@media screen and (max-width: 479px)");
    expect(responsiveCss).toContain("@media screen and (pointer: coarse)");
    expect(responsiveCss).toContain("min-height: 44px");
    expect(responsiveCss).toContain("font-size: 16px");
    expect(responsiveCss).toContain("overflow-x: clip");
    expect(responsiveCss).toContain('"customer amount"');
    expect(responsiveCss).toContain('"meta statuses"');
    expect(responsiveCss).toContain('"invoice customer reminder amount action status"');
    expect(responsiveCss).toContain('"issue due reminder amount action status"');
    expect(responsiveCss).not.toContain("@media print");
    expect(css).toContain("min-height: 100dvh");
    expect(css).toContain("overscroll-behavior-x: none");
    expect(css).toContain("overscroll-behavior-y: auto");
    expect(css).toContain("calc(82px + env(safe-area-inset-bottom))");
    expect(css).not.toContain("calc(94px + env(safe-area-inset-bottom))");
    const layout = source("src/app/layout.tsx");
    expect(layout).toContain('import "./styles/responsive.css"');
    expect(layout).toContain('width: "device-width"');
    expect(layout).toContain('viewportFit: "cover"');
  });

  it("keeps the company logo and excludes the Splatno mark from the login card", () => {
    const login = source("src/app/(auth)/login/page.tsx");
    expect(login).toContain('<CompanyLogo className="login-company-logo" />');
    expect(login).not.toContain("SplatnoMark");
  });

  it("provides an accessible reusable mobile disclosure", () => {
    expect(disclosure).toContain('aria-expanded={open}');
    expect(disclosure).toContain('aria-controls={contentId}');
    expect(disclosure).toContain('type="button"');
    expect(css).toContain(".mobile-disclosure.is-open .mobile-disclosure-content");
    expect(css).toContain(".access-history-disclosure { margin-top: 16px; }");
  });

  it("keeps the reminders overview calm with accessible progressive disclosure", () => {
    expect(remindersPage).toContain('className="reminder-operations reminder-quick-stats"');
    expect(remindersPage).toContain('className="section-header reminders-hero"');
    expect(remindersPage).toContain("reminders-automation-card");
    expect(remindersPage).toContain("reminder-stat-card is-scheduled");
    expect(remindersPage).toContain("reminders-process-card");
    expect(remindersPage.match(/<details className=/g)).toHaveLength(2);
    expect(remindersPage).toContain("Provozní přehled a historie");
    expect(remindersPage).toContain("Texty e-mailů pro všechny kategorie");
    expect(remindersPage).not.toMatch(/<details[^>]*\sopen(?:=|\s|>)/);
    expect(css).toContain(".reminder-section-disclosure > summary:focus-visible");
    expect(css).toContain(".reminder-operations.reminder-quick-stats");
    expect(css).toContain(".reminders-hero::after");
    expect(css).not.toContain(".reminders-hero::before");
    expect(css).not.toContain(".reminders-process-card::after");
    expect(css).toContain("grid-template-columns: 1fr");
  });

  it("gives role and reminder selects a full-width mobile layout", () => {
    expect(css).toContain(".members-list article > select,");
    expect(css).toContain(".member-add select");
    expect(css).toContain(".human-rules .rule-main");
    expect(css).toContain(".rule-controls select");
    expect(css).toContain("min-height: 48px");
    expect(css).toContain("height: 48px !important");
    expect(css).toContain("-webkit-appearance: none");
    expect(css).toContain("padding: 0 var(--select-chevron-padding) 0 12px !important");
    expect(css).toContain("--select-chevron-size: clamp(11px, .9em, 14px)");
    expect(css).toContain("--select-chevron-offset: clamp(10px, 3%, 18px)");
  });

  it("opens suitable mobile keyboards for invoice and customer fields", () => {
    expect(invoiceForm).toContain('inputMode="numeric" pattern="[0-9]*" maxLength={10}');
    expect(invoiceForm).toContain('inputMode="numeric" pattern="[0-9]*" maxLength={8}');
    expect(invoiceForm).toContain('autoCapitalize="characters"');
    expect(invoiceForm).toContain('type="email" required');
    expect(invoiceForm).toContain('autoComplete="off" enterKeyHint="next"');
    expect(invoiceForm).toContain('inputMode="decimal" enterKeyHint="next"');
    expect(customersPage).toContain('type="search"');
    expect(customersPage).toContain('enterKeyHint="search"');
    expect(customersPage).toContain('type="tel"');
    expect(customersPage).toContain('inputMode="tel"');
  });

  it("turns operational wide tables into labeled mobile cards", () => {
    expect(source("src/app/(workspace)/invoices/import/page.tsx")).toContain("data-label=");
    expect(source("src/app/(workspace)/invoices/payments/archive/payments-archive-client.tsx")).toContain('role="listitem"');
    const invoiceArchive = source("src/app/(workspace)/invoices/archive/page.tsx");
    expect(invoiceArchive).toContain("archive-invoice-table");
    expect(invoiceArchive).toContain("archive-invoice-paid-at");
    expect(invoiceArchive).toContain('invoice.status === "paid" ? " is-paid" : ""');
    // .payment-preview-table a .debtor-table už žádná stránka nevykresluje;
    // jejich CSS se 6. 10. odstranilo jako mrtvé.
    expect(css).toContain(".invoice-import-preview table");
    expect(css).toContain(".payments-page .gpc-safety-card { display: none; }");
    expect(responsiveCss).toMatch(/\.archive-invoice-table \.invoice-row\.is-paid \{[\s\S]*?"customer invoice"[\s\S]*?"amount payment"[\s\S]*?"issue due"/);
    expect(responsiveCss).toMatch(/"customer invoice"\s+"amount payment"\s+"issue due"/);
    expect(responsiveCss).toContain(".archive-invoice-table .archive-invoice-paid-at");
    expect(responsiveCss).toContain(".archive-invoice-table .invoice-row.is-paid");
    expect(responsiveCss).toContain("grid-area: payment !important");
    expect(responsiveCss).toContain("grid-auto-rows: max-content");
    expect(responsiveCss).toContain("grid-template-rows: 54px 68px 44px");
    expect(responsiveCss).toContain("height: auto !important");
    expect(responsiveCss).toContain("min-height: 68px !important");
    expect(responsiveCss).toMatch(/\.archive-invoice-table \.archive-invoice-number,[\s\S]*?\.archive-invoice-table \.archive-invoice-customer \{[\s\S]*?text-align: center;/);
    expect(responsiveCss).toMatch(/\.archive-invoice-table \.archive-invoice-issued,[\s\S]*?\.archive-invoice-table \.archive-invoice-due \{[\s\S]*?text-align: center;/);
  });

  it("uses a compact, purpose-built mobile card for active invoices", () => {
    const invoiceList = source("src/app/(workspace)/invoices/invoices-client.tsx");
    expect(invoiceList).toContain("active-invoice-table");
    expect(invoiceList).toContain('invoice.status === "paid" ? " is-paid" : ""');
    expect(invoiceList).toContain("invoice-card-customer");
    expect(invoiceList).toContain("invoice-card-amount");
    expect(invoiceList).toContain("invoice-card-due");
    expect(invoiceList).toContain('className="invoice-card-reminders"');
    expect(invoiceList).toContain('<Icon name="mail" />');
    expect(invoiceList).toContain("invoice-mobile-action-status");
    expect(responsiveCss).toContain(".active-invoice-table .invoice-row");
    expect(responsiveCss).toContain('"customer invoice"');
    expect(responsiveCss).toContain('"amount due"');
    expect(responsiveCss).toContain('"footer footer"');
    expect(responsiveCss).toContain("font-size: clamp(20px, 2vw, 28px)");
    expect(responsiveCss).toContain(".invoice-list-table .invoice-card-reminders svg");
    expect(responsiveCss).toContain("minmax(160px, 1.45fr) 72px minmax(130px, 1fr)");
    expect(responsiveCss).toContain("transform: translateX(-28px)");
    expect(responsiveCss).toMatch(/@container invoice-table \(max-width: 820px\)[\s\S]*?\.invoice-list-table \.invoice-card-reminders \{\s*transform: none;\s*\}/);
    expect(responsiveCss).toContain("width: auto !important");
    expect(responsiveCss).toContain(".active-invoice-table .invoice-card-action:empty");
    expect(responsiveCss).toContain(".active-invoice-table .invoice-row.is-paid");
    expect(responsiveCss).toContain('"issued reminder";');
    expect(responsiveCss).toContain("background: #eaf6ed !important");
    expect(responsiveCss).toContain(".invoice-row.is-paid .invoice-card-action");
    expect(responsiveCss).toContain(".dashboard-invoice-table .invoice-row.is-paid");
    expect(responsiveCss).toContain(".dashboard-invoice-compact-row.is-paid .status.paid");
    expect(responsiveCss).toContain("align-items: center");
    expect(responsiveCss).toContain("justify-content: center");
    expect(responsiveCss).toContain("border-left: 1px solid #e7ece8 !important");
    expect(responsiveCss).toContain("min-height: 46px");
    expect(responsiveCss).toContain("background: #fff !important");
    expect(responsiveCss).toContain("text-align: right");
    expect(responsiveCss).toMatch(/\.active-invoice-table \.invoice-card-action \{ grid-template-columns: minmax\(0, 1fr\); gap: 10px; \}/);
    expect(responsiveCss).toContain("grid-column: 2");
    expect(responsiveCss).toContain("justify-content: flex-end");
    expect(responsiveCss).toContain("justify-self: end");
    expect(responsiveCss).toContain("margin-left: auto");
    expect(responsiveCss).toContain(".active-invoice-table .invoice-card-status");
    expect(responsiveCss).toContain("display: none !important");
  });

  it("lays out customer accounting details as a compact two-column mobile summary", () => {
    expect(customersPage).toContain("customer-contact-details");
    expect(customersPage).toContain("customer-outstanding-cell");
    expect(customersPage).toContain("customer-reminders-cell");
    expect(customersPage).toContain("customer-last-invoice-cell");
    expect(responsiveCss).toContain('"identity identity"');
    expect(responsiveCss).toContain('"contact contact"');
    expect(responsiveCss).toContain('"billing outstanding"');
    expect(responsiveCss).toContain('"reminders last"');
    expect(responsiveCss).toContain("repeat(2, minmax(0, 1fr)) !important");
  });

  it("keeps Czech UI sources free of common mojibake sequences", () => {
    for (const path of czechUiSources) {
      expect(source(path), path).not.toMatch(/PĹ|Ă|Â·|â€“|â€¦|Ĺ™/);
    }
  });
});
