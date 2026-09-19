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

  it("propagates the underlying CSV validation error for malformed rows", () => {
    const invalid = ["ID transakce,Datum,Částka,Měna", "BANK-1,not-a-date,1000,CZK"].join("\n");
    expect(() => parseCsvStatement(bytes(invalid))).toThrow();
  });
});
