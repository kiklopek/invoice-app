import { describe, expect, it } from "vitest";
import { canCancelInvoiceFrom, isOpenInvoiceStatus, requiresAtomicPaymentReopen } from "./payment-lifecycle";

describe("invoice payment lifecycle", () => {
  it("requires atomic cleanup whenever a paid invoice becomes open again", () => {
    expect(requiresAtomicPaymentReopen("paid", "pending")).toBe(true);
    expect(requiresAtomicPaymentReopen("paid", "overdue")).toBe(true);
    expect(requiresAtomicPaymentReopen("pending", "overdue")).toBe(false);
    expect(requiresAtomicPaymentReopen("paid", "paid")).toBe(false);
  });

  it("allows cancellation only for an open receivable", () => {
    expect(canCancelInvoiceFrom("pending")).toBe(true);
    expect(canCancelInvoiceFrom("overdue")).toBe(true);
    expect(canCancelInvoiceFrom("paid")).toBe(false);
    expect(canCancelInvoiceFrom("cancelled")).toBe(false);
    expect(isOpenInvoiceStatus("overdue")).toBe(true);
  });
});
