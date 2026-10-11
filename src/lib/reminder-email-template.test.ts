import { describe, expect, it } from "vitest";
import { renderReminderEmail, type ReminderEmailCompany } from "./reminder-email-template";
import type { ReminderTemplateValues } from "./reminder-template";
import type { ReminderStage } from "@/types/invoice";

const company: ReminderEmailCompany = {
  name: "R. Hlavica s.r.o.",
  ico: "26296039",
  dic: "CZ26296039",
  registered_address: "Palackého třída 192/60, Brno",
  phone: "+420 573 500 700",
  email: "kostihova@hlavica.cz",
  bank_account_czk: "6844160247/0100",
  bank_account_eur: "94-2613370257/0100",
};
const values: ReminderTemplateValues = {
  invoice_number: "FV-2026-073",
  variable_symbol: "2026073",
  counterparty_name: "Ukázkový odběratel s.r.o.",
  amount: "247 300,00",
  currency: "CZK",
  due_date: "13. 8. 2026",
};

describe("branded reminder email", () => {
  it("renders a client-compatible branded invoice reminder with text fallback", () => {
    const result = renderReminderEmail({
      company,
      stage: "overdue",
      subject: "Upomínka FV-2026-073",
      message: "Dobrý den,\n\nprosíme o kontrolu úhrady.",
      values,
      logoUrl: "https://app.hlavica.cz/brand/drevohlavica.png",
      replyTo: "ucetni@hlavica.cz",
    });

    expect(result.html).toContain("width=\"640\"");
    expect(result.html).toContain("drevohlavica.png");
    expect(result.html).toContain("FV-2026-073");
    expect(result.html).toContain("247 300,00 CZK");
    expect(result.html).toContain("6844160247/0100");
    expect(result.html).toContain("<!--[if mso]>");
    expect(result.html).toContain("Kontaktovat nás");
    expect(result.text).toContain("ÚDAJE K PLATBĚ");
    expect(result.text).toContain("R. Hlavica s.r.o.");
  });

  it("escapes untrusted template and invoice values", () => {
    const result = renderReminderEmail({
      company,
      stage: "before_due",
      subject: "Bezpečný předmět",
      message: "<script>alert('x')</script>",
      values: { ...values, invoice_number: "<img src=x onerror=alert(1)>" },
    });
    expect(result.html).not.toContain("<script>");
    expect(result.html).not.toContain("<img src=x");
    expect(result.html).toContain("&lt;script&gt;");
  });

  it("uses the account matching the currency and omits CTA without an email", () => {
    const result = renderReminderEmail({
      company: { ...company, email: null },
      stage: "on_due",
      subject: "Splatnost",
      message: "Dobrý den.",
      values: { ...values, currency: "EUR" },
    });
    expect(result.html).toContain("94-2613370257/0100");
    expect(result.html).not.toContain("Kontaktovat nás");
  });

  it.each<ReminderStage>(["before_due", "on_due", "overdue", "escalation"])(
    "keeps the payment box responsive for the %s stage",
    stage => {
      const result = renderReminderEmail({
        company: { ...company, bank_account_czk: "CZ6508000000192000145399/0800" },
        stage,
        subject: "Test responzivní šablony",
        message: "Dobrý den.",
        values: {
          ...values,
          invoice_number: "TEST-2026-001-EXTRA-LONG-INVOICE-NUMBER",
          variable_symbol: "20260010000000000001",
        },
      });

      expect(result.html).toContain('class="email-shell" width="640"');
      expect(result.html).toContain("@media only screen and (max-width:480px)");
      expect(result.html).toContain(".detail-row{display:block!important;width:100%!important}");
      expect(result.html).toContain('class="detail-box-pad" style="padding:24px 26px;"');
      expect(result.html).toContain('class="detail-table"');
      expect(result.html).toContain("table-layout:auto!important");
      expect(result.html).toContain("overflow-wrap:anywhere;word-break:break-word;");
      expect(result.html).toContain("CZ6508000000192000145399/0800");
      expect(result.html).not.toMatch(/class="detail-box"[^>]*padding:/);
    },
  );

  it("refuses to render rather than fall back to a hardcoded brand when the company name is missing", () => {
    // This used to silently substitute "R. Hlavica s.r.o." -- fine while it
    // is the only tenant, but the day a second company's data hits this path
    // it would put OUR name on THEIR customer's debt-collection e-mail.
    // Failing loudly is the only safe default once that stops being true.
    expect(() => renderReminderEmail({
      stage: "before_due",
      subject: "Test",
      message: "Test",
      company: { ...company, name: "  " },
      values,
      logoUrl: null,
    })).toThrow(/název firmy/i);
  });

  it("shows this company's own name in the fallback logo, not a hardcoded brand", () => {
    const result = renderReminderEmail({
      stage: "before_due",
      subject: "Test",
      message: "Test",
      company: { ...company, name: "Jiná firma s.r.o." },
      values,
      logoUrl: null,
    });
    expect(result.html).toContain("Jiná firma s.r.o.");
    expect(result.html).not.toContain("R. Hlavica");
    expect(result.html).not.toContain("DŘEVO");
  });
});

