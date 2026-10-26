import { describe, expect, it } from "vitest";
import { formatCzechDate } from "./display-date";
describe("Czech calendar date presentation", () => {
  it.each(["2026-03-29", "2026-10-25", "2026-01-01"])("preserves the day around time-zone boundaries: %s", value => {
    const [y,m,d] = value.split("-").map(Number);
    expect(formatCzechDate(value)).toBe(`${d}. ${m}. ${y}`);
  });
  it("formats timestamps in Prague and handles missing/invalid values", () => {
    expect(formatCzechDate("2026-10-24T23:30:00Z")).toBe("25. 10. 2026");
    expect(formatCzechDate(null)).toBe("—");
    expect(formatCzechDate("invalid")).toBe("—");
  });
});
