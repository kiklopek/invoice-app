import { describe, expect, it } from "vitest";
import { buildAssistanceProposals, type AssistanceInvoice, type AssistancePayment } from "./payment-assistance";
const invoice = (id: string, amount: number): AssistanceInvoice => ({ id, organization_id: "org", counterparty_ico: "123", counterparty_name: "Customer", invoice_number: id, variable_symbol: id, amount, paid_amount: 0, currency: "CZK", issue_date: "2026-01-01", status: "pending" });
const payment = (id: string, amount: number, vs?: string): AssistancePayment => ({ id, organization_id: "org", amount, allocated_amount: 0, currency: "CZK", booked_on: "2026-02-01", counterparty_account: "123/0100", counterparty_name: "Customer", variable_symbol: vs ?? null, note: null, eligible: true, account_verified: true });
const memory = [{ id: "m", organization_id: "org", counterparty_ico: "123", account: "123/0100", payer_name: null, reference: null, active: true, revision: 1 }];
describe("isolated payment assistance", () => {
  it("finds two instalments for one invoice", () => {
    const result = buildAssistanceProposals([payment("p1", 40, "1001"), payment("p2", 60, "1001")], [invoice("1001", 100)], []);
    expect(result.some(p => p.kind === "unique" && p.allocations.length === 2)).toBe(true);
  });
  it("finds one payment for several invoices", () => {
    const result = buildAssistanceProposals([payment("p1", 100)], [invoice("1001", 40), invoice("1002", 60)], memory);
    expect(result[0].kind).toBe("unique");
    expect(result[0].allocations.map(a => a.amount)).toEqual([40, 60]);
  });
  it("does not confuse a unique sum with a unique allocation matrix", () => {
    const result = buildAssistanceProposals([payment("p1", 40), payment("p2", 60)], [invoice("1001", 50), invoice("1002", 50)], memory);
    expect(result.some(p => p.kind === "ambiguous")).toBe(true);
    expect(result.some(p => p.kind === "unique")).toBe(false);
  });
  it("supports many-to-many when explicit references constrain the allocation", () => {
    const result = buildAssistanceProposals([payment("p1", 40, "1001"), payment("p2", 60, "1001"), payment("p3", 50, "1002")], [invoice("1001", 100), invoice("1002", 50)], []);
    expect(result.some(p => p.kind === "unique")).toBe(true);
  });
  it("does not learn identity from names or old account history", () => {
    expect(buildAssistanceProposals([payment("p", 100)], [invoice("1001", 100)], [])[0].kind).toBe("waiting");
  });
  it("rejects shared accounts, conflicting identity, unverified accounts and other organizations", () => {
    expect(buildAssistanceProposals([payment("p", 100)], [invoice("1001", 100)], [...memory, { ...memory[0], id: "m2", counterparty_ico: "456" }])[0].kind).toBe("ambiguous");
    expect(buildAssistanceProposals([{ ...payment("p", 100), account_verified: false }], [invoice("1001", 100)], memory)[0].kind).toBe("waiting");
    expect(buildAssistanceProposals([payment("p", 100, "1001")], [{ ...invoice("1001", 100), organization_id: "other" }], [])[0].kind).toBe("waiting");
  });
  it("uses remaining balances to the haler and excludes settled or ineligible payments", () => {
    expect(buildAssistanceProposals([payment("p", 60.18, "1001")], [{ ...invoice("1001", 100.18), paid_amount: 40 }], [])[0].allocations[0].amount).toBe(60.18);
    expect(buildAssistanceProposals([{ ...payment("p", 100), eligible: false }], [invoice("1001", 100)], memory)).toEqual([]);
  });
  it("marks multiple equal invoice subsets ambiguous", () => {
    expect(buildAssistanceProposals([payment("p", 100)], [invoice("1001", 100), invoice("1002", 100)], memory).every(p => p.kind !== "unique")).toBe(true);
  });
  it("does not redirect a reference to an already settled invoice using memory", () => {
    const result = buildAssistanceProposals([payment("p",100,"1001")],[{ ...invoice("1001",100),paid_amount:100,status:"paid" },invoice("1002",100)],memory);
    expect(result[0].kind).toBe("ambiguous");
  });
  it("returns a complex result rather than trusting truncated searches", () => {
    expect(buildAssistanceProposals([payment("p", 100)], Array.from({ length: 33 }, (_, i) => invoice(String(i), 100)), memory)[0].kind).toBe("complex");
    expect(buildAssistanceProposals([payment("p", 100)], [invoice("1001", 100)], memory, 1)[0].kind).toBe("complex");
  });
});
