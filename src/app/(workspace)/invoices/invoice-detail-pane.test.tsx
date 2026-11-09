// @vitest-environment jsdom
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Invoice } from "@/types/invoice";
import { InvoiceDetailPane } from "./invoice-detail-pane";

vi.mock("next/link", () => ({
  default: ({ children, ...props }: React.AnchorHTMLAttributes<HTMLAnchorElement>) => <a {...props}>{children}</a>,
}));

const invoice = (overrides: Partial<Invoice> = {}) =>
  ({
    id: "inv-1", invoice_number: "FV-2026-0042", counterparty_name: "Odběratel s.r.o.",
    counterparty_email: "o@example.invalid", variable_symbol: "20260042", amount: 12100,
    paid_amount: 2100, currency: "CZK", issue_date: "2026-10-01", due_date: "2026-10-15",
    status: "overdue", reminders_sent: 2, next_reminder_at: "2026-11-10T08:00:00Z", reminders_paused: false,
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
const render = (props: Partial<React.ComponentProps<typeof InvoiceDetailPane>>) =>
  act(async () =>
    root.render(<InvoiceDetailPane invoice={invoice()} canManage today="2026-11-07" onConfirm={() => {}} {...props} />),
  );
const buttons = () => Array.from(container.querySelectorAll("button"), (b) => b.textContent?.trim());

describe("invoice detail pane", () => {
  it("offers only the existing payment confirmation, which opens its dialog", async () => {
    const onConfirm = vi.fn();
    await render({ onConfirm });
    expect(buttons()).toEqual(["Potvrdit úhradu"]);
    // No way to send a reminder e-mail from the list.
    expect(container.textContent).not.toMatch(/Poslat upomínku|Odeslat/);
    await act(async () => container.querySelector("button")!.click());
    expect(onConfirm).toHaveBeenCalledWith(expect.objectContaining({ id: "inv-1" }));
    expect(container.querySelector('a[href="/invoices/inv-1"]')?.textContent).toBe("Otevřít detail");
  });
  it("hides the confirmation for closed invoices and for read-only roles", async () => {
    await render({ invoice: invoice({ status: "paid", paid_amount: 12100 }) });
    expect(buttons()).toEqual([]);
    await render({ canManage: false });
    expect(buttons()).toEqual([]);
  });
  it("spells out the amounts whole and the remaining balance", async () => {
    await render({});
    const text = container.textContent!.replace(/\s/g, " ");
    expect(text).toContain("12 100,00 Kč");
    expect(text).toContain("Uhrazeno 2 100,00 Kč · zbývá 10 000,00 Kč");
    expect(text).toContain("2 upomínky");
    expect(text).toContain("Další 10. 11.");
  });
});
