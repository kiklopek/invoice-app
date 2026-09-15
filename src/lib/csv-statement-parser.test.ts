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

  it("propagates the underlying CSV validation error for malformed rows", () => {
    const invalid = ["ID transakce,Datum,Částka,Měna", "BANK-1,not-a-date,1000,CZK"].join("\n");
    expect(() => parseCsvStatement(bytes(invalid))).toThrow();
  });
});
