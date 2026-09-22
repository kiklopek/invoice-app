import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Invoice } from "@/types/invoice";

vi.mock("server-only", () => ({}));

// email.ts posílá upomínky skutečným zákazníkům a neměl jediný test.
// Ověřuje se tu to, co může způsobit skutečnou škodu: odeslání z vývoje
// na cizí adresu, dvojí doručení, a odeslání bez konfigurace.

const sent: Array<{ payload: Record<string, unknown>; options: Record<string, unknown> }> = [];

vi.mock("resend", () => ({
  Resend: class {
    emails = {
      send: async (payload: Record<string, unknown>, options: Record<string, unknown>) => {
        sent.push({ payload, options });
        return { data: { id: "msg-1" }, error: null };
      },
    };
  },
}));

vi.mock("@/lib/supabase-server", () => ({
  createServiceClient: () => {
    throw new Error("Nemá se volat, když je firma předaná parametrem.");
  },
}));

const invoice = {
  id: "1", organization_id: "org-1", invoice_number: "FV-2026-001",
  counterparty_name: "Dvořák s.r.o.", counterparty_email: "odber@example.com",
  variable_symbol: "2026001", amount: 12100, amount_without_vat: 10000,
  vat_rate: 21, paid_amount: 0, currency: "CZK",
  issue_date: "2026-01-05", due_date: "2026-01-19", status: "pending",
} as unknown as Invoice;

const company = {
  name: "R. Hlavica s.r.o.", ico: "26296039", dic: "CZ26296039",
  registered_address: "Náměstí Svobody 12", operating_address: null,
  phone: "+420123456789", email: "info@example.cz",
  bank_account_czk: "6786420257/0100", bank_account_eur: null,
};

const ORIGINAL_ENV = { ...process.env };

beforeEach(() => {
  sent.length = 0;
  process.env.RESEND_API_KEY = "re_test";
  process.env.REMINDER_EMAIL_FROM = "Splatno <test@example.cz>";
  delete process.env.LOCAL_EMAIL_RECIPIENT_ALLOWLIST;
});

afterEach(() => {
  process.env = { ...ORIGINAL_ENV };
  vi.resetModules();
});

const send = async (extra: Record<string, unknown> = {}) => {
  const { sendReminderEmail } = await import("./email");
  return sendReminderEmail({
    to: "odber@example.com",
    invoice,
    stage: "overdue",
    idempotencyKey: "reminder-abc",
    company,
    ...extra,
  });
};

describe("sendReminderEmail", () => {
  it("passes an idempotency key, so a retry cannot deliver twice", async () => {
    await send();
    expect(sent[0].options.idempotencyKey).toBe("reminder-abc");
  });

  it("refuses to send when the service is not configured", async () => {
    // Tiché nedoručení upomínky je horší než hlasitá chyba -- pohledávka
    // by se tvářila jako připomenutá, a nebyla.
    delete process.env.RESEND_API_KEY;
    await expect(send()).rejects.toThrow(/nakonfigurovan/i);
    expect(sent).toHaveLength(0);
  });

  it("refuses when the sender address is missing", async () => {
    delete process.env.REMINDER_EMAIL_FROM;
    await expect(send()).rejects.toThrow();
    expect(sent).toHaveLength(0);
  });

  it("sends Czech subject and body with the invoice values filled in", async () => {
    await send();
    const payload = sent[0].payload as { subject: string; text: string; html: string };
    expect(payload.subject).toContain("FV-2026-001");
    expect(payload.text).toContain("FV-2026-001");
    // Diakritika musí projít až do e-mailu. Jméno odběratele ve výchozí
    // šabloně není, takže se kontroluje text, který tam skutečně je.
    expect(payload.html).toContain("Dobrý den");
    expect(payload.html).toContain("splatnosti");
  });

  it("attaches the invoice PDF when one is given", async () => {
    await send({ attachment: { filename: "Faktura-FV-2026-001.pdf", content: new Uint8Array([1, 2, 3]) } });
    const payload = sent[0].payload as { attachments?: Array<{ filename: string }> };
    expect(payload.attachments?.[0].filename).toBe("Faktura-FV-2026-001.pdf");
  });

  it("only sets cc when there is something to copy", async () => {
    await send();
    expect((sent[0].payload as { cc?: unknown }).cc).toBeUndefined();
    sent.length = 0;
    await send({ template: { subject: "S", body: "B", cc: ["ucetni@example.cz"] } });
    expect((sent[0].payload as { cc?: string[] }).cc).toEqual(["ucetni@example.cz"]);
  });
});

describe("pojistka proti odeslání z vývoje", () => {
  // Bez téhle pojistky by lokální běh nebo testovací prostředí poslaly
  // upomínku skutečnému odběrateli. To je nevratné.
  it("blocks a recipient outside the local allowlist", async () => {
    process.env.LOCAL_EMAIL_RECIPIENT_ALLOWLIST = "test-admin@hlavica.cz";
    await expect(send({ to: "skutecny-zakaznik@example.com" })).rejects.toThrow();
    expect(sent).toHaveLength(0);
  });

  it("lets an allowlisted recipient through", async () => {
    process.env.LOCAL_EMAIL_RECIPIENT_ALLOWLIST = "test-admin@hlavica.cz";
    await send({ to: "test-admin@hlavica.cz" });
    expect(sent).toHaveLength(1);
  });

  it("checks copies too, not just the main recipient", async () => {
    process.env.LOCAL_EMAIL_RECIPIENT_ALLOWLIST = "test-admin@hlavica.cz";
    await expect(
      send({ to: "test-admin@hlavica.cz", template: { subject: "S", body: "B", cc: ["cizi@example.com"] } }),
    ).rejects.toThrow();
    expect(sent).toHaveLength(0);
  });
});
