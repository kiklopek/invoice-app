import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const page = readFileSync(
  join(process.cwd(), "src", "app", "(workspace)", "invoices", "[id]", "invoice-detail-client.tsx"),
  "utf8",
);
const css = readFileSync(join(process.cwd(), "src", "app", "globals.css"), "utf8");
const layoutCss = readFileSync(join(process.cwd(), "src", "app", "minimal.css"), "utf8");

describe("invoice detail amount summary", () => {
  it("shows the net amount as the primary value and gross amount as secondary", () => {
    expect(page).toContain("Částka faktury bez DPH");
    expect(page).toContain("money(Number(invoice.amount_without_vat), invoice.currency)");
    expect(page).toContain('className="invoice-hero-gross"');
    expect(page).toContain("Částka s DPH:");
    expect(page).toContain("money(Number(invoice.amount), invoice.currency)");
    expect(css).toContain(".invoice-hero-gross");
    expect(css).toContain("color:#000");
  });

  it("keeps payment and deletion visible while grouping secondary actions", () => {
    expect(page).toContain('className="section-actions invoice-detail-actions"');
    expect(page).toContain('aria-label="Další akce s fakturou"');
    expect(page).toContain('className="invoice-actions-menu-popover"');
    expect(layoutCss).toContain(".invoice-actions-menu-popover");
    expect(layoutCss).toContain(".invoice-actions-menu > summary:focus-visible");
    expect(layoutCss).toContain("top: calc(100% + 8px);\n  right: 0;");
    expect(layoutCss).toContain(".invoice-actions-menu-popover { right: auto; left: 0; }");
  });
});

describe("otevření přiloženého dokumentu faktury", () => {
  const pageData = readFileSync(join(process.cwd(), "src", "lib", "invoice-detail-page-data.ts"), "utf8");

  it("odkazuje na stabilní routu, ne na podepsanou URL vloženou do stránky", () => {
    // Ta URL platila 300 s a razila se při renderu, takže komu detail faktury
    // chvíli ležel otevřený, ten klikal na mrtvý odkaz. Odkaz teď nevyprší.
    expect(page).toContain("href={`/api/invoices/${id}/document`}");
    expect(page).not.toContain("href={documentUrl}");
  });

  it("vykreslí tlačítko vždy, když je dokument přiložený", () => {
    // Dřív viselo na documentUrl: když podpis selhal, tlačítko se nevykreslilo
    // vůbec a vypadalo to, že faktura žádný dokument nemá.
    expect(page).toContain("Otevřít dokument");
    expect(page).not.toContain("documentUrl");
  });

  it("nerazí podepsanou URL při načítání detailu, kterou nikdo nepoužije", () => {
    expect(pageData).not.toContain("createSignedUrl");
    expect(pageData).not.toContain("document_url");
  });
});
