import { describe, expect, it } from "vitest";
import { detectStatementFormat, resolveGpcStatement } from "./detect";
import { bankName, gpcProfileFor } from "./registry";

// Hlavička GPC: 074 + účet (16) + 20 mezer + zbytek do 128 znaků; volitelně
// značky KB (IBAN prefix na 115–122, kanál MB na 123–124).
function header(account16: string, kbMarkers = false) {
  const body = `074${account16}${" ".repeat(20)}`.padEnd(114, " ");
  return (kbMarkers ? `${body}CZ650100MB` : body).padEnd(128, " ");
}
function line(counterparty16: string, bankCode: string) {
  return [
    "075", "0000000000000000", counterparty16, "0000000000042", "000000012345", "2",
    "0000000042", "00", bankCode, "0000", "0000000000", "000000",
    "Zakaznik s.r.o.".padEnd(20, " "), "0", "0000", "140926",
  ].join("");
}
const gpc = (...lines: string[]) => new TextEncoder().encode(lines.join("\r\n"));

// KB permutuje čísla účtů (docs/bank-formats/kb-gpc-km.md): 6786420257 leží
// v souboru jako 7252678640000000; protiúčet 117840513/0300 jako 3514011780000000.
const KB_HEADER = "7252678640000000";
const KB_COUNTERPARTY = "3514011780000000";

describe("registr bank", () => {
  it("knows KB's permuted 'KM' dialect as verified and nothing else is assumed", () => {
    expect(gpcProfileFor("0100")).toMatchObject({ dialect: "km", verified: true });
    expect(gpcProfileFor("0800")).toMatchObject({ dialect: "edition", verified: false });
    expect(bankName("0800")).toBe("Česká spořitelna");
    expect(bankName("9999")).toBeNull();
  });
});

describe("detectStatementFormat", () => {
  it("decides by content, not by the file name", () => {
    expect(detectStatementFormat(gpc(header(KB_HEADER, true)), "vypis.txt")).toBe("gpc");
    expect(detectStatementFormat(new TextEncoder().encode('<?xml version="1.0"?><Document xmlns="urn:iso:std:iso:20022:tech:xsd:camt.053.001.02"></Document>'), "x.dat")).toBe("camt053");
    expect(detectStatementFormat(new TextEncoder().encode("ID transakce;Datum;Částka;Měna\n1;2026-09-01;10;CZK"), "export.txt")).toBe("csv");
    expect(detectStatementFormat(new TextEncoder().encode("nesmysl"), "x.pdf")).toBeNull();
  });
});

describe("resolveGpcStatement", () => {
  const kbCompany = [{ account: "6786420257/0100", currency: "CZK", primary: true }];

  it("recognises KB by its own markers and decodes the permuted accounts", () => {
    const result = resolveGpcStatement(gpc(header(KB_HEADER, true), line(KB_COUNTERPARTY, "0300")), kbCompany);
    expect(result).toMatchObject({ bankCode: "0100", dialect: "km", verified: true });
    expect(result.parsed.accountNumber).toBe("6786420257/0100");
    expect(result.parsed.payments[0]).toMatchObject({ counterparty_account: "117840513/0300", counterparty_account_verified: true });
  });

  it("recognises a KB file without markers by the company's KB account", () => {
    const result = resolveGpcStatement(gpc(header(KB_HEADER), line(KB_COUNTERPARTY, "0300")), kbCompany);
    expect(result).toMatchObject({ bankCode: "0100", dialect: "km", verified: true });
    expect(result.parsed.payments[0].counterparty_account).toBe("117840513/0300");
  });

  it("reads another bank's file in plain form, adds its bank code, and trusts no account number until verified", () => {
    const company = [{ account: "19-2000145399/0800", currency: "CZK", primary: true }];
    const result = resolveGpcStatement(gpc(header("0000192000145399"), line("0000000117840513", "0300")), company);
    expect(result).toMatchObject({ bankCode: "0800", dialect: "edition", verified: false });
    expect(result.parsed.accountNumber).toBe("19-2000145399/0800");
    // Neověřená banka: párování jen podle VS, nikdy podle čísla účtu.
    expect(result.parsed.payments[0]).toMatchObject({ counterparty_account: "117840513/0300", counterparty_account_verified: false });
  });

  it("leaves the bank unknown when the statement belongs to none of the company's accounts", () => {
    const result = resolveGpcStatement(gpc(header("0000192000145399"), line("0000000117840513", "0300")), kbCompany);
    expect(result.bankCode).toBeNull();
    expect(result.verified).toBe(false);
    expect(result.parsed.payments[0].counterparty_account_verified).toBe(false);
  });
});
