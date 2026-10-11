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
const paymentCard = source("src/app/(workspace)/invoices/payments/review/payment-card.tsx");
const accountQuestion = source("src/app/(workspace)/invoices/payments/review/account-question.tsx");
const reviewCss = source("src/app/(workspace)/invoices/payments/review/payment-review.module.css");
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

  it("names the current import stage and asks about a foreign account instead of a checkbox", () => {
    expect(gpcImport).toContain("const activeImportStep =");
    expect(gpcImport).toContain('const IMPORT_STEPS = ["Soubor", "Kontrola plateb", "Zaúčtování", "Hotovo"];');
    expect(gpcImport).toContain('className="import-steps"');
    expect(gpcImport).toContain("<AccountQuestion");
    expect(accountQuestion).toContain("Ano, přidat k účtům firmy");
    expect(accountQuestion).toContain("Ano, jen tentokrát");
    expect(accountQuestion).toContain("Ne, je to omyl");
    // Zaúčtovat jde až po odpovědi; zablokované tlačítko říká proč.
    expect(gpcImport).toContain("Nejdřív odpovězte na otázku k bankovnímu účtu nahoře.");
    expect(gpcImport).not.toContain("ve upozornění");
  });

  it("offers the proposal as a plain question with one-click answers", () => {
    expect(paymentCard).toContain("REVIEW_COPY.acceptOne");
    expect(paymentCard).toContain("REVIEW_COPY.chooseOther");
    expect(paymentCard).toContain("REVIEW_COPY.notInvoice");
    expect(paymentCard).toContain('className="payment-question"');
    expect(paymentCard).toContain("Zaplatil odběratel jen část?");
    // Technické údaje jsou schované, ne navrchu karty.
    expect(paymentCard).toContain("REVIEW_COPY.details");
    expect(paymentCard).not.toContain("Řádek {entry.line_number} ·");
  });

  it("keeps the booked-payment correction available under one verb", () => {
    expect(paymentCard).toContain('className="btn secondary payment-action gpc-release-button"');
    expect(paymentCard).toContain("aria-label={REVIEW_COPY.unbookLabel}");
    expect(paymentCard).toContain("{REVIEW_COPY.unbook}");
    expect(reviewCss).toContain("min-height: 44px");
  });

  it("lays the review out as one centred column with a sticky commit bar", () => {
    expect(reviewCss).toContain("container-type: inline-size;");
    expect(reviewCss).toContain("@container (min-width: 520px)");
    expect(reviewCss).toContain("@container (min-width: 820px)");
    expect(reviewCss).toContain("grid-template-columns: repeat(auto-fit, minmax(min(100%, 220px), 1fr));");
    expect(reviewCss).toMatch(/\.payment-commit-bar\) \{\s*position: sticky;\s*bottom: 0;/);
    expect(reviewCss).toContain("env(safe-area-inset-bottom, 0px)");
    // Na mobilu žádný vnořený posuvník; výběr faktury scrolluje až od 768 px.
    expect(reviewCss).toMatch(/@media \(min-width: 768px\) \{\s*\.review\.review :global\(\.invoice-picker-list\) \{ max-height/);
    // Žádné písmo pod 12 px v kontrole výpisu.
    expect(reviewCss).not.toMatch(/font-size: (?:[0-9]|1[01])px/);
    // Sticky by na body s overflow-x: hidden nefungovalo.
    expect(css).toContain("html:has(.gpc-panel.is-reviewing), body:has(.gpc-panel.is-reviewing)");
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
    // Číslo sekce z archivu záměrně zmizelo při sjednocení záhlaví (c692494).
    // Nahrávací podstránka obsahuje jen import výpisu a přepínač na archiv.
    expect(paymentsUploadPage).toContain('href="/invoices/payments/archive"');
    expect(paymentsUploadPage).not.toContain('id="historie-plateb"');
    // Archiv výpisů je jen na podstránce Platby a archiv, ne podruhé u nahrávání.
    expect(gpcImport).not.toContain('id="archiv-vypisu"');
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
