import { describe, expect, it } from "vitest";
import type { Invoice } from "@/types/invoice";
import { invoiceDueContext, invoiceMoney, invoiceReminderSummary, invoicePaidPercentage, invoicePageNumbers, sortInvoicePage } from "./invoice-list-presentation";

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

describe("invoice reminder summary", () => {
  const base = { status: "pending", reminders_sent: 0, next_reminder_at: null, reminders_paused: false } as const;
  it.each([
    [1, "1 upomínka"], [2, "2 upomínky"], [4, "4 upomínky"], [5, "5 upomínek"], [21, "21 upomínek"],
  ])("declines the sent count: %s", (sent, text) => {
    expect(invoiceReminderSummary({ ...base, reminders_sent: sent }).main).toBe(text);
  });
  it("names the next reminder by its Prague calendar day", () => {
    // 23:30 UTC on 19 Oct is already 20 Oct in Prague (CEST).
    expect(invoiceReminderSummary({ ...base, next_reminder_at: "2026-10-19T23:30:00Z" })).toEqual({ main: "Zatím žádná", detail: "První 20. 10." });
    expect(invoiceReminderSummary({ ...base, reminders_sent: 2, next_reminder_at: "2026-11-02T08:00:00Z" })).toEqual({ main: "2 upomínky", detail: "Další 2. 11." });
  });
  it("says when reminders are paused and ignores plans of closed invoices", () => {
    expect(invoiceReminderSummary({ ...base, reminders_sent: 1, reminders_paused: true, next_reminder_at: "2026-11-02T08:00:00Z" })).toEqual({ main: "1 upomínka", detail: "Pozastaveno" });
    expect(invoiceReminderSummary({ ...base, status: "paid", reminders_sent: 3, next_reminder_at: "2026-11-02T08:00:00Z" })).toEqual({ main: "3 upomínky", detail: "" });
    expect(invoiceReminderSummary({ ...base, status: "paid" })).toEqual({ main: "—", detail: "" });
    expect(invoiceReminderSummary(base)).toEqual({ main: "Zatím žádná", detail: "" });
  });
});
