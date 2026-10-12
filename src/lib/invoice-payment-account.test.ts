import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { organizationAccounts } from "./bank-accounts";
import { czechAccountToIban } from "./czech-payment";
import { accountsInText, checkDocumentPaymentAccount } from "./invoice-payment-account";

const company = organizationAccounts(
  { bank_account_czk: "6786420257/0100", bank_account_eur: "94-2613370257/0100" },
  [{ account: "6844160247/0100", currency: "CZK" }, { account: "SK3112000000198742637541", currency: "EUR" }],
);

// Čtení faktury z PDF: účet na dokladu se porovná se VŠEMI účty firmy.
describe("účty v textu faktury", () => {
  it("najde český účet u slov účet / bankovní spojení a IBAN", () => {
    const text = [
      "Dodavatel: ACME s.r.o.",
      "Bankovní spojení: Komerční banka",
      "Číslo účtu: 6844160247/0100",
      "IBAN: SK31 1200 0000 1987 4263 7541",
    ].join("\n");
    expect(accountsInText(text)).toEqual(["6844160247/0100", "SK3112000000198742637541"]);
  });

  it("účet s předčíslím", () => {
    expect(accountsInText("Účet: 94-2613370257/0100")).toEqual(["94-2613370257/0100"]);
  });

  it("zahodí číslo, které neprojde mod-11 (špatně přečtené nebo přesmyčka)", () => {
    expect(accountsInText("Číslo účtu: 6786420258/0100")).toEqual([]);
  });

  it("neplete si datum nebo číslo dokladu s účtem (bez slova účet poblíž)", () => {
    expect(accountsInText("Datum vystavení 03/2026\nFaktura 2026/0100\nObjednávka 6786420257/0100")).toEqual([]);
  });
});

describe("porovnání s účty firmy", () => {
  const check = (found: { qr?: string[]; isdoc?: string[]; text?: string[] }, currency = "CZK") =>
    checkDocumentPaymentAccount({ qr: found.qr ?? [], isdoc: found.isdoc ?? [], text: found.text ?? [] }, company, currency);

  it("shoda s dalším účtem firmy nastaví účet faktury", () => {
    expect(check({ text: ["6844160247/0100"] })).toEqual({ paymentAccount: "6844160247/0100", warnings: [] });
  });

  it("shoda i když je na faktuře účet jako IBAN", () => {
    expect(check({ qr: [czechAccountToIban("6786420257/0100")!] }).paymentAccount).toBe("6786420257/0100");
  });

  it("přesné zdroje (QR, ISDOC) mají přednost před textem", () => {
    expect(check({ qr: [czechAccountToIban("6844160247/0100")!], text: ["6786420257/0100"] }).paymentAccount).toBe("6844160247/0100");
  });

  it("účet firmy v jiné měně než faktura: nic nenastaví a varuje", () => {
    const result = check({ text: ["SK3112000000198742637541"] }, "CZK");
    expect(result.paymentAccount).toBeNull();
    expect(result.warnings).toEqual(["Účet na faktuře SK3112000000198742637541 je u vás vedený v EUR, ale faktura je v CZK. Platba půjde na výchozí účet pro CZK."]);
  });

  it("cizí účet: nic nenastaví a varuje", () => {
    const result = check({ text: ["19-2000145399/0800"] });
    expect(result.paymentAccount).toBeNull();
    expect(result.warnings).toEqual(["Účet na faktuře 19-2000145399/0800 není mezi vašimi bankovními účty (Nastavení → Bankovní účty). Platba půjde na výchozí účet pro CZK."]);
  });

  it("dva různé účty firmy jen v textu: nerozhodne potichu", () => {
    const result = check({ text: ["6786420257/0100", "6844160247/0100"] });
    expect(result.paymentAccount).toBeNull();
    expect(result.warnings[0]).toMatch(/více vašich účtů/);
  });

  it("bez účtu na faktuře nic", () => {
    expect(check({})).toEqual({ paymentAccount: null, warnings: [] });
  });
});

describe("zapojení", () => {
  const source = (path: string) => readFileSync(join(process.cwd(), path), "utf8");

  it("čtení z PDF porovná účet se všemi účty firmy a výsledek nese do faktury", () => {
    const route = source("src/app/api/invoices/extract/route.ts");
    expect(route).toContain("bank_accounts:organization_bank_accounts(account, currency)");
    expect(route).toContain("checkDocumentPaymentAccount(");
    expect(route).toContain("payment_account:");
  });

  it("nová faktura uloží jen účet firmy v měně faktury", () => {
    const route = source("src/app/api/invoices/route.ts");
    expect(route).toContain("ownInvoiceAccount(body?.payment_account, input.currency");
  });
});
