import { describe, expect, it } from "vitest";
import { emptyDashboardData, type DashboardData } from "./dashboard-summary";
import { eskoAnswer, ESKO_QUESTIONS } from "./esko";

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
});

