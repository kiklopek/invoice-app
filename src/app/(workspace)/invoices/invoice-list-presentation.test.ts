import { describe, expect, it } from "vitest";
import type { Invoice } from "@/types/invoice";
import { invoiceDueContext, invoiceMoney, invoicePaidPercentage, invoicePageNumbers, sortInvoicePage } from "./invoice-list-presentation";

describe("invoice list presentation", () => {
  it.each([[0,100,0],[100,25,25],[100,200,100],[100,-10,0],[NaN,10,0],[100,Infinity,0],[0.03,0.01,100/3]])("clamps progress without rounding money: %s / %s",(amount,paid,expected)=>{
    expect(invoicePaidPercentage(amount,paid)).toBeCloseTo(expected,10);
  });
  it("formats cents and preserves each currency",()=>{
    expect(invoiceMoney(999999999.99,"CZK").replace(/\s/g," ")).toBe("999 999 999,99 Kč");
    expect(invoiceMoney(12.34,"EUR")).toContain("12,34");
    expect(invoiceMoney(12.34,"EUR")).toContain("€");
  });
  it("calculates due context using calendar dates through Prague DST",()=>{
    expect(invoiceDueContext({status:"pending",due_date:"2026-10-26"},"2026-10-24")).toBe("Za 2 dny");
    expect(invoiceDueContext({status:"overdue",due_date:"2026-10-18"},"2026-10-19")).toBe("Po splatnosti 1 den");
    expect(invoiceDueContext({status:"pending",due_date:"2026-10-19"},"2026-10-19")).toBe("Splatnost dnes");
    expect(invoiceDueContext({status:"paid",due_date:"2026-10-18"},"2026-10-19")).toBe("Zaplaceno");
    expect(invoiceDueContext({status:"cancelled",due_date:"2026-10-18"},"2026-10-19")).toBe("Stornováno");
  });
  it("sorts only a copy of the visible page using numeric invoice order",()=>{
    const rows=[{id:"a",invoice_number:"FV-10"},{id:"b",invoice_number:"FV-2"}] as Invoice[];
    expect(sortInvoicePage(rows,"invoice_number","asc").map(row=>row.id)).toEqual(["b","a"]);
    expect(rows.map(row=>row.id)).toEqual(["a","b"]);
  });
  it("keeps first, adjacent and final page links without duplicates",()=>{
    expect(invoicePageNumbers(1,1)).toEqual([1]);
    expect(invoicePageNumbers(5,20)).toEqual([1,4,5,6,20]);
    expect(invoicePageNumbers(20,20)).toEqual([1,19,20]);
  });
});
