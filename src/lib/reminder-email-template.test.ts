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
    expect(result.html).toContain("Kontaktovat účetní oddělení");
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
    expect(result.html).not.toContain("Kontaktovat účetní oddělení");
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
});
