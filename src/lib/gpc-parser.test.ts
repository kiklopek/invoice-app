import { describe, expect, it } from "vitest";
import { parseGpc } from "./gpc-parser";

function transaction(
  overrides: {
    code?: string;
    currency?: string;
    amount?: string;
    vs?: string;
    date?: string;
    name?: string;
  } = {},
) {
  return [
    "075",
    "0000001234567890",
    "0000000987654321",
    "0000000000042",
    overrides.amount ?? "000000012345",
    overrides.code ?? "2",
    (overrides.vs ?? "0000000042").padStart(10, "0"),
    "0000000000",
    "0000000000",
    "000000",
    (overrides.name ?? "Zakaznik s.r.o.").padEnd(20, " ").slice(0, 20),
    "0",
    overrides.currency ?? "0203",
    overrides.date ?? "140926",
  ].join("");
}

function file(...transactions: string[]) {
  const header = `074${"0000001234567890"}${" ".repeat(109)}`;
  return new TextEncoder().encode([header, ...transactions].join("\r\n"));
}

describe("GPC parser", () => {
  it("parses an incoming CZK payment and normalizes its VS", () => {
    const parsed = parseGpc(file(transaction()));
    expect(parsed.payments[0]).toEqual(
      expect.objectContaining({
        amount: 123.45,
        currency: "CZK",
        variable_symbol: "42",
        booked_on: "2026-09-14",
      }),
    );
    expect(parsed.entries[0].fingerprint).toHaveLength(64);
    expect(parsed.fileHash).toHaveLength(64);
  });

  it("keeps debits, reversals and foreign currencies visible as ignored", () => {
    const parsed = parseGpc(
      file(
        transaction({ code: "1" }),
        transaction({ code: "5" }),
        transaction({ currency: "0978" }),
      ),
    );
    expect(parsed.payments).toHaveLength(0);
    expect(parsed.totals).toEqual({ accepted: 0, ignored: 3, errors: 0 });
  });

  it("reports malformed and duplicate rows without losing the preview", () => {
    const row = transaction();
    const parsed = parseGpc(file(row, row, row.slice(0, -1)));
    expect(parsed.totals).toEqual({ accepted: 1, ignored: 1, errors: 1 });
  });

  it("accepts LF line endings", () => {
    const bytes = file(transaction());
    const lf = new TextEncoder().encode(
      new TextDecoder().decode(bytes).replaceAll("\r\n", "\n"),
    );
    expect(parseGpc(lf).payments).toHaveLength(1);
  });

  it("decodes Windows-1250 counterparty names", () => {
    const ascii = transaction({ name: "Zlutoucky kun" });
    const bytes = file(ascii);
    const position = new TextDecoder().decode(bytes).indexOf("Zlutoucky kun");
    bytes.set(
      [
        0x8e, 0x6c, 0x75, 0x9d, 0x6f, 0x75, 0xe8, 0x6b, 0xfd, 0x20, 0x6b, 0xf9,
        0xf2,
      ],
      position,
    );
    expect(parseGpc(bytes).payments[0].counterparty_name).toBe("Žluťoučký kůň");
  });

  it("processes the maximum batch of 10,000 transactions", () => {
    const rows = Array.from({ length: 10_000 }, (_, index) =>
      transaction({ vs: String(index + 1) }),
    );
    const parsed = parseGpc(file(...rows));
    expect(parsed.payments).toHaveLength(10_000);
    expect(parsed.totals.errors).toBe(0);
  });
});
