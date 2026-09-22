import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const source = (path: string) =>
  readFileSync(join(process.cwd(), path), "utf8");
const css = source("src/app/minimal.css");
const mfaPage = source("src/app/(auth)/mfa/page.tsx");
const gpcImport = source(
  "src/app/(workspace)/invoices/payments/gpc-import-panel.tsx",
);
const paymentsUploadPage = source(
  "src/app/(workspace)/invoices/payments/payments-client.tsx",
);
const paymentsArchivePage = source(
  "src/app/(workspace)/invoices/payments/archive/payments-archive-client.tsx",
);
const icons = source("src/components/icons.tsx");
const appShell = source("src/components/layout/app-shell.tsx");
const mobileNavigation = source(
  "src/components/layout/mobile-navigation.css",
);

describe("MFA and bank statement UI regressions", () => {
  it("separates MFA actions into their own rows", () => {
    expect(mfaPage.match(/className="auth-text-button"/g)).toHaveLength(2);
    expect(css).toContain(".auth-text-button { display: block;");
  });

  it("explains GPC totals and exposes every wizard state", () => {
    expect(gpcImport).toContain("const activeImportStep =");
    expect(gpcImport).toContain(
      'aria-current={index === activeImportStep ? "step" : undefined}',
    );
    expect(gpcImport).toContain("Příchozí CZK platby připravené ke kontrole.");
    expect(gpcImport).toContain("Odchozí, cizoměnové nebo duplicitní řádky.");
    expect(gpcImport).toContain('["duplicate", "Duplicity"]');
    expect(css).toContain(".import-steps span.current");
    expect(gpcImport).toContain('className="account-warning-icon"');
    expect(gpcImport).toContain("Potvrdit kontrolu");
    expect(gpcImport).toContain('className="account-warning-check"');
    expect(css).toContain("grid-template-columns: 40px minmax(0, 1fr) auto;");
    expect(css).toContain(".account-warning > .account-warning-confirm");
    expect(css).toContain(".account-warning > .account-warning-icon {");
    expect(css).toContain("overflow: hidden;");
    expect(css).toContain(".payments-page .gpc-safety-card li::before");
    expect(css).toContain("grid-template-columns: 48px minmax(0, 1fr);");
    expect(css).toContain("grid-column: 1 / -1;");
  });

  it("lays out the proposed combination action without crowding its explanation", () => {
    expect(gpcImport).toContain('className="gpc-proposal-row"');
    expect(gpcImport).toContain("const hasReviewableProposal =");
    expect(css).toContain(".payments-page .gpc-proposal-row");
    expect(css).toContain(".payments-page .gpc-proposal-button");
  });

  it("keeps the booked-payment correction available without emphasizing it", () => {
    expect(gpcImport).toContain('className="btn secondary compact gpc-release-button"');
    expect(gpcImport).toContain('aria-label="Uvolnit platbu a přiřadit ji jinak"');
    expect(gpcImport).toContain("Změnit přiřazení");
    expect(css).toContain(".payments-page .gpc-entry-booked .gpc-release-button");
    expect(css).toContain("min-height: 40px");
  });

  it("aligns the open assignment editor to one consistent content width", () => {
    expect(gpcImport).toContain('className="gpc-allocation-field"');
    expect(css).toContain(".payments-page .invoice-choice-list label:only-child");
    expect(css).toContain(".payments-page .gpc-allocation-field");
    expect(css).toContain("width: min(calc(100% - 40px), 720px)");
  });

  it("lays out payment history without a wide table or visible transaction IDs", () => {
    expect(paymentsArchivePage).toContain('className="payment-history-table" role="list"');
    expect(paymentsArchivePage).toContain('className={`payment-history-item');
    expect(paymentsArchivePage).not.toContain("<small>{payment.external_id}</small>");
    expect(css).toContain(".payments-archive-page .payment-history-item { display: grid;");
    expect(css).toContain(".payments-archive-page .payment-history-table { display: grid;");
    expect(css).toContain(".payments-archive-page .payment-history-action .payment-assignment select { width: 100%; min-width: 0;");
    expect(css).toContain(".payments-archive-page .payment-history-action .matched-payment { grid-template-columns: minmax(0, 1fr) minmax(112px, auto);");
    expect(css).toContain(".payments-archive-page .payment-history-action .matched-payment .btn { grid-column: 2; grid-row: 1;");
  });

  it("orders settled payments first and keeps history above the archive", () => {
    expect(paymentsArchivePage).toContain("const matchStatusOrder");
    expect(paymentsArchivePage).toContain("matchStatusOrder[left.match_status]");
    expect(paymentsArchivePage.indexOf('id="historie-plateb"')).toBeLessThan(
      paymentsArchivePage.indexOf("<StatementArchive"),
    );
    expect(paymentsArchivePage).toContain('<span className="payments-section-number">01</span>');
    // Nahrávací podstránka obsahuje jen import výpisu a přepínač na archiv.
    expect(paymentsUploadPage).toContain('href="/invoices/payments/archive"');
    expect(paymentsUploadPage).not.toContain('id="historie-plateb"');
    expect(gpcImport).toContain('<span className="payments-section-number">03</span>');
    expect(css).toContain(".payments-page .payments-history { order: 1; }");
    expect(css).toContain(".payments-page .import-archive { order: 2; }");
    expect(css).toContain(".payments-archive-page .payment-history-table { display: grid;");
  });

  it("uses distinct, accessible navigation cards between both payment pages", () => {
    expect(paymentsUploadPage).toContain('className="payments-switch payments-switch-archive"');
    expect(paymentsUploadPage).toContain('<Icon name="statement" />');
    expect(paymentsArchivePage).toContain('className="payments-switch payments-switch-upload"');
    expect(paymentsArchivePage).toContain('<Icon name="bank" />');
    expect(paymentsUploadPage).toContain('<Icon name="arrow-right" />');
    expect(icons).toContain('name === "statement"');
    expect(css).toContain("grid-template-columns: 46px minmax(0, 1fr) 28px;");
  });

  it("keeps vertical scrolling on the page instead of trapping it in payment history", () => {
    expect(css).toContain(".payments-page > * { width: min(100%, 1280px); margin-inline: auto; }");
    expect(css).toContain("max-height: none; overflow: visible; overscroll-behavior: auto;");
    expect(css).toContain("overscroll-behavior-y: auto;");
    expect(appShell).toContain('classList.add("mobile-navigation-lock")');
    expect(appShell).toContain('classList.remove("mobile-navigation-lock")');
    expect(mobileNavigation).toContain("body.mobile-navigation-lock { overflow: hidden; }");
  });
});
