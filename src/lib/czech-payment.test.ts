import { describe, expect, it } from "vitest";
import { buildSpayd, czechAccountToIban, parseCzechAccount } from "./czech-payment";

describe("parseCzechAccount", () => {
  it("reads both the plain and the prefixed form", () => {
    expect(parseCzechAccount("6786420257/0100")).toEqual({ prefix: "", number: "6786420257", bank: "0100" });
    expect(parseCzechAccount("94-2613370257/0100")).toEqual({ prefix: "94", number: "2613370257", bank: "0100" });
    expect(parseCzechAccount(" 19-123/0800 ")).toEqual({ prefix: "19", number: "123", bank: "0800" });
  });

  it("refuses anything that is not an account number", () => {
    for (const value of [null, undefined, "", "abc", "123", "123/", "/0100", "123/01000", "12345678901/0100"]) {
      expect(parseCzechAccount(value), String(value)).toBeNull();
    }
  });
});

describe("czechAccountToIban", () => {
  // Kontrola proti skutecnym uctum organizace v databazi.
  it("converts real accounts from the application", () => {
    expect(czechAccountToIban("6786420257/0100")).toBe("CZ3401000000006786420257");
    expect(czechAccountToIban("94-2613370257/0100")).toBe("CZ8001000000942613370257");
  });

  it("produces a 24 character IBAN whose own checksum validates", () => {
    const iban = czechAccountToIban("6786420257/0100")!;
    expect(iban).toHaveLength(24);
    // Overeni podle ISO 13616: presun prvnich ctyr znaku na konec, prevod
    // pismen na cisla, mod 97 musi byt 1.
    const rearranged = iban.slice(4) + iban.slice(0, 4);
    const numeric = [...rearranged].map(c => (/\d/.test(c) ? c : String(c.charCodeAt(0) - 55))).join("");
    let remainder = 0;
    for (const digit of numeric) remainder = (remainder * 10 + Number(digit)) % 97;
    expect(remainder).toBe(1);
  });

  // Tohle je ten dulezity pripad: spatny IBAN v QR kodu posle penize jinam,
  // takze pri pochybnostech se nevraci nic.
  it("returns null rather than guessing when the account fails the checksum", () => {
    expect(czechAccountToIban("6786420258/0100")).toBeNull();
    expect(czechAccountToIban("nesmysl")).toBeNull();
    expect(czechAccountToIban(null)).toBeNull();
  });
});

describe("buildSpayd", () => {
  const base = { account: "6786420257/0100", amount: 12100, currency: "CZK" };

  it("builds a payment string a Czech banking app can read", () => {
    expect(buildSpayd({ ...base, variableSymbol: "20260042", dueDate: "2026-01-19" }))
      .toBe("SPD*1.0*ACC:CZ3401000000006786420257*AM:12100.00*CC:CZK*X-VS:20260042*DT:20260119");
  });

  it("strips diacritics and field separators from the message", () => {
    const spayd = buildSpayd({ ...base, message: "Faktura č. 2026*0042: děkujeme" })!;
    expect(spayd).toContain("MSG:Faktura c. 2026 0042 dekujeme");
    // Hvezdicka oddeluje pole, dvojtecka klic od hodnoty -- ani jedno
    // se nesmi dostat dovnitr hodnoty.
    expect(spayd.split("*").length).toBe(6);
  });

  it("refuses to produce a QR code that could not be paid", () => {
    expect(buildSpayd({ ...base, account: "neplatny" })).toBeNull();
    expect(buildSpayd({ ...base, amount: 0 })).toBeNull();
    expect(buildSpayd({ ...base, amount: -10 })).toBeNull();
    expect(buildSpayd({ ...base, currency: "czk" })).toBeNull();
  });

  it("keeps only digits in the variable symbol", () => {
    expect(buildSpayd({ ...base, variableSymbol: "VS-2026/0042" })).toContain("X-VS:20260042");
  });
});
