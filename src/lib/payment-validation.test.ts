import { describe, expect, it } from "vitest";
import { parsePaymentDate, paymentDateToTimestamp } from "./payment-validation";

describe("payment date", () => {
  it("přijme dnešní a dřívější kalendářní datum", () => {
    expect(parsePaymentDate("2026-08-06", "2026-08-06")).toBe("2026-08-06");
    expect(parsePaymentDate("2026-07-31", "2026-08-06")).toBe("2026-07-31");
  });

  it("odmítne budoucí a kalendářně neplatné datum", () => {
    expect(parsePaymentDate("2026-08-07", "2026-08-06")).toBeNull();
    expect(parsePaymentDate("2026-02-30", "2026-08-06")).toBeNull();
  });

  it("ukládá datum jako stabilní polední čas", () => {
    expect(paymentDateToTimestamp("2026-08-06")).toBe("2026-08-06T12:00:00.000Z");
  });
});
