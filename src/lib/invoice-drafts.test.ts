import { describe, expect, it } from "vitest";
import { clearInvoiceDraft, readInvoiceDraft, saveInvoiceDraft } from "./invoice-drafts";
import type { InvoiceInput } from "@/types/invoice";

const draft: InvoiceInput = {
  invoice_number: "DRAFT", counterparty_name: "Test", counterparty_email: "test@example.com",
  amount: 121, amount_without_vat: 100, vat_rate: 21, currency: "CZK",
  issue_date: "2026-09-05", due_date: "2026-09-10", source: "manual",
};

describe("tab-local invoice drafts", () => {
  it("keeps separate drafts and clears only the saved or discarded invoice", () => {
    saveInvoiceDraft("new", draft);
    saveInvoiceDraft("edit", { ...draft, invoice_number: "EDIT" });
    expect(readInvoiceDraft("new")).toEqual(draft);
    clearInvoiceDraft("new");
    expect(readInvoiceDraft("new")).toBeUndefined();
    expect(readInvoiceDraft("edit")?.invoice_number).toBe("EDIT");
    clearInvoiceDraft("edit");
  });
  it("copies input and output so edits cannot mutate another draft", () => {
    const input = { ...draft };
    saveInvoiceDraft("copy", input);
    input.invoice_number = "CHANGED";
    const output = readInvoiceDraft("copy")!;
    output.invoice_number = "CHANGED AGAIN";
    expect(readInvoiceDraft("copy")?.invoice_number).toBe("DRAFT");
    clearInvoiceDraft("copy");
  });
});
