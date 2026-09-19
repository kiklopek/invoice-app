import { describe, expect, it } from "vitest";
import { detectStatementAccountMismatch, parsePaymentCsv, resolveConfiguredAccountForCurrencies, validatePaymentRows } from "./payment-import";

describe("payment import", () => {
  it("parses Czech semicolon CSV and Czech dates", () => {
    const rows = parsePaymentCsv("ID transakce;Datum;Částka;Měna;Variabilní symbol;Protistrana\nTX-1;6.8.2026;12 500,50;CZK;2026001;Odběratel s.r.o.");
    expect(rows).toEqual([expect.objectContaining({ external_id: "TX-1", booked_on: "2026-08-06", amount: 12500.5, currency: "CZK", variable_symbol: "2026001" })]);
  });

  it("handles quoted comma CSV", () => {
    const rows = parsePaymentCsv('transaction id,date,amount,currency,variable symbol,counterparty name\nTX-2,2026-08-05,"1,100.25",EUR,55,"Firma, s.r.o."');
    expect(rows[0]).toEqual(expect.objectContaining({ amount: 1100.25, counterparty_name: "Firma, s.r.o." }));
  });

  it("rejects duplicate transaction identifiers", () => {
    expect(validatePaymentRows([
      { external_id: "TX", booked_on: "2026-08-05", amount: 100, currency: "CZK", variable_symbol: "1" },
      { external_id: "TX", booked_on: "2026-08-06", amount: 200, currency: "CZK", variable_symbol: "2" },
    ])).toBeNull();
  });

  it("rejects impossible dates and negative amounts", () => {
    expect(validatePaymentRows([{ external_id: "TX", booked_on: "2026-02-30", amount: -1, currency: "CZK", variable_symbol: "1" }])).toBeNull();
  });

  describe("resolveConfiguredAccountForCurrencies", () => {
    const company = { bank_account_czk: "123456789/0100", bank_account_eur: "987654321/0100" };

    it("returns the CZK account for a CZK-only statement", () => {
      expect(resolveConfiguredAccountForCurrencies(["CZK", "CZK"], company)).toBe("123456789/0100");
    });

    it("returns the EUR account for a EUR-only statement", () => {
      expect(resolveConfiguredAccountForCurrencies(["EUR"], company)).toBe("987654321/0100");
    });

    it("returns null for a mixed-currency statement -- no single account applies", () => {
      expect(resolveConfiguredAccountForCurrencies(["CZK", "EUR"], company)).toBeNull();
    });

    it("returns null when the org has no configured account for that currency", () => {
      expect(resolveConfiguredAccountForCurrencies(["USD"], company)).toBeNull();
    });
  });

  describe("detectStatementAccountMismatch", () => {
    const company = { bank_account_czk: "123456789/0100", bank_account_eur: "987654321/0100" };

    it("flags a CZK statement against the wrong CZK account", () => {
      expect(detectStatementAccountMismatch({
        statementAccountNumber: "111111111",
        paymentCurrencies: ["CZK", "CZK"],
        company,
      })).toBe(true);
    });

    it("does not flag a CZK statement matching the configured CZK account", () => {
      expect(detectStatementAccountMismatch({
        statementAccountNumber: "123456789",
        paymentCurrencies: ["CZK"],
        company,
      })).toBe(false);
    });

    it("checks against the EUR account when the statement's payments are all EUR", () => {
      expect(detectStatementAccountMismatch({
        statementAccountNumber: "123456789", // matches CZK, not EUR
        paymentCurrencies: ["EUR", "EUR"],
        company,
      })).toBe(true);
      expect(detectStatementAccountMismatch({
        statementAccountNumber: "987654321",
        paymentCurrencies: ["EUR"],
        company,
      })).toBe(false);
    });

    it("skips the check for a mixed-currency statement -- there is no single account to compare against", () => {
      expect(detectStatementAccountMismatch({
        statementAccountNumber: "111111111",
        paymentCurrencies: ["CZK", "EUR"],
        company,
      })).toBe(false);
    });

    it("skips the check when the org has no configured account for the statement's currency", () => {
      expect(detectStatementAccountMismatch({
        statementAccountNumber: "111111111",
        paymentCurrencies: ["USD"],
        company,
      })).toBe(false);
    });

    it("skips the check when there are no accepted payments at all", () => {
      expect(detectStatementAccountMismatch({
        statementAccountNumber: "111111111",
        paymentCurrencies: [],
        company,
      })).toBe(false);
    });
  });
});
