// @vitest-environment jsdom
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { PaymentsPageData, PaymentsPagePayment } from "@/lib/payments-page-data";

const mocks = vi.hoisted(() => ({ fetch: vi.fn(), confirm: vi.fn() }));
vi.mock("@/lib/api-client", () => ({ apiFetch: mocks.fetch, ApiRequestError: class extends Error {} }));
vi.mock("@/lib/confirm-action", () => ({ confirmAction: mocks.confirm }));
vi.mock("next/link", () => ({ default: ({ children, ...props }: React.AnchorHTMLAttributes<HTMLAnchorElement>) => <a {...props}>{children}</a> }));
vi.mock("@/components/layout/app-shell", () => ({ AppFrame: ({ children }: { children: React.ReactNode }) => <div>{children}</div> }));
vi.mock("./statement-archive", () => ({ StatementArchive: () => null }));
vi.mock("./payment-assistance-panel", () => ({ PaymentAssistancePanel: () => null }));
import { PaymentsArchiveClient } from "./payments-archive-client";

const openInvoice = { id: "inv-1", invoice_number: "2026-001", counterparty_name: "ACME s.r.o.", amount: 1000, paid_amount: 0, currency: "CZK", variable_symbol: "2026001" };
const matched: PaymentsPagePayment = {
  // Bez VS: předvýběr nesmí přijít z návrhu podle VS, ale z uvolněné vazby.
  id: "pay-1", external_id: "EXT-1", booked_on: "2026-10-20", amount: 1000, currency: "CZK", variable_symbol: null,
  counterparty_name: "ACME s.r.o.", match_status: "matched", source: "bank_import", invoice_id: "inv-1",
  invoices: { invoice_number: "2026-001", counterparty_name: "ACME s.r.o." },
  allocations: [{ invoice_id: "inv-1", amount: 1000, invoice_number: "2026-001", counterparty_name: "ACME s.r.o." }],
};
const released: PaymentsPagePayment = { ...matched, match_status: "unmatched", invoice_id: null, invoices: null, allocations: [] };

let host: HTMLDivElement, root: Root;
beforeEach(async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  mocks.fetch.mockReset(); mocks.confirm.mockReset().mockResolvedValue(true);
  let current: { payments: PaymentsPagePayment[]; open_invoices: typeof openInvoice[]; can_manage: boolean } = { payments: [matched], open_invoices: [], can_manage: true };
  mocks.fetch.mockImplementation(async (url: string, options?: { method?: string }) => {
    if (options?.method === "DELETE") { current = { payments: [released], open_invoices: [openInvoice], can_manage: true }; return { remaining: 1000 }; }
    return current;
  });
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
  await act(async () => root.render(<PaymentsArchiveClient initialData={current as unknown as PaymentsPageData} />));
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); vi.unstubAllGlobals(); });

describe("payments archive release", () => {
  it("offers the original invoice right after the payment is released", async () => {
    const release = [...host.querySelectorAll<HTMLButtonElement>("button")].find(button => button.textContent?.includes("Uvolnit přiřazení"))!;
    await act(async () => release.click());
    const select = host.querySelector<HTMLSelectElement>('select[aria-label="Vybrat fakturu pro platbu EXT-1"]')!;
    expect(select).not.toBeNull();
    expect(select.value).toBe("inv-1");
    expect(host.textContent).toContain("Původní faktura je znovu předvybraná");
    // Nic se samo nepřiřadilo: jen předvýběr, přiřazení až tlačítkem.
    expect(mocks.fetch.mock.calls.filter(([, options]) => options?.method === "PATCH")).toHaveLength(0);
  });
});
