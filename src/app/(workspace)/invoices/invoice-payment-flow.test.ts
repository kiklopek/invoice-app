// @vitest-environment jsdom
import { act, createElement, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { Invoice } from "@/types/invoice";
import type { InvoiceListPageData } from "@/lib/invoice-list-page-data";
import { parseInvoiceListQuery } from "@/lib/invoice-list-query";
import { InvoicesClient } from "./invoices-client";

const mocks = vi.hoisted(() => ({ assign: vi.fn(), invalidate: vi.fn(), showToast: vi.fn() }));
vi.mock("next/link", () => ({ default: ({ children, ...props }: { children: ReactNode }) => createElement("a", props, children) }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), prefetch: vi.fn() }) }));
vi.mock("swr", () => ({ default: (_key: string, options: { fallbackData: unknown }) => ({ data: options.fallbackData, isLoading: false }) }));
vi.mock("@/components/layout/app-shell", () => ({ AppFrame: ({ children, invoiceCount }: { children: ReactNode; invoiceCount: number }) => createElement("div", null, createElement("output", { "data-active-count": true }, invoiceCount), children) }));
vi.mock("@/components/icons", () => ({ Icon: () => null }));
vi.mock("@/components/modal", () => ({ Modal: ({ open, children }: { open: boolean; children: ReactNode }) => open ? createElement("div", { role: "dialog" }, children) : null }));
vi.mock("@/components/optional-payment-assignment", () => ({ OptionalPaymentAssignment: ({ onSelectPayment }: { onSelectPayment: (id: string) => void }) => createElement("button", { onClick: () => onSelectPayment("bank-payment") }, "Vybrat bankovní platbu") }));
vi.mock("@/lib/assignable-bank-payment", () => ({ assignBankPaymentToInvoice: mocks.assign }));
vi.mock("@/lib/reminders", () => ({ todayInTimeZone: () => "2026-10-05" }));
vi.mock("@/lib/workspace-cache", () => ({ useInvalidateWorkspaceData: () => mocks.invalidate }));
vi.mock("@/components/toast", () => ({ useToast: () => ({ showToast: mocks.showToast }) }));

beforeAll(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
});
let root: Root;
let container: HTMLDivElement;
beforeEach(() => {
  vi.clearAllMocks();
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
});
async function click(label: string) {
  const button = [...container.querySelectorAll("button")].find(button => button.textContent?.trim() === label);
  expect(button).toBeDefined();
  await act(async () => button!.dispatchEvent(new MouseEvent("click", { bubbles: true })));
}
async function assignPayment() {
  const invoice = {
    id: "invoice", invoice_number: "FV-2026-1", counterparty_name: "Zákazník", counterparty_email: "test@example.cz",
    amount: 1000, paid_amount: 0, currency: "CZK", status: "pending", issue_date: "2026-10-01", due_date: "2026-10-15", reminders_sent: 0,
  } as Invoice;
  const data = { invoices: [invoice], total: 1, total_pages: 1, active_count: 1, can_manage: true, currencies: ["CZK"] } as InvoiceListPageData;
  await act(async () => root.render(createElement(InvoicesClient, {
    initialData: data, initialQuery: parseInvoiceListQuery(new URLSearchParams("status=pending"))!, initialKey: "/api/invoices?paged=1&page=1&status=pending",
  })));
  await click("Potvrdit úhradu");
  await click("Vybrat bankovní platbu");
  await click("Přiřadit a potvrdit");
}

describe("přiřazení bankovní platby ze seznamu faktur", () => {
  it("částečná úhrada ponechá fakturu otevřenou a nezmenší počet aktivních faktur", async () => {
    mocks.assign.mockResolvedValue({ settlement: "partial", invoice_status: "pending", paid_amount: 400, remaining: 600 });
    await assignPayment();
    expect(mocks.assign).toHaveBeenCalledWith("bank-payment", "invoice");
    expect(container.querySelector("[role=dialog]")).toBeNull();
    expect(container.querySelector(".invoice-row")?.textContent).toContain("FV-2026-1");
    expect(container.querySelector(".invoice-row")?.textContent).toContain("Částečně uhrazeno");
    expect(container.querySelector("[data-active-count]")?.textContent).toBe("1");
    expect(container.textContent).toContain("Faktura zůstává otevřená.");
    expect(mocks.invalidate).toHaveBeenCalledOnce();
    expect(mocks.showToast).not.toHaveBeenCalled();
  });

  it("plná úhrada odstraní fakturu z otevřeného přehledu", async () => {
    mocks.assign.mockResolvedValue({ settlement: "full", invoice_status: "paid", paid_amount: 1000, remaining: 0 });
    await assignPayment();
    expect(container.querySelector(".invoice-row")).toBeNull();
    expect(container.querySelector("[data-active-count]")?.textContent).toBe("0");
    expect(mocks.showToast).not.toHaveBeenCalled();
  });
});
