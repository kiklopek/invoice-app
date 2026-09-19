import { describe, expect, it } from "vitest";
import { parsePaymentReconciliationQuery } from "./payment-reconciliation-query";

describe("parsePaymentReconciliationQuery", () => {
  it("accepts a valid ISO date range", () => {
    expect(parsePaymentReconciliationQuery("2026-08-01", "2026-08-31")).toEqual({
      from: "2026-08-01",
      to: "2026-08-31",
    });
  });

  it("rejects a range where from is after to", () => {
    expect(parsePaymentReconciliationQuery("2026-08-31", "2026-08-01")).toBeNull();
  });

  it("rejects malformed dates", () => {
    expect(parsePaymentReconciliationQuery("not-a-date", "2026-08-31")).toBeNull();
    expect(parsePaymentReconciliationQuery("2026-08-01", "")).toBeNull();
  });
});
