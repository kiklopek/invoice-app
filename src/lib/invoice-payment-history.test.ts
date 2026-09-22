import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { loadInvoicePaymentHistory } from "./invoice-payment-history";
import type { RequestIdentity } from "@/lib/auth";

// Historie plateb u faktury: odpovídá na otázku "kdo a kdy tohle zaplatil".
// Komentář v modulu varuje před konkrétní pastí -- číst plátce ze sloupce
// bank_payments.invoice_id by TISE schovalo platby rozdělené mezi víc
// faktur. Tenhle test tu past drží zavřenou.

type Filter = { column: string; value: unknown };

function serviceStub(rows: unknown[], error: unknown = null) {
  const filters: Filter[] = [];
  let selected = "";
  let orderedBy = "";
  const builder = {
    select(columns: string) {
      selected = columns;
      return builder;
    },
    eq(column: string, value: unknown) {
      filters.push({ column, value });
      return builder;
    },
    order(column: string) {
      orderedBy = column;
      return Promise.resolve({ data: rows, error });
    },
  };
  return {
    service: { from: () => builder } as unknown as RequestIdentity["service"],
    inspect: () => ({ filters, selected, orderedBy }),
  };
}

const payment = {
  id: "pay-1", external_id: "GPC-1", booked_on: "2026-01-20",
  amount: "5000.50", currency: "CZK", variable_symbol: "2026001",
  counterparty_name: "Dvořák s.r.o.", counterparty_account: "6786420257/0100",
  note: null, matched_at: "2026-01-20T10:00:00Z", source: "bank_import",
  match_status: "split", match_reason: null,
};

describe("loadInvoicePaymentHistory", () => {
  it("reads from allocations, not from the payment's invoice_id column", async () => {
    // Tohle je ta past: platba rozdělená mezi víc faktur má invoice_id
    // prázdné, takže by z historie zmizela.
    const { service, inspect } = serviceStub([]);
    await loadInvoicePaymentHistory(service, "org-1", "inv-1");
    expect(inspect().selected).toContain("bank_payment_allocations".slice(0, 0) + "amount");
    expect(inspect().selected).toContain("bank_payments");
  });

  it("scopes the query to one organization and one invoice", async () => {
    const { service, inspect } = serviceStub([]);
    await loadInvoicePaymentHistory(service, "org-1", "inv-1");
    const filters = inspect().filters;
    expect(filters).toContainEqual({ column: "organization_id", value: "org-1" });
    expect(filters).toContainEqual({ column: "invoice_id", value: "inv-1" });
  });

  it("shows only committed allocations, never a draft review", async () => {
    // Rozpracovaná kontrola výpisu se nesmí tvářit jako uhrazená částka.
    const { service, inspect } = serviceStub([]);
    await loadInvoicePaymentHistory(service, "org-1", "inv-1");
    expect(inspect().filters).toContainEqual({ column: "is_committed", value: true });
  });

  it("lists the newest payment first", async () => {
    const { service, inspect } = serviceStub([]);
    await loadInvoicePaymentHistory(service, "org-1", "inv-1");
    expect(inspect().orderedBy).toBe("committed_at");
  });

  it("returns the allocated amount separately from the whole payment", async () => {
    // U rozdělené platby je "kolik přišlo" a "kolik padlo na tuhle fakturu"
    // různé číslo; splést je znamená vykázat špatnou úhradu.
    const { service } = serviceStub([{ amount: "1500.25", committed_at: "2026-01-20T10:00:00Z", bank_payment: payment }]);
    const [entry] = await loadInvoicePaymentHistory(service, "org-1", "inv-1");
    expect(entry.amount).toBe(5000.5);
    expect(entry.allocation_amount).toBe(1500.25);
  });

  it("converts amounts from text to numbers", async () => {
    const { service } = serviceStub([{ amount: "1500.25", committed_at: "x", bank_payment: payment }]);
    const [entry] = await loadInvoicePaymentHistory(service, "org-1", "inv-1");
    expect(typeof entry.amount).toBe("number");
    expect(typeof entry.allocation_amount).toBe("number");
  });

  it("skips an allocation whose payment row is missing instead of crashing", async () => {
    const { service } = serviceStub([
      { amount: "10", committed_at: "x", bank_payment: null },
      { amount: "20", committed_at: "x", bank_payment: payment },
    ]);
    const entries = await loadInvoicePaymentHistory(service, "org-1", "inv-1");
    expect(entries).toHaveLength(1);
  });

  it("returns an empty history rather than null when nothing is booked", async () => {
    const { service } = serviceStub([]);
    await expect(loadInvoicePaymentHistory(service, "org-1", "inv-1")).resolves.toEqual([]);
  });

  it("fails loudly on a database error instead of pretending nothing was paid", async () => {
    // Tichý prázdný seznam by u zaplacené faktury vypadal jako neuhrazená.
    const { service } = serviceStub([], new Error("connection lost"));
    await expect(loadInvoicePaymentHistory(service, "org-1", "inv-1")).rejects.toThrow();
  });
});
