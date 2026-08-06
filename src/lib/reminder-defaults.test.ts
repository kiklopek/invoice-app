import { describe, expect, it } from "vitest";
import { defaultReminderTemplates } from "./reminder-defaults";

describe("default reminder templates", () => {
  it("never claims that an overdue invoice payment is already recorded", () => {
    expect(defaultReminderTemplates.overdue.body).toContain("neevidujeme úhradu");
    expect(defaultReminderTemplates.overdue.body).not.toMatch(/(?:^|\s)evidujeme úhradu/);
  });
});
