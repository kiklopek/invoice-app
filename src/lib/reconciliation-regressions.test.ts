import { describe, expect, it } from "vitest";
import { minorUnits } from "./money";
import { grossFromNet } from "./vat";
import { proposePaymentMatch, resolveBatchConflicts } from "./payment-matching";
import { parseInvoiceInput } from "./invoice-validation";
import { assignStatementPayments } from "./statement-assignment";

const invoice = { id: "one", invoice_number: "260610", counterparty_name: "Test", counterparty_ico: "123", currency: "CZK", amount: 15660, paid_amount: 0, variable_symbol: "42" };
describe("reconciliation invariants", () => {
  it("rounds decimal input symmetrically without binary money multiplication", () => {
    expect(minorUnits("1.005")).toBe(101);
    expect(minorUnits("-1.005")).toBe(-101);
    expect(minorUnits("1e-2")).toBe(1);
    expect(grossFromNet(12942, 21)).toBe(15659.82);
  });
  it("never substitutes invoice number for an existing VS", () => {
    expect(proposePaymentMatch({ amount:15660, currency:"CZK", variable_symbol:"260610" },[invoice]).confidence).toBe("review");
    expect(proposePaymentMatch({ amount:15660, currency:"CZK", variable_symbol:"260610" },[{...invoice,variable_symbol:null}]).confidence).toBe("safe");
  });
  it("suggests partial payments and refuses conflicting account identity", () => {
    expect(proposePaymentMatch({ amount:5000, currency:"CZK", variable_symbol:"42" },[invoice]).invoiceIds).toEqual(["one"]);
    expect(proposePaymentMatch({ amount:15660, currency:"CZK", variable_symbol:"42" },[invoice],["456"]).confidence).toBe("review");
  });
  it("demotes all competing proposals and handles 10,000 rows", () => {
    const rows = Array.from({length:10000}, (_,i) => ({proposal_confidence:"safe", proposed_invoice_ids:[String(i % 5000)], proposal_kind:"exact", proposal_reason:"exact"}));
    expect(resolveBatchConflicts(rows).every(row => row.proposal_confidence === "review")).toBe(true);
  });
  it("requires explicit confirmation of a document adjustment", () => {
    const input = {...invoice, counterparty_email:"test@example.cz",amount_without_vat:12942,vat_rate:21,issue_date:"2026-09-01",due_date:"2026-09-15"};
    expect(parseInvoiceInput(input)).toBeNull();
    expect(parseInvoiceInput({...input,money_evidence:{original_total:15660,total_source:"read",adjustment:999,adjustment_reason:"Zaokrouhlení",adjustment_confirmed:true,initial_paid:0,initial_paid_confirmed:false,multi_rate:false}})).toMatchObject({amount:15660,money_evidence:{adjustment:0.18}});
  });
  it("rejects malformed amounts before computing VAT and accepts null legacy evidence", () => {
    const input = {...invoice, amount:100, amount_without_vat:100, vat_rate:0, counterparty_email:"test@example.cz",issue_date:"2026-09-01",due_date:"2026-09-15"};
    expect(parseInvoiceInput({...input, money_evidence:null})?.amount).toBe(100);
    expect(parseInvoiceInput({...input, amount:"oops", amount_without_vat:undefined})).toBeNull();
  });
  it("never substitutes a same-amount name match for an explicit partial-payment reference", () => {
    const result = assignStatementPayments([{key:"p",amount:5000,currency:"CZK",variable_symbol:"42",counterparty_name:"Some Customer"}],
      [invoice,{...invoice,id:"two",variable_symbol:"43",amount:5000,counterparty_name:"Some Customer"}]);
    expect(result.get("p")?.proposal).toMatchObject({confidence:"review",invoiceIds:["one"]});
  });
  it("does not let batch assignment bypass conflicting confirmed account history", () => {
    const result = assignStatementPayments([{key:"p",amount:15660,currency:"CZK",variable_symbol:"42",counterparty_account:"123/0100"}],
      [invoice],new Map([["123/0100",["456"]]]));
    expect(result.get("p")?.proposal.confidence).toBe("review");
  });
  it("assigns 10,000 distinct identifiers without quadratic reference scans", () => {
    const invoices = Array.from({length:10000},(_,i)=>({...invoice,id:String(i),invoice_number:String(10000+i),variable_symbol:String(10000+i),amount:i+1}));
    const payments = invoices.map(i=>({key:i.id,variable_symbol:i.variable_symbol,amount:i.amount,currency:i.currency}));
    const result = assignStatementPayments(payments,invoices);
    expect(result.size).toBe(10000);
    expect([...result.values()].every(row=>row.proposal.confidence==="safe")).toBe(true);
  });
  it("bounds 10,000 equal-amount candidates without guessing from a truncated set", () => {
    const invoices = Array.from({length:10000},(_,i)=>({...invoice,id:String(i),variable_symbol:String(i+10000)}));
    const payments = Array.from({length:10000},(_,i)=>({key:String(i),amount:invoice.amount,currency:"CZK"}));
    expect([...assignStatementPayments(payments,invoices).values()].every(row=>row.proposal.confidence==="review")).toBe(true);
  });
});
