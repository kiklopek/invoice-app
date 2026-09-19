import { describe, expect, it, vi } from "vitest";
import { getDocumentProxy, extractText } from "unpdf";

vi.mock("server-only", () => ({}));

import { generateInvoicePdf, invoicePdfFilename, type InvoicePdfCompany } from "./invoice-pdf";
import type { Invoice } from "@/types/invoice";

const fixtureInvoice: Invoice = {
  id: "11111111-1111-1111-1111-111111111111",
  organization_id: "22222222-2222-2222-2222-222222222222",
  reminder_policy_id: null,
  reminder_days_snapshot: [-3, 0, 7, 14],
  reminder_plan_effective_from: null,
  reminder_policy: null,
  invoice_number: "2026-0042",
  counterparty_name: "Novák Property Invest s.r.o.",
  counterparty_ico: "12345678",
  counterparty_dic: "CZ12345678",
  counterparty_email: "odber@example.com",
  variable_symbol: "20260042",
  amount_without_vat: 10000,
  vat_rate: 21,
  amount: 12100,
  paid_amount: 2000,
  currency: "CZK",
  issue_date: "2026-01-05",
  due_date: "2026-01-19",
  status: "pending",
  source: "manual",
  file_url: null,
  notes: "Děkujeme za spolupráci.",
  paid_at: null,
  reminders_sent: 0,
  last_reminder_at: null,
  next_reminder_at: null,
  reminders_paused: false,
  reminders_paused_at: null,
  reminders_paused_by: null,
  created_at: "2026-01-05T00:00:00.000Z",
  updated_at: "2026-01-05T00:00:00.000Z",
};

const fixtureCompany: InvoicePdfCompany = {
  name: "Hlavica Drevo s.r.o.",
  ico: "87654321",
  dic: "CZ87654321",
  registered_address: "Hlavní 1, 110 00 Praha",
  operating_address: null,
  phone: "+420123456789",
  email: "info@hlavicadrevo.cz",
  bank_account_czk: "123456789/0800",
  bank_account_eur: null,
};

describe("generateInvoicePdf", () => {
  it("returns non-empty bytes starting with the PDF magic header", async () => {
    const bytes = await generateInvoicePdf(fixtureInvoice, fixtureCompany);
    expect(bytes.length).toBeGreaterThan(0);
    const header = Buffer.from(bytes.slice(0, 5)).toString("ascii");
    expect(header).toBe("%PDF-");
  });

  it("includes the invoice number, counterparty, and a formatted amount in the extracted text", async () => {
    const bytes = await generateInvoicePdf(fixtureInvoice, fixtureCompany);
    const pdf = await getDocumentProxy(bytes);
    const { text } = await extractText(pdf, { mergePages: true });
    const normalized = text.replace(/ /g, " ");
    expect(normalized).toContain(fixtureInvoice.invoice_number);
    expect(normalized).toContain(fixtureInvoice.counterparty_name);
    expect(normalized).toContain("12 100,00 CZK");
  });
});

describe("invoicePdfFilename", () => {
  it("sanitizes the invoice number to a safe filename", () => {
    expect(invoicePdfFilename({ ...fixtureInvoice, invoice_number: "2026/0042 #x" })).toBe("Faktura-20260042x.pdf");
  });
});
