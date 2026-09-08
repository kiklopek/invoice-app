import type { InvoiceInput } from "@/types/invoice";

// Tab-local memory only. A reload or sign-out clears all drafts; no invoice
// data is persisted in localStorage or shared with another browser tab.
const drafts = new Map<string, InvoiceInput>();
const MAX_DRAFTS = 20;

export function readInvoiceDraft(key: string) {
  const draft = drafts.get(key);
  return draft ? { ...draft } : undefined;
}

export function saveInvoiceDraft(key: string, draft: InvoiceInput) {
  drafts.delete(key);
  drafts.set(key, { ...draft });
  if (drafts.size > MAX_DRAFTS) drafts.delete(drafts.keys().next().value!);
}

export function clearInvoiceDraft(key: string) {
  drafts.delete(key);
}