describe("QR platba v upomínce", () => {
  const render = (extra: Partial<Parameters<typeof renderReminderEmail>[0]> = {}) => renderReminderEmail({
    company, stage: "overdue", subject: "Upomínka", message: "Dobrý den.", values, ...extra,
  });

  it("shows the QR code inline only when one was generated", () => {
    const withQr = render({ qrSrc: "cid:qr-platba" });
    expect(withQr.html).toContain('src="cid:qr-platba"');
    expect(withQr.html).toContain("Zaplaťte QR kódem");
    // Běžný fotoaparát QR platbu neotevře; e-mail musí říct, kde ji načíst.
    expect(withQr.html).toContain("aplikaci své banky");
    expect(withQr.html).toContain("Čtete e-mail v telefonu?");
    expect(withQr.text).toContain("aplikaci své banky");
    expect(withQr.text).toContain("QR");
    const without = render();
    expect(without.html).not.toContain("cid:");
    expect(without.html).not.toContain("Zaplaťte QR kódem");
  });

  it("signs off right under the QR code, with the contact button beside the signature", () => {
    const html = render({ qrSrc: "cid:qr-platba", replyTo: "ucetni@hlavica.cz" }).html;
    const qr = html.indexOf("Zaplaťte QR kódem");
    const signature = html.indexOf("S pozdravem");
    const button = html.indexOf("Kontaktovat nás");
    expect(qr).toBeGreaterThan(-1);
    expect(signature).toBeGreaterThan(qr);
    expect(button).toBeGreaterThan(signature);
    // Stejný řádek tabulky: řádek s podpisem se před tlačítkem neuzavře.
    expect(html.slice(signature, button)).not.toContain("</tr>");
    expect(html.slice(signature, button)).toContain('class="cta-cell"');
  });

  it("accepts an embedded PNG for the in-app preview, but nothing that leaves the email", () => {
    expect(render({ qrSrc: "data:image/png;base64,iVBORw0KGgo=" }).html).toContain('src="data:image/png;base64,iVBORw0KGgo="');
    for (const bad of ["https://evil.example/qr.png", "javascript:alert(1)", 'cid:x" onerror="alert(1)', "data:text/html;base64,PHNjcmlwdD4="]) {
      expect(render({ qrSrc: bad }).html, bad).not.toContain("Zaplaťte QR kódem");
    }
  });

  it("states the outstanding amount next to the paid part, so it matches the QR code", () => {
    // QR zní na zbývající částku. Kdyby text ukazoval celou fakturu,
    // dlužník by viděl dvě různá čísla a nevěděl, kterému věřit.
    const result = render({ payment: { total: "12 100,00", paid: "2 000,00", remaining: "10 100,00" } });
    expect(result.html).toContain("10 100,00 CZK");
    expect(result.html).toContain("Uhrazeno");
    expect(result.html).toContain("2 000,00 CZK");
    expect(result.html).toContain("12 100,00 CZK");
    expect(result.text).toContain("Zbývá uhradit: 10 100,00 CZK");
    expect(render().html).not.toContain("Uhrazeno");
  });
});

describe("reminderLogoUrl", () => {
  // Upomínka jde jménem konkrétní firmy: cizí firma nesmí dostat logo
  // R. Hlavica jen proto, že bylo dřív jediné.
  it("uses only the company's own logo, never a shared default", async () => {
    const { reminderLogoUrl } = await import("./reminder-email-template");
    expect(reminderLogoUrl("/brand/drevohlavica.png", "https://www.splatno.cz")).toBe("https://www.splatno.cz/brand/drevohlavica.png");
    expect(reminderLogoUrl(null, "https://www.splatno.cz")).toBeNull();
    expect(reminderLogoUrl(undefined, "https://www.splatno.cz")).toBeNull();
    expect(reminderLogoUrl("/brand/x.png", "")).toBeNull();
  });
});
