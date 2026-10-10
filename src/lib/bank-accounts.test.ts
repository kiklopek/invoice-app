import { describe, expect, it } from "vitest";
import {
  canonicalAccount,
  isValidPaymentAccount,
  matchOrganizationAccount,
  organizationAccounts,
  paymentAccountFor,
} from "./bank-accounts";
import { buildSpayd, czechAccountToIban, invoiceSpayd } from "./czech-payment";
import { renderReminderEmail } from "./reminder-email-template";

const hlavica = { bank_account_czk: "6786420257/0100", bank_account_eur: "94-2613370257/0100" };
const extra = [
  { account: "6844160247/0100", currency: "CZK" },
  { account: "SK3112000000198742637541", currency: "EUR" },
  { account: "PL61109010140000071219812874", currency: "PLN" },
];

describe("canonicalAccount", () => {
  it("normalizes Czech accounts and IBANs to one comparable form", () => {
    expect(canonicalAccount("6786420257/0100")).toBe(canonicalAccount("000000-6786420257/0100"));
    expect(canonicalAccount("6786420257/0100")).toBe(canonicalAccount(czechAccountToIban("6786420257/0100")));
    expect(canonicalAccount("sk31 1200 0000 1987 4263 7541")).toBe("SK3112000000198742637541");
  });

  // Dřív se porovnávala jen čísla bez kódu banky: stejné číslo v jiné bance
  // se považovalo za firemní účet.
  it("keeps the bank code, so the same number at another bank is another account", () => {
    expect(canonicalAccount("6786420257/0100")).not.toBe(canonicalAccount("6786420257/0800"));
  });

  it("refuses anything that is not a verifiable account", () => {
    expect(canonicalAccount("1234567890/0100")).toBeNull(); // mod-11
    expect(canonicalAccount("SK3112000000198742637542")).toBeNull(); // mod-97
    expect(canonicalAccount("6786420257")).toBeNull(); // bez kódu banky
    expect(canonicalAccount("")).toBeNull();
  });
});

describe("isValidPaymentAccount", () => {
  it("accepts a Czech account or any valid IBAN (Slovak, Wise, …)", () => {
    expect(isValidPaymentAccount("6786420257/0100")).toBe(true);
    expect(isValidPaymentAccount("SK3112000000198742637541")).toBe(true);
    expect(isValidPaymentAccount("1234567890/0100")).toBe(false);
  });
});

describe("statement accounts", () => {
  const accounts = organizationAccounts(hlavica, extra);

  it("recognizes every registered account of the company, with its currency", () => {
    expect(matchOrganizationAccount("6786420257/0100", accounts)?.currency).toBe("CZK");
    // Druhý účet R. Hlavica: dřív hlásil „neshodu účtu“ u každého výpisu.
    expect(matchOrganizationAccount("6844160247/0100", accounts)?.currency).toBe("CZK");
    expect(matchOrganizationAccount("94-2613370257/0100", accounts)?.currency).toBe("EUR");
  });

  it("does not take a foreign account for the company's own", () => {
    expect(matchOrganizationAccount("6786420257/0800", accounts)).toBeNull();
    expect(matchOrganizationAccount("19-2000145399/0800", accounts)).toBeNull();
    expect(matchOrganizationAccount(null, accounts)).toBeNull();
  });
});

describe("paymentAccountFor (faktura, QR, upomínka)", () => {
  it("uses the primary account for CZK and EUR", () => {
    expect(paymentAccountFor("CZK", hlavica, extra)).toBe("6786420257/0100");
    expect(paymentAccountFor("EUR", hlavica, extra)).toBe("94-2613370257/0100");
  });

  it("uses a registered account in that currency for any other currency", () => {
    expect(paymentAccountFor("PLN", hlavica, extra)).toBe("PL61109010140000071219812874");
  });

  // Dřív dostala faktura v jiné měně korunový účet -- platba by skončila
  // na špatném účtu nebo by ji banka přepočítala.
  it("never falls back to the CZK account for another currency", () => {
    expect(paymentAccountFor("USD", hlavica, extra)).toBeNull();
    expect(paymentAccountFor("EUR", { bank_account_czk: "6786420257/0100", bank_account_eur: null }, [])).toBeNull();
  });

  it("falls back to an extra EUR account when the primary EUR field is empty", () => {
    expect(paymentAccountFor("EUR", { bank_account_czk: "6786420257/0100", bank_account_eur: null }, extra)).toBe("SK3112000000198742637541");
  });
});

describe("QR platba se zahraničním IBAN", () => {
  it("builds SPAYD for a valid foreign IBAN instead of dropping the QR code", () => {
    expect(buildSpayd({ account: "SK3112000000198742637541", amount: 100, currency: "EUR" })).toContain("ACC:SK3112000000198742637541");
    expect(buildSpayd({ account: "SK3112000000198742637542", amount: 100, currency: "EUR" })).toBeNull();
  });
});

describe("invoiceSpayd a upomínka používají účet v měně faktury", () => {
  const base = { invoice_number: "FV-1", amount: 100, paid_amount: 0, due_date: "2026-10-20", variable_symbol: "1" };

  it("does not put the CZK account into a QR code for a PLN or USD invoice", () => {
    expect(invoiceSpayd({ ...base, currency: "USD" }, hlavica)).toBeNull();
    expect(invoiceSpayd({ ...base, currency: "PLN" }, { ...hlavica, bank_accounts: extra })).toContain("ACC:PL61109010140000071219812874");
  });

  it("shows no CZK account in a reminder for an invoice in another currency", () => {
    const email = renderReminderEmail({
      stage: "overdue",
      subject: "Upomínka",
      message: "Dobrý den",
      company: { name: "Firma s.r.o.", ...hlavica },
      values: { invoice_number: "FV-1", amount: "100,00", currency: "USD", due_date: "20. 10. 2026", counterparty_name: "Odběratel", variable_symbol: "1" },
    });
    expect(email.html).not.toContain("6786420257/0100");
  });
});
