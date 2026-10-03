// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ fetch:vi.fn(),confirm:vi.fn() }));
vi.mock("@/lib/api-client",() => ({ apiFetch:mocks.fetch }));
vi.mock("@/lib/confirm-action",() => ({ confirmAction:mocks.confirm }));
import { PaymentAssistancePanel } from "./payment-assistance-panel";
const base = { flags:{ mode:"review" as const,memory:true,reevaluation:true,camt:false },proposals:[],memories:[],sources:[],payments:[],job:null,metrics:{ confirmed:0,rejected:0 } };
const proposal = { id:"proposal",proposal:{ kind:"unique",payment_ids:["p1","p2"],invoice_ids:["i"],currency:"CZK",reason:"Splátky",allocations:[{ payment_id:"p1",invoice_id:"i",amount:40 },{ payment_id:"p2",invoice_id:"i",amount:60 }],snapshot:{ payments:[{ id:"p1",booked_on:"2026-10-01",counterparty_name:"Customer",amount:40,allocated_amount:0,currency:"CZK" },{ id:"p2",booked_on:"2026-10-02",counterparty_name:"Customer",amount:60,allocated_amount:0,currency:"CZK" }],invoices:[{ id:"i",invoice_number:"1001" }] } } };
let host: HTMLDivElement,root: Root;
const refreshed = vi.fn(async () => undefined);
const click = async (label: string) => {
  const button = [...host.querySelectorAll("button")].find(b => b.textContent===label)!;
  expect(button).toBeDefined();
  await act(async () => { button.click(); });
};
describe("assistance review UI", () => {
  beforeEach(() => { vi.resetAllMocks(); (globalThis as Record<string,unknown>).IS_REACT_ACT_ENVIRONMENT=true; host=document.createElement("div"); document.body.append(host); root=createRoot(host); mocks.fetch.mockResolvedValue(base); });
  afterEach(async () => { await act(async () => root.unmount()); host.remove(); });
  it("requires a concrete confirmation and refreshes the old ledger after accepting", async () => {
    mocks.fetch.mockResolvedValue({ ...base,proposals:[proposal] }); mocks.confirm.mockResolvedValue(true);
    await act(async () => root.render(<PaymentAssistancePanel flags={base.flags} payments={[]} onConfirmed={refreshed} />));
    await click("Potvrdit přiřazení");
    expect(mocks.confirm.mock.calls[0][0].description).toContain("2 plateb → 1 faktur");
    expect(mocks.fetch.mock.calls.some(([,options]) => options?.body===JSON.stringify({ action:"decide",proposal_id:"proposal",accept:true }))).toBe(true);
    expect(refreshed).toHaveBeenCalledOnce();
  });
  it("cancellation never writes an allocation", async () => {
    mocks.fetch.mockResolvedValue({ ...base,proposals:[proposal] }); mocks.confirm.mockResolvedValue(false);
    await act(async () => root.render(<PaymentAssistancePanel flags={base.flags} payments={[]} onConfirmed={refreshed} />));
    await click("Potvrdit přiřazení");
    expect(mocks.fetch.mock.calls.some(([,options]) => options?.method==="POST")).toBe(false);
  });
  it("does not provide a confirm action for ambiguous proposals", async () => {
    mocks.fetch.mockResolvedValue({ ...base,proposals:[{ ...proposal,proposal:{ ...proposal.proposal,kind:"ambiguous" } }] });
    await act(async () => root.render(<PaymentAssistancePanel flags={base.flags} payments={[]} onConfirmed={refreshed} />));
    expect([...host.querySelectorAll("button")].some(b => b.textContent==="Potvrdit přiřazení")).toBe(false);
  });
  it("shows a failed request while leaving the old ledger usable", async () => {
    mocks.fetch.mockRejectedValue(new Error("Návrhy nejsou dostupné."));
    await act(async () => root.render(<PaymentAssistancePanel flags={base.flags} payments={[]} onConfirmed={refreshed} />));
    expect(host.querySelector('[role="alert"]')?.textContent).toContain("Návrhy nejsou dostupné");
    expect(refreshed).not.toHaveBeenCalled();
  });
});
