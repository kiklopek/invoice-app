import { describe, expect, it } from "vitest";
import {
  proposePaymentMatch,
  validateAllocationTotal,
  type MatchableInvoice,
} from "./payment-matching";

const invoice = (
  id: string,
  amount: number,
  overrides: Partial<MatchableInvoice> = {},
): MatchableInvoice => ({
  id,
  invoice_number: id,
  counterparty_name: "Firma",
  counterparty_ico: "123",
  variable_symbol: "42",
  currency: "CZK",
  amount,
  paid_amount: 0,
  ...overrides,
});

describe("payment matching", () => {
  it("preselects only a unique exact full payment", () => {
    expect(
      proposePaymentMatch(
        { amount: 100, currency: "CZK", variable_symbol: "00042" },
        [invoice("a", 100)],
      ),
    ).toEqual(
      expect.objectContaining({
        kind: "exact",
        confidence: "safe",
        invoiceIds: ["a"],
      }),
    );
    expect(
      proposePaymentMatch(
        { amount: 50, currency: "CZK", variable_symbol: "42" },
        [invoice("a", 100)],
      ).confidence,
    ).toBe("review");
  });

  it.each([2, 4, 10])(
    "suggests one exact combination of %i whole invoices",
    (count) => {
      const invoices = Array.from({ length: count }, (_, index) =>
        invoice(String(index), 100, {
          variable_symbol: index === 0 ? "42" : String(index + 100),
        }),
      );
      const result = proposePaymentMatch(
        { amount: count * 100, currency: "CZK", variable_symbol: "42" },
        invoices,
      );
      expect(result.kind).toBe("combination");
      expect(result.invoiceIds).toHaveLength(count);
    },
  );

  it("marks multiple combinations as ambiguous", () => {
    const result = proposePaymentMatch(
      { amount: 200, currency: "CZK", variable_symbol: "42" },
      [
        invoice("a", 100),
        invoice("b", 100),
        invoice("c", 200, { variable_symbol: "99" }),
      ],
    );
    expect(result.kind).toBe("ambiguous");
  });

  it("uses account history only as a review suggestion", () => {
    const result = proposePaymentMatch(
      { amount: 200, currency: "CZK" },
      [invoice("a", 100), invoice("b", 100)],
      ["123"],
    );
    expect(result).toEqual(
      expect.objectContaining({
        kind: "account_suggestion",
        confidence: "review",
      }),
    );
  });

  it("blocks overpayments and requires an explicit partial exception", () => {
    expect(validateAllocationTotal(100, [{ amount: 110 }], true).valid).toBe(
      false,
    );
    expect(validateAllocationTotal(100, [{ amount: 50 }], false).valid).toBe(
      false,
    );
    expect(validateAllocationTotal(100, [{ amount: 50 }], true).valid).toBe(
      true,
    );
  });

  it("finds an exact invoice in a 10,000 invoice seed", () => {
    const invoices = Array.from({ length: 10_000 }, (_, index) =>
      invoice(String(index), index + 1, {
        variable_symbol: String(index + 1),
        counterparty_ico: String(index + 1),
      }),
    );
    expect(
      proposePaymentMatch(
        { amount: 10_000, currency: "CZK", variable_symbol: "10000" },
        invoices,
      ).invoiceIds,
    ).toEqual(["9999"]);
  });
});
