import { describe, expect, it } from "vitest";
import { buildSpayd, czechAccountToIban, invoiceSpayd, parseCzechAccount, parseSpayd } from "./czech-payment";

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

describe("parseSpayd (QR platba přečtená z faktury)", () => {
  it("přečte řetězec, který sestaví buildSpayd, zpět beze ztráty", () => {
    const spayd = buildSpayd({ account: "6786420257/0100", amount: 123100.2, currency: "CZK", variableSymbol: "1443260157", dueDate: "2026-09-23", message: "Faktura 1443260157" })!;
    expect(parseSpayd(spayd)).toEqual({
      iban: "CZ3401000000006786420257",
      bic: null,
      account: "6786420257/0100",
      amount: 123100.2,
      currency: "CZK",
      variableSymbol: "1443260157",
      constantSymbol: null,
      specificSymbol: null,
      dueDate: "2026-09-23",
      message: "Faktura 1443260157",
      recipientName: null,
    });
  });

  it("zvládne BIC za IBANem, KS/SS, jméno příjemce a zakódovanou hvězdičku", () => {
    const parsed = parseSpayd("SPD*1.0*ACC:CZ3401000000006786420257+KOMBCZPP*AM:3370.00*CC:czk*X-KS:0308*X-SS:77*RN:ROBERT HLAVICA*MSG:ZALOHA%2A10");
    expect(parsed).toMatchObject({ bic: "KOMBCZPP", amount: 3370, currency: "CZK", constantSymbol: "0308", specificSymbol: "77", recipientName: "ROBERT HLAVICA", message: "ZALOHA*10", variableSymbol: null });
  });

  it("vrátí null, když nejde o QR platbu nebo IBAN nesedí kontrolním součtem", () => {
    expect(parseSpayd("https://example.com")).toBeNull();
    expect(parseSpayd("SPD*1.0*AM:100.00*CC:CZK")).toBeNull();
    expect(parseSpayd("SPD*1.0*ACC:CZ3301000000006786420257*AM:100.00")).toBeNull();
  });

  it("nevymyslí částku, VS ani datum z poškozených hodnot", () => {
    const parsed = parseSpayd("SPD*1.0*ACC:CZ3401000000006786420257*AM:12,50*X-VS:12AB*DT:20261332*CC:KORUNY");
    expect(parsed).toMatchObject({ amount: null, variableSymbol: null, dueDate: null, currency: null });
  });
});

describe("invoiceSpayd", () => {
  // Jediný zdroj QR platby pro PDF faktury i tělo upomínky: kdyby si je
  // každé místo skládalo samo, mohly by dlužníkovi ukázat dvě různé částky.
  const invoice = {
    invoice_number: "FV-2026-001", variable_symbol: "2026001",
    amount: 12100, paid_amount: 2000, currency: "CZK", due_date: "2026-01-19",
  };
  const company = { bank_account_czk: "6786420257/0100", bank_account_eur: "94-2613370257/0100" };

  it("asks for the outstanding amount with the invoice's VS and the account for its currency", () => {
    const parsed = parseSpayd(invoiceSpayd(invoice, company));
    expect(parsed).toMatchObject({
      iban: "CZ3401000000006786420257", amount: 10100, currency: "CZK",
      variableSymbol: "2026001", dueDate: "2026-01-19",
    });
    expect(parseSpayd(invoiceSpayd({ ...invoice, currency: "EUR" }, company))?.iban).toBe("CZ8001000000942613370257");
  });

  it("falls back to the full amount when nothing is outstanding", () => {
    expect(invoiceSpayd({ ...invoice, paid_amount: 12100 }, company)).toContain("AM:12100.00");
  });

  // Zprávu pro příjemce čte účetní na výpisu: z čísla faktury a jména
  // odběratele hned pozná, kdo platil, aniž by fakturu dohledávala.
  it("names the paying customer in the message for the recipient", () => {
    const parsed = parseSpayd(invoiceSpayd({ ...invoice, counterparty_name: "Dvořák s.r.o." }, company));
    expect(parsed?.message).toBe("Faktura FV-2026-001 - Dvorak s.r.o.");
  });

  it("keeps the invoice number whole when a long customer name has to be cut", () => {
    const message = parseSpayd(invoiceSpayd({
      ...invoice,
      counterparty_name: "Stavební společnost Moravskoslezského kraje a okolí, akciová společnost",
    }, company))?.message ?? "";
    expect(message.length).toBeLessThanOrEqual(60);
    expect(message.startsWith("Faktura FV-2026-001 - Stavebni")).toBe(true);
  });

  it("falls back to the invoice number alone without a customer name", () => {
    expect(parseSpayd(invoiceSpayd(invoice, company))?.message).toBe("Faktura FV-2026-001");
    expect(parseSpayd(invoiceSpayd({ ...invoice, counterparty_name: "  " }, company))?.message).toBe("Faktura FV-2026-001");
  });

  it("returns null instead of a QR code that would send money elsewhere", () => {
    expect(invoiceSpayd(invoice, { bank_account_czk: "123456789/0800" })).toBeNull();
    expect(invoiceSpayd(invoice, { bank_account_czk: null })).toBeNull();
    expect(invoiceSpayd({ ...invoice, currency: "EUR" }, { bank_account_czk: "6786420257/0100" })).toBeNull();
  });
});
