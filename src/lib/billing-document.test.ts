import { describe, expect, it } from "vitest";
import { billingDocument } from "./billing-document";
import type { Supplier } from "./billing";

const supplier: Supplier = { name: "Splatno s.r.o.", ico: "27082440", dic: "CZ27082440", address: "Ulice 1", account: "19-2000145399/0800", iban: "CZ6508000000192000145399", vatPayer: true, email: null };
const order = {
  order_number: "SP-2026-000001", variable_symbol: "2600000001", plan: "profi", period: "monthly", months: 1,
  net_halere: 159000, vat_halere: 33390, gross_halere: 192390, status: "pending", invoice_number: null,
  created_at: "2026-10-07T10:00:00Z", paid_at: null, billing: { name: "Firma", ico: "27082440" },
};

describe("doklad za předplatné", () => {
  it("asks for payment with a QR code carrying the exact amount and variable symbol", () => {
    const document = billingDocument(order, supplier);
    expect(document.title).toBe("Výzva k platbě (objednávka SP-2026-000001)");
    expect(document.spayd).toBe("SPD*1.0*ACC:CZ6508000000192000145399*AM:1923.90*CC:CZK*X-VS:2600000001*DT:20261014*MSG:Splatno SP-2026-000001");
    expect(document.item).toBe("Splatno – tarif Profi, 1 měsíc");
  });

  it("becomes a tax document once paid, without a QR code", () => {
    const document = billingDocument({ ...order, status: "paid", invoice_number: "SPF2026000001", paid_at: "2026-10-08T09:00:00Z" }, supplier);
    expect(document.title).toBe("Faktura – daňový doklad č. SPF2026000001");
    expect(document.spayd).toBeNull();
    expect(document.taxableDate).toBe("2026-10-08");
  });
});
