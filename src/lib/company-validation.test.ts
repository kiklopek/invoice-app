import { describe, expect, it } from "vitest";
import { isValidBankAccount, isValidDic, isValidIco, validateCompanyFields } from "./company-validation";

describe("isValidIco", () => {
  it("accepts the real IČO of the organization using the app", () => {
    expect(isValidIco("26296039")).toBe(true);
    expect(isValidIco("00000019")).toBe(true);
  });

  it("rejects eight digits that fail the check digit", () => {
    // Tohle je smysl kontroly: "12345678" je osmimistne a presto neplatne.
    // Puvodni validace (jen /^\d{8}$/) ho poustela dal.
    expect(isValidIco("12345678")).toBe(false);
    expect(isValidIco("87654321")).toBe(false);
  });

  it("rejects anything that is not eight digits", () => {
    for (const value of ["", "2629603", "262960391", "2629603a", " 26296039 x"]) {
      expect(isValidIco(value), value).toBe(false);
    }
  });

  it("ignores surrounding whitespace", () => {
    expect(isValidIco("  26296039  ")).toBe(true);
  });
});

describe("isValidDic", () => {
  it("accepts the Czech form", () => {
    expect(isValidDic("CZ26296039")).toBe(true);
    expect(isValidDic("cz26296039")).toBe(true);
  });

  it("rejects a missing prefix or a wrong length", () => {
    for (const value of ["26296039", "CZ123", "CZ12345678901", "SK26296039"]) {
      expect(isValidDic(value), value).toBe(false);
    }
  });
});

describe("isValidBankAccount", () => {
  it("accepts both real accounts of the organization", () => {
    expect(isValidBankAccount("6786420257/0100")).toBe(true);
    expect(isValidBankAccount("94-2613370257/0100")).toBe(true);
  });

  it("rejects a single mistyped digit", () => {
    // Prave tohle je ta chyba, ktera se projevi az za tyden jako
    // "platby nedorazily" -- parovani vypisu hlasi neshodu uctu.
    expect(isValidBankAccount("6786420258/0100")).toBe(false);
  });

  it("rejects malformed input", () => {
    for (const value of ["", "6786420257", "/0100", "6786420257/01", "abc/0100"]) {
      expect(isValidBankAccount(value), value).toBe(false);
    }
  });
});

describe("validateCompanyFields", () => {
  const valid = {
    name: "R. Hlavica s.r.o.",
    ico: "26296039",
    dic: "CZ26296039",
    email: "info@hlavica.cz",
    bank_account_czk: "6786420257/0100",
    bank_account_eur: "94-2613370257/0100",
  };

  it("passes the organization's current settings unchanged", () => {
    // Zavedeni validace nesmi zablokovat ulozeni uz ulozenych udaju.
    expect(validateCompanyFields(valid)).toEqual([]);
  });

  it("treats an empty optional field as fine", () => {
    expect(validateCompanyFields({ ...valid, dic: "", bank_account_eur: "" })).toEqual([]);
  });

  it("reports every problem at once, not one at a time", () => {
    const errors = validateCompanyFields({ ...valid, ico: "12345678", bank_account_czk: "1/0100", dic: "XX1" });
    expect(errors.map(error => error.field).sort()).toEqual(["bank_account_czk", "dic", "ico"]);
  });

  it("explains why a wrong account matters", () => {
    const [error] = validateCompanyFields({ ...valid, bank_account_czk: "6786420258/0100" });
    expect(error.message).toContain("párování plateb");
  });

  it("requires the fields invoices and reminders cannot work without", () => {
    const errors = validateCompanyFields({ name: "", ico: "", email: "" });
    expect(errors.map(error => error.field).sort()).toEqual(["email", "ico", "name"]);
  });
});
