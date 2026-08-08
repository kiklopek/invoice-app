import { describe, expect, it } from "vitest";
import { defaultReminderTemplates } from "./reminder-defaults";

describe("default reminder templates", () => {
  it("keep editable copy concise because payment details come from the branded layout", () => {
    for (const template of Object.values(defaultReminderTemplates)) {
      expect(template.body).toMatch(/^Dobrý den,/);
      expect(template.body).not.toContain("Číslo faktury:");
      expect(template.body).not.toContain("S pozdravem");
    }
  });

  it("never claims that an overdue invoice payment is already recorded", () => {
    expect(defaultReminderTemplates.overdue.body).toContain("neevidujeme úhradu");
    expect(defaultReminderTemplates.overdue.body).not.toMatch(/(?:^|\s)evidujeme úhradu/);
  });
});
