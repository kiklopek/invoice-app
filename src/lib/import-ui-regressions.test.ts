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
const matchingWorkspace = source("src/app/(workspace)/invoices/payments/payment-matching-workspace.tsx");
const matchingCss = source("src/app/(workspace)/invoices/payments/payment-matching.module.css");
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
    // Nový kód a odhlášení jsou dvě samostatná tlačítka, každé ve vlastním řádku.
    expect(mfaPage.match(/className=\{`?\$?\{?styles\.textButton/g)).toHaveLength(2);
    expect(mfaPage).toContain('<p className={styles.resend}');
  });

  it("shows processing stages and separate accepted, ignored and invalid totals", () => {
    expect(gpcImport).toContain('<ImportProcessingView kind="statement"');
    expect(matchingWorkspace).toContain("data.preview.total_entries");
    for (const label of ["Přijaté", "Ignorované", "Chyby", "Celkem"]) expect(matchingWorkspace).toContain(`<dt>${label}</dt>`);
    expect(matchingWorkspace).toContain("Bankovní účet vyžaduje kontrolu");
    expect(matchingWorkspace).toContain("Potvrdit kontrolu bankovního účtu");
    expect(matchingWorkspace).toContain("onAccountAck(event.target.checked)");
  });

  it("keeps a proposed combination in the row actions with an explicit choice", () => {
    expect(matchingWorkspace).toContain("Použít navrženou kombinaci");
    expect(matchingWorkspace).toContain("data.onSelected(key, entry.proposed_invoice_ids)");
    expect(matchingWorkspace).toContain("<MatchingPopover label={`Akce platby");
  });

  it("keeps booked-payment correction available in the row menu", () => {
    expect(matchingWorkspace).toContain("Uvolnit platbu a změnit přiřazení");
    expect(matchingWorkspace).toContain("data.onRelease(entry)");
    expect(matchingWorkspace).toContain("entry.bank_payment_id && data.canManage");
    expect(matchingWorkspace).toContain("className={styles.rowMenu}");
  });

  it("bounds the assignment editor to the viewport and keeps candidate scrolling inside", () => {
    expect(matchingWorkspace).toContain("<MatchingDropdown");
    expect(matchingCss).toMatch(/\.dropdownPanel \{[^}]*width: min\(440px, calc\(100vw - 24px\)\)/);
    expect(matchingCss).toContain(".dropdownPanel .invoiceOptions { max-height: 180px;");
    expect(source("src/app/(workspace)/invoices/payments/payment-matching-popover.tsx")).toContain("window.visualViewport");
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
    expect(paymentsArchivePage).toContain('id="historie-plateb" aria-label="Importované platby"');
    // Nahrávací podstránka obsahuje jen import výpisu a přepínač na archiv.
    expect(paymentsUploadPage).toContain('href="/invoices/payments/archive"');
    expect(paymentsUploadPage).not.toContain('id="historie-plateb"');
    expect(gpcImport).toContain('<span className="payments-section-number">03</span>');
    expect(css).toContain(".payments-page .payments-history { order: 1; }");
    expect(css).toContain(".payments-page .import-archive { order: 2; }");
    expect(css).toContain(".payments-archive-page .payment-history-table { display: grid;");
  });

  it("allows payment history to be sorted by amount or counterparty name", () => {
    expect(paymentsArchivePage).toContain('type PaymentSort = "default" | "amount_desc" | "amount_asc" | "name_asc" | "name_desc"');
    expect(paymentsArchivePage).toContain('<span>Seřadit podle</span>');
    expect(paymentsArchivePage).toContain('Částky: nejvyšší');
    expect(paymentsArchivePage).toContain('Názvu: A–Z');
    expect(paymentsArchivePage).toContain('leftName.localeCompare(rightName, "cs")');
    expect(css).toContain(".payments-archive-page .payments-history-sort");
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

  it("keeps statement archive actions together without creating an implicit grid row", () => {
    expect(paymentsArchivePage).toContain('<StatementArchive />');
    const statementArchive = source("src/app/(workspace)/invoices/payments/archive/statement-archive.tsx");
    expect(statementArchive).toContain('className="statement-file-actions"');
    expect(statementArchive).toContain('className="btn secondary compact statement-discard"');
    expect(css).toContain('.statement-file-actions { display: flex;');
    expect(css).toContain('minmax(250px,auto)');
  });
});
