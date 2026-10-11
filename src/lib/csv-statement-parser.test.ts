import { describe, expect, it } from "vitest";
import { parseCsvStatement } from "./csv-statement-parser";

const csv = [
  "ID transakce,Datum,Částka,Měna,Variabilní symbol,Protistrana,Účet protistrany,Poznámka",
  "BANK-1,2026-09-10,1000,CZK,2026001,Odběratel s.r.o.,CZ1234567890,Úhrada faktury",
].join("\n");

function bytes(text: string) {
  return new TextEncoder().encode(text);
}

describe("parseCsvStatement", () => {
  it("produces the same shape as the GPC parser so downstream preview/commit code stays format-agnostic", () => {
    const result = parseCsvStatement(bytes(csv));
    expect(result.accountNumber).toBeNull();
    expect(result.totals).toEqual({ accepted: 1, ignored: 0, errors: 0 });
    expect(result.entries).toHaveLength(1);
    expect(result.entries[0].disposition).toBe("accepted");
    expect(result.entries[0].payment?.external_id).toBe("BANK-1");
    expect(result.entries[0].payment?.amount).toBe(1000);
    expect(result.payments).toHaveLength(1);
    expect(result.fileHash).toMatch(/^[a-f0-9]{64}$/);
  });

  it("gives every accepted entry a stable, distinct fingerprint so duplicate detection works", () => {
    const two = [
      "ID transakce,Datum,Částka,Měna",
      "BANK-1,2026-09-10,1000,CZK",
      "BANK-2,2026-09-11,500,CZK",
    ].join("\n");
    const result = parseCsvStatement(bytes(two));
    const fingerprints = result.entries.map((entry) => entry.fingerprint);
    expect(new Set(fingerprints).size).toBe(2);
  });

  it("rejects an empty file", () => {
    expect(() => parseCsvStatement(new Uint8Array())).toThrow();
  });

  it("falls back to Windows-1250 when the file isn't valid UTF-8 (a common Czech bank CSV export encoding)", () => {
    const ascii = [
      "transaction id,date,amount,currency,counterparty name",
      "BANK-1,2026-09-10,1000,CZK,Zlutoucky kun",
    ].join("\n");
    const encoded = bytes(ascii);
    const position = ascii.indexOf("Zlutoucky kun");
    // Same byte-injection technique as the GPC parser's Windows-1250 test:
    // these bytes are "Žluťoučký kůň" encoded as CP1250, which are not a
    // valid UTF-8 sequence, so decodeCsv should detect that and re-decode
    // the whole file as Windows-1250 instead of keeping the mojibake.
    encoded.set(
      [0x8e, 0x6c, 0x75, 0x9d, 0x6f, 0x75, 0xe8, 0x6b, 0xfd, 0x20, 0x6b, 0xf9, 0xf2],
      position,
    );
    const result = parseCsvStatement(encoded);
    expect(result.entries[0].payment?.counterparty_name).toBe("Žluťoučký kůň");
  });

  // Vadný řádek je chyba jen toho řádku (jako u GPC), ne celého souboru.
  it("reports a malformed row as an error entry", () => {
    const invalid = ["ID transakce,Datum,Částka,Měna", "BANK-1,not-a-date,1000,CZK"].join("\n");
    const result = parseCsvStatement(bytes(invalid));
    expect(result.totals).toEqual({ accepted: 0, ignored: 0, errors: 1 });
  });

  it("still rejects a file without the required columns", () => {
    expect(() => parseCsvStatement(bytes("Datum,Částka\n2026-09-10,1000"))).toThrow();
  });
});

// Skutečné CSV exporty bank: odchozí platby se zápornou částkou, částky
// s oddělovačem tisíců, reference RF… místo VS a někdy prázdná měna.
describe("parseCsvStatement s exportem banky", () => {
  const header = "ID transakce;Datum;Částka;Měna;Variabilní symbol;Protistrana";

  it("skips outgoing payments instead of rejecting the whole statement", () => {
    const result = parseCsvStatement(bytes([header, "1;10.09.2026;1 500,00;CZK;2026001;Odběratel", "2;10.09.2026;-350,00;CZK;;Dodavatel"].join("\n")));
    expect(result.totals).toEqual({ accepted: 1, ignored: 1, errors: 0 });
    expect(result.payments.map((payment) => payment.amount)).toEqual([1500]);
    expect(result.entries.find((entry) => entry.disposition === "ignored")?.reason).toMatch(/odchozí/i);
  });

  it("reads Czech amounts and never turns an ambiguous '1.500' into 1.5", () => {
    const result = parseCsvStatement(bytes([header,
      "1;10.09.2026;1 500,00;CZK;1;A",
      "2;10.09.2026;1.500.000,50;CZK;2;B",
      "3;10.09.2026;1500.25;CZK;3;C",
      "4;10.09.2026;1.500;CZK;4;D",
      "5;10.09.2026;1,500;CZK;5;E",
    ].join("\n")));
    expect(result.payments.map((payment) => payment.amount)).toEqual([1500, 1500000.5, 1500.25]);
    const errors = result.entries.filter((entry) => entry.disposition === "error");
    expect(errors).toHaveLength(2);
    expect(errors[0].reason).toMatch(/částk/i);
  });

  it("keeps a non-numeric payment reference as a message instead of failing", () => {
    const result = parseCsvStatement(bytes([header, "1;10.09.2026;100,00;EUR;RF18539007547034;Payer"].join("\n")));
    expect(result.payments[0]).toMatchObject({ variable_symbol: "", note: "RF18539007547034", currency: "EUR" });
  });

  it("never fills a missing currency in as CZK", () => {
    const result = parseCsvStatement(bytes([header, "1;10.09.2026;100,00;;1;Payer"].join("\n")));
    expect(result.payments).toHaveLength(0);
    expect(result.entries[0]).toMatchObject({ disposition: "error" });
    expect(result.entries[0].reason).toMatch(/měn/i);
  });
});
