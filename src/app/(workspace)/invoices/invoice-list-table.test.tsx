// @vitest-environment jsdom
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Invoice } from "@/types/invoice";
import { InvoiceListTable } from "./invoice-list-table";

vi.mock("next/link", () => ({
  default: ({ children, ...props }: React.AnchorHTMLAttributes<HTMLAnchorElement>) => (
    <a {...props}>{children}</a>
  ),
}));
vi.mock("@/components/toast", () => ({ useToast: () => ({ showToast: vi.fn() }) }));

const invoice = (id: string, overrides: Partial<Invoice>) =>
  ({
    id,
    invoice_number: `FV-${id}`,
    counterparty_name: `Odběratel ${id}`,
    counterparty_email: `${id}@example.invalid`,
    variable_symbol: id,
    amount: 10000,
    paid_amount: 0,
    currency: "CZK",
    issue_date: "2026-10-01",
    due_date: "2026-11-30",
    status: "pending",
    ...overrides,
  }) as Invoice;

let root: Root;
let container: HTMLDivElement;
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

describe("InvoiceListTable compact status", () => {
  it("adds a payment bar to the status of partly paid invoices only", async () => {
    await act(async () =>
      root.render(
        <InvoiceListTable
          invoices={[
            invoice("1", { paid_amount: 2500 }),
            invoice("2", {}),
            invoice("3", { status: "paid", paid_amount: 10000 }),
          ]}
          canManage
          today="2026-11-07"
          onConfirm={() => {}}
          onOpen={() => {}}
          onPrefetch={() => {}}
          sortOrder={{ field: "default", direction: "asc" }}
          onSortChange={() => {}}
          onExportSelected={() => {}}
          exporting={false}
        />,
      ),
    );
    const bars = Array.from(container.querySelectorAll('tbody td [role="img"]'));
    expect(bars).toHaveLength(1);
    expect(bars[0].closest("tr")?.getAttribute("data-invoice-id")).toBe("1");
    // The amounts are spelled out whole (rule 8), not as a bare percentage.
    expect(bars[0].getAttribute("aria-label")).toMatch(/^Uhrazeno 2\s500,00\sKč z 10\s000,00\sKč$/);
    expect((bars[0].firstElementChild as HTMLElement).style.width).toBe("25%");
    // Every row keeps all eight cells so the columns line up.
    for (const row of container.querySelectorAll("tbody tr")) expect(row.children).toHaveLength(8);
  });
});
