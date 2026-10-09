import { describe, expect, it } from "vitest";
import { emptyDashboardData, type DashboardData } from "./dashboard-summary";
import { eskoAnswer, eskoCustomerDebtAnswer, eskoIntent, eskoInvoiceSearchAnswer, ESKO_QUESTIONS } from "./esko";

const data = (patch: Partial<DashboardData>): DashboardData => ({ ...emptyDashboardData, ...patch });

describe("Esko", () => {
  it("lists today's tasks from live counts, most urgent first", () => {
    const answer = eskoAnswer("today", data({ overdue_count: 2, overdue_totals: { CZK: 154900 }, payments_needing_review: 3, ocr_pending_confirmation: 1 }), "admin");
    expect(answer.lines.map(line => line.text)).toEqual([
      "2 faktury po splatnosti za 154\u00a0900\u00a0Kč",
      "3 platby čekají na spárování",
      "1 faktura z importu čeká na kontrolu",
    ]);
    expect(answer.lines[1].href).toBe("/invoices/payments");
  });

  it("says plainly when there is nothing to do", () => {
    // Zavedená firma (má historii), jen dnes nic nečeká.
    expect(eskoAnswer("today", data({}), "admin", { newCompany: false }).text).toContain("Dnes nic nehoří");
  });

  // Čtenář do Plateb nesmí; odkaz, který by ho poslal na zákaz, je horší než žádný.
  it("never links a viewer to a page the role cannot open", () => {
    const answer = eskoAnswer("today", data({ payments_needing_review: 3 }), "viewer");
    expect(answer.lines.every(line => !line.href || line.href !== "/invoices/payments")).toBe(true);
  });

  it("reports every currency instead of silently summing them", () => {
    const answer = eskoAnswer("overdue", data({ overdue_count: 3, overdue_totals: { CZK: 125000, EUR: 4200 } }), "accounting");
    expect(answer.text).toContain("125\u00a0000\u00a0Kč");
    expect(answer.text).toContain("4\u00a0200\u00a0€");
  });

  it("offers only questions it can answer from real data", () => {
    for (const question of ESKO_QUESTIONS) {
      expect(() => eskoAnswer(question.id, data({}), "admin")).not.toThrow();
    }
  });

  // Nová firma po onboardingu nemá žádná čísla. „Dnes nic nehoří“ by tam
  // znělo jako hotovo; ve skutečnosti je potřeba začít.
  it("guides a brand new company to its first steps instead of saying all is done", () => {
    const answer = eskoAnswer("today", data({}), "admin", { newCompany: true });
    expect(answer.text).toContain("Firma je připravená");
    expect(answer.lines.map(line => line.href)).toEqual(["/invoices/new", "/invoices/import", "/settings", "/reminders"]);
  });

  it("hides first steps the role cannot do", () => {
    const answer = eskoAnswer("today", data({}), "viewer", { newCompany: true });
    expect(answer.lines.some(line => line.href === "/settings" || line.href === "/invoices/new")).toBe(false);
  });

  it("treats a company with any invoice as established", () => {
    expect(eskoAnswer("today", data({ active_count: 1 }), "admin", { newCompany: false }).text).toContain("Dnes nic nehoří");
  });

  it("understands Czech free-text questions and an invoice number", () => {
    expect(eskoIntent("Kdy odejde další upomínka?")).toEqual({ kind: "question", id: "next_reminder" });
    expect(eskoIntent("Kolik plateb čeká na spárování?")).toEqual({ kind: "question", id: "payments" });
    expect(eskoIntent("Co čeká na kontrolu z OCR?")).toEqual({ kind: "question", id: "imports" });
    expect(eskoIntent("Najdi fakturu 1443260157")).toEqual({ kind: "invoice_search", query: "1443260157" });
    expect(eskoIntent("Najdi fakturu od Wood & Paper")).toEqual({ kind: "invoice_search", query: "wood & paper" });
    expect(eskoIntent("Kolik dluží firma Wood & Paper")).toEqual({ kind: "customer_debt", query: "wood & paper" });
    expect(eskoIntent("Vysvětli mi sazby DPH")).toEqual({ kind: "help" });
  });

  it("uses live counts for payments, OCR and reminders without claiming to send anything", () => {
    const summary = data({ payments_needing_review: 2, ocr_pending_confirmation: 1, reminders_due_soon: 3, reminders_sent: 5 });
    expect(eskoAnswer("payments", summary, "admin").text).toContain("2 platby čekají");
    expect(eskoAnswer("imports", summary, "admin").text).toContain("1 faktura z importu čeká");
    expect(eskoAnswer("reminders", summary, "admin").text).toContain("5 upomínek");
    expect(eskoAnswer("payments", summary, "viewer").lines).toEqual([]);
  });

  it("searches only returned invoices and respects the role of a viewer", () => {
    const invoice = { id: "8b1eea9a-b1ed-4b67-8e8f-39b1f2abb88c", invoice_number: "2026001", counterparty_name: "Test s.r.o.", amount: 1000, paid_amount: 200, currency: "CZK", status: "pending" as const, due_date: "2026-10-20" };
    const answer = eskoInvoiceSearchAnswer("2026001", [invoice], 1, "viewer");
    expect(answer.lines[0]).toMatchObject({ href: `/invoices/${invoice.id}` });
    expect(answer.lines[0].text).toContain("800\u00a0Kč");
    expect(answer.lines[0].text).toContain("20. 10. 2026");
    expect(eskoInvoiceSearchAnswer("nenalezeno", [], 0, "viewer").lines[0].href).toBe("/invoices?q=nenalezeno");
    expect(eskoInvoiceSearchAnswer("2026001", [invoice], 1, null).lines[0].href).toBeUndefined();
  });

  it("keeps customer debt in separate currencies and describes the search scope", () => {
    const answer = eskoCustomerDebtAnswer("wood", 3, { CZK: 1200, EUR: 100 }, "viewer");
    expect(answer.text).toContain("1\u00a0200\u00a0Kč");
    expect(answer.text).toContain("100\u00a0€");
    expect(answer.text).toContain("Ověřte");
    expect(answer.lines[0].href).toBe("/invoices?q=wood");
  });
});
