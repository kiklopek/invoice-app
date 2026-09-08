import { describe, expect, it } from "vitest";
import { normalizeReminderDays, reminderDayLabel } from "./reminder-policies";

describe("reminder policy categories", () => {
  it("normalizuje a seřadí termíny", () => {
    expect(normalizeReminderDays([14, 0, -3, 7])).toEqual([-3, 0, 7, 14]);
  });

  it("odmítne prázdný plán a termíny mimo povolený rozsah", () => {
    expect(normalizeReminderDays([])).toBeNull();
    expect(normalizeReminderDays([-91, 0])).toBeNull();
    expect(normalizeReminderDays([0, 366])).toBeNull();
    expect(normalizeReminderDays([0, 7, 7])).toBeNull();
  });

  it("vytvoří srozumitelné české popisky", () => {
    expect([-3, 0, 14].map(reminderDayLabel)).toEqual([
      "3 dny před splatností",
      "V den splatnosti",
      "14 dní po splatnosti",
    ]);
  });
});
