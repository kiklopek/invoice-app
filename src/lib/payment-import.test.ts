import { describe, expect, it } from "vitest";
import { parsePaymentCsv, validatePaymentRows } from "./payment-import";

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
});
