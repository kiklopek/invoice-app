import { describe, expect, it } from "vitest";
import { demoInvoices } from "./demo-data";
import { interpolateReminderTemplate, unsupportedTemplateVariables } from "./reminder-template";

describe("reminder templates", () => {
  it("doplní fakturační údaje ve stabilním českém formátu", () => {
    const invoice = { ...demoInvoices[0], amount: 1234.5, due_date: "2026-08-06" };
    expect(interpolateReminderTemplate("{{counterparty_name}} · {{amount}} {{currency}} · {{due_date}}", invoice))
      .toBe("Stavby Novák s.r.o. · 1 234,50 CZK · 6. 8. 2026");
  });

  it("odhalí překlep nebo nepodporovanou proměnnou", () => {
    expect(unsupportedTemplateVariables("{{invoice_number}} {{ammount}} {{secret}} {{ammount}}"))
      .toEqual(["ammount", "secret"]);
  });
});

