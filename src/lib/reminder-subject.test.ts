import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { reminderEmailSubject } from "./reminder-subject";

const source = (path: string) => readFileSync(join(process.cwd(), path), "utf8");

// Předmět upomínky i odeslané faktury: „Firma – Faktura číslo“. Odběratel
// hned vidí, kdo píše a o kterou fakturu jde; Splatno v předmětu není.
describe("předmět e-mailu s upomínkou", () => {
  it("firma – Faktura číslo", () => {
    expect(reminderEmailSubject("ACME s.r.o.", "FV-2026-0012")).toBe("ACME s.r.o. – Faktura FV-2026-0012");
  });

  it("neobsahuje Splatno", () => {
    expect(reminderEmailSubject("ACME s.r.o.", "FV-2026-0012")).not.toMatch(/splatno/i);
  });

  it("bez názvu firmy jen číslo faktury", () => {
    expect(reminderEmailSubject("", "FV-1")).toBe("Faktura FV-1");
    expect(reminderEmailSubject(null, "FV-1")).toBe("Faktura FV-1");
    expect(reminderEmailSubject("   ", "FV-1")).toBe("Faktura FV-1");
  });

  it("název firmy nerozbije hlavičku (zalomení řádků, mezery)", () => {
    expect(reminderEmailSubject("ACME\r\nBcc: x@y.cz", "FV-1")).toBe("ACME Bcc: x@y.cz – Faktura FV-1");
    expect(reminderEmailSubject("  Firma   s.r.o. ", "FV-1")).toBe("Firma s.r.o. – Faktura FV-1");
    expect(reminderEmailSubject("A".repeat(300), "FV-1").length).toBeLessThan(160);
  });

  it("odeslání i náhled v Upomínkách používají stejný předmět", () => {
    const email = source("src/lib/email.ts");
    expect(email).toContain("reminderEmailSubject(company.name, params.invoice.invoice_number)");
    expect(email).not.toContain("interpolateReminderTemplate(template.subject");
    const editor = source("src/app/(workspace)/reminders/email-templates-section.tsx");
    expect(editor).toContain("reminderEmailSubject(");
    // Předmět už se v šabloně neupravuje -- políčko by se tiše ignorovalo.
    expect(editor).not.toContain("onTemplateChange({ subject:");
  });
});
