import { describe, expect, it } from "vitest";
import { detectStatementAccountMismatch, parsePaymentCsv, resolveConfiguredAccountForCurrencies, statementCurrencyFor, validatePaymentRows } from "./payment-import";

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
    const company = { bank_account_czk: "6786420257/0100", bank_account_eur: "94-2613370257/0100" };
    const extraAccounts = [{ account: "6844160247/0100", currency: "CZK" }];
    const check = (statementAccountNumber: string | null, extra = extraAccounts) =>
      detectStatementAccountMismatch({ statementAccountNumber, paymentCurrencies: ["CZK"], company, extraAccounts: extra });

    it("accepts a statement from any registered account of the company", () => {
      expect(check("6786420257/0100")).toBe(false);
      expect(check("94-2613370257/0100")).toBe(false);
      // Druhý účet R. Hlavica: dřív neshoda u každého výpisu.
      expect(check("6844160247/0100")).toBe(false);
    });

    it("flags a statement from somebody else's account", () => {
      expect(check("19-2000145399/0800")).toBe(true);
      expect(check("6844160247/0100", [])).toBe(true);
    });

    // Dřív se porovnávala jen číslice bez kódu banky.
    it("flags the same number at another bank", () => {
      expect(check("6786420257/0800")).toBe(true);
    });

    it("skips the check when the statement carries no account (CSV) or the company has none", () => {
      expect(check(null)).toBe(false);
      expect(detectStatementAccountMismatch({ statementAccountNumber: "19-2000145399/0800", paymentCurrencies: ["CZK"], company: {} })).toBe(false);
    });
  });

  describe("statementCurrencyFor", () => {
    it("takes the currency from the company account the statement belongs to", () => {
      const company = { bank_account_czk: "6786420257/0100", bank_account_eur: "94-2613370257/0100" };
      expect(statementCurrencyFor("94-2613370257/0100", company)).toBe("EUR");
      expect(statementCurrencyFor("6786420257/0100", company)).toBe("CZK");
      expect(statementCurrencyFor("19-2000145399/0800", company)).toBeNull();
    });
  });
});
