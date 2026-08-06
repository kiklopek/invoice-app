import { describe, expect, it } from "vitest";
import { calendarDaysBetween } from "./reporting";

describe("calendarDaysBetween", () => {
  it("počítá celé firemní dny bez posunu časovým pásmem", () => {
    expect(calendarDaysBetween("2026-08-05", "2026-08-06")).toBe(1);
    expect(calendarDaysBetween("2026-07-31", "2026-08-01")).toBe(1);
    expect(calendarDaysBetween("2026-08-06", "2026-08-06")).toBe(0);
  });
});

