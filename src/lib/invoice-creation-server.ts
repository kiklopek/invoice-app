import "server-only";
import { createHash } from "node:crypto";
import type { RequestIdentity } from "./auth";
import {
  InvoiceCreationError,
  creationDocument,
  creationInput,
  parseCreationDraft,
  type InvoiceSupplier,
  type IssuedInvoiceDocument,
} from "./invoice-creation";

export const CREATION_COMPANY_FIELDS =
  "name, ico, dic, registered_address, email, vat_payer, logo_path, bank_account_czk, bank_account_eur, bank_accounts:organization_bank_accounts(account, currency)";
export const CREATION_CUSTOMER_FIELDS = "id, name, ico, dic, email, address";
export function creationSupplier(row: {
  name: string;
  logo_path?: string | null;
  ico?: string | null;
  dic?: string | null;
  registered_address?: string | null;
  email?: string | null;
  vat_payer?: boolean | null;
  bank_account_czk?: string | null;
  bank_account_eur?: string | null;
  bank_accounts?: { account: string; currency: string }[] | null;
}): InvoiceSupplier {
  return {
    name: row.name,
    logo_path: row.logo_path ?? null,
    ico: row.ico ?? "",
    dic: row.dic ?? "",
    address: row.registered_address ?? "",
    email: row.email ?? "",
    vat_payer: row.vat_payer ?? null,
    bank_account_czk: row.bank_account_czk ?? "",
    bank_account_eur: row.bank_account_eur ?? "",
    bank_accounts: row.bank_accounts ?? [],
  };
}
export function creationRequest(value: unknown) {
  const draft = parseCreationDraft(value);
  return {
    draft,
    hash: createHash("sha256").update(JSON.stringify(draft)).digest("hex"),
  };
}
export async function prepareCreation(
  value: unknown,
  supplier: InvoiceSupplier,
  identity: RequestIdentity,
) {
  const { draft, hash } = creationRequest(value);
  if (draft.customer_id) {
    const { data, error } = await identity.service
      .from("customers")
      .select(CREATION_CUSTOMER_FIELDS)
      .eq("organization_id", identity.membership.organization_id)
      .eq("id", draft.customer_id)
      .maybeSingle();
    if (error)
      throw new InvoiceCreationError("Odběratele se nepodařilo ověřit. Zkuste to znovu.", 503);
    if (!data) throw new InvoiceCreationError("Vybraný zákazník není dostupný v této firmě.");
    draft.customer = {
      name: data.name,
      ico: data.ico ?? "",
      dic: data.dic ?? "",
      address: data.address || draft.customer.address,
      email: draft.customer.email,
    };
  }
  const document = creationDocument(draft, supplier, hash);
  return { input: creationInput(document), document };
}
export function sameCreation(
  document: IssuedInvoiceDocument | null,
  requestId: string,
  requestHash: string,
) {
  return (
    document?.request_id === requestId && document.request_hash === requestHash
  );
}
