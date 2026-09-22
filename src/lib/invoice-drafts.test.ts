import { afterEach, beforeEach, describe, expect, it } from "vitest";
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

describe("draft persistence", () => {
  // Drive to byla Map v pameti modulu: reload, navigace i vyprsena session
  // smazaly celou rozepsanou fakturu. sessionStorage to prezije.
  //
  // Projekt nema DOM prostredi pro testy, takze se sessionStorage nahrazuje
  // minimalnim stubem misto zavadeni jsdom kvuli jednomu souboru.
  const KEY = "splatno:invoice-drafts";
  let store: Map<string, string>;

  beforeEach(() => {
    store = new Map();
    (globalThis as { window?: unknown }).window = {
      sessionStorage: {
        getItem: (key: string) => store.get(key) ?? null,
        setItem: (key: string, value: string) => void store.set(key, value),
        removeItem: (key: string) => void store.delete(key),
      },
    };
  });

  afterEach(() => {
    delete (globalThis as { window?: unknown }).window;
  });

  it("survives a reload by storing the draft outside module memory", () => {
    saveInvoiceDraft("a", draft);
    // Data skutecne lezi v ulozisti, ne v promenne modulu.
    expect(store.get(KEY)).toContain("DRAFT");
    expect(readInvoiceDraft("a")).toMatchObject({ invoice_number: "DRAFT" });
  });

  it("discards drafts written by an older schema instead of loading them", () => {
    store.set(KEY, JSON.stringify({ version: 0, drafts: { a: { invoice_number: "STARÉ" } }, order: ["a"] }));
    expect(readInvoiceDraft("a")).toBeUndefined();
  });

  it("ignores corrupted storage rather than throwing into the form", () => {
    store.set(KEY, "{tohle není JSON");
    expect(readInvoiceDraft("a")).toBeUndefined();
    saveInvoiceDraft("a", draft);
    expect(readInvoiceDraft("a")).toMatchObject({ invoice_number: "DRAFT" });
  });

  it("keeps working when storage is unavailable, just without persistence", () => {
    // Privatni rezim nebo zablokovane uloziste: pristup rovnou vyhodi.
    (globalThis as { window?: unknown }).window = {
      get sessionStorage() { throw new Error("blocked"); },
    };
    expect(() => saveInvoiceDraft("a", draft)).not.toThrow();
    expect(readInvoiceDraft("a")).toMatchObject({ invoice_number: "DRAFT" });
  });

  it("evicts the oldest draft once the cap is reached", () => {
    for (let index = 0; index < 21; index += 1) saveInvoiceDraft(`k${index}`, draft);
    expect(readInvoiceDraft("k0")).toBeUndefined();
    expect(readInvoiceDraft("k20")).toBeDefined();
  });
});
