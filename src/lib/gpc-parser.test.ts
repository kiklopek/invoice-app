import { describe, expect, it } from "vitest";
import { parseGpc } from "./gpc-parser";

function transaction(
  overrides: {
    code?: string;
    bankCode?: string;
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
    // Real GPC exports carry the counterparty's bank code here (e.g. "0100"
    // for Komerční banka), not a currency code -- GPC ("tuzemský platební
    // styk") is a Czech domestic-only clearing format with no currency field
    // at all. This is unused by the parser today; kept only so the fixture's
    // byte layout matches a real 128-byte record.
    overrides.bankCode ?? "0100",
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

  it("keeps debits and reversals visible as ignored", () => {
    const parsed = parseGpc(
      file(
        transaction({ code: "1" }),
        transaction({ code: "5" }),
      ),
    );
    expect(parsed.payments).toHaveLength(0);
    expect(parsed.totals).toEqual({ accepted: 0, ignored: 2, errors: 0 });
  });

  it("always reads incoming GPC payments as CZK -- GPC is a Czech domestic-only clearing format with no currency field", () => {
    // Regression test for a real bug: bytes 118-121 were previously misread
    // as an ISO 4217 numeric currency code. A real bank export puts the
    // counterparty's bank code there instead (see the `transaction` fixture
    // above) -- treating it as currency rejected every real transaction as
    // an "unsupported currency", since it's never actually "0203" (CZK).
    const parsed = parseGpc(file(transaction({ bankCode: "0170" })));
    expect(parsed.totals).toEqual({ accepted: 1, ignored: 0, errors: 0 });
    expect(parsed.payments[0].currency).toBe("CZK");
  });

  it("reports malformed and duplicate rows without losing the preview", () => {
    const row = transaction();
    const parsed = parseGpc(file(row, row, row.slice(0, -1)));
    expect(parsed.totals).toEqual({ accepted: 1, ignored: 1, errors: 1 });
    expect(parsed.entries.map((entry) => entry.disposition)).toEqual([
      "accepted",
      "duplicate",
      "error",
    ]);
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

describe("KB internal account format", () => {
  // KB+ exports account numbers permuted ("klientský formát KM"). Read raw they
  // are not accounts at all, which silently poisoned both the account-mismatch
  // check and every payer identity the ledger learned.
  const pad = (value: string, width: number) => value.padEnd(width, " ").slice(0, width);
  const digits = (value: string, width: number) => value.padStart(width, "0").slice(-width);

  // Positions follow KB's spec: IBAN prefix at 115-122, channel at 123-124.
  const header = (own: string, ibanPrefix: string, channel: string) =>
    "074" + own + pad("HLAVICA ROBERT", 20) + "140926" +
    pad("", 114 - 45) + pad(ibanPrefix, 8) + pad(channel, 2) + pad("", 4);

  const row = (counterparty: string, constantSymbolField: string) =>
    "075" + "7252678640000000" + counterparty + digits("1", 13) + digits("100000", 12) +
    "2" + digits("260610", 10) + constantSymbolField + digits("", 10) + "000000" +
    pad("C.S.CARGO A.S.", 20) + "0" + "0000" + "150926";

  const parse = (own: string, counterparty: string, ks: string, iban: string, channel: string) =>
    parseGpc(new TextEncoder().encode([header(own, iban, channel), row(counterparty, ks)].join("\r\n")));

  it("decodes the statement's own account to the number printed on the invoices", () => {
    const parsed = parse("7252678640000000", "3514011780000000", "0003000000", "CZ340100", "MB");
    expect(parsed.accountNumber).toBe("6786420257/0100");
  });

  it("decodes a counterparty account and attaches its bank code", () => {
    const parsed = parse("7252678640000000", "3514011780000000", "0003000000", "CZ340100", "MB");
    // Bank 0300 is what this customer's invoice states, which is the
    // independent confirmation that the permutation is read correctly.
    expect(parsed.payments[0].counterparty_account).toBe("117840513/0300");
  });

  it("leaves a plain edition-format GPC from another bank untouched", () => {
    // No channel and no IBAN prefix: permuting here would scramble digits that
    // were already correct.
    const parsed = parse("0000006786420257", "0000000117840513", "0000000000", "", "");
    expect(parsed.accountNumber).toBe("6786420257");
    expect(parsed.payments[0].counterparty_account).toBe("117840513");
  });
});
