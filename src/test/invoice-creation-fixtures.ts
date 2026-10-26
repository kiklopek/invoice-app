import { emptyCreation, type InvoiceSupplier } from "@/lib/invoice-creation";

export const supplier: InvoiceSupplier = {
  name: "Dodavatel s.r.o.",
  ico: "12345678",
  dic: "CZ12345678",
  address: "Praha 1, Hlavní 10",
  email: "firma@dodavatel.example",
  vat_payer: true,
  bank_account_czk: "6844160247/0100",
  bank_account_eur: "",
  bank_accounts: [],
};
export const fixture = () => {
  const draft = emptyCreation(
    supplier,
    "2026-10-25",
    "550e8400-e29b-41d4-a716-446655440000",
    "FV-2026-000027",
  );
  draft.customer = {
    name: "Odběratel s.r.o.",
    ico: "87654321",
    dic: "CZ87654321",
    address: "Brno, Dolní 2",
    email: "klient@odberatel.example",
  };
  draft.items[0] = {
    ...draft.items[0],
    description: "Poradenství",
    unit_price: "50000",
  };
  return draft;
};
