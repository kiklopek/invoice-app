import { beforeEach, describe, expect, it, vi } from "vitest";
import { creationDocument, creationInput } from "@/lib/invoice-creation";
import { fixture, supplier } from "@/test/invoice-creation-fixtures";

vi.mock("server-only", () => ({}));
const state = vi.hoisted(() => ({
  suppressed: false,
  claimError: false,
  claim: null as null | { state: string; id: string; lease_token: string },
  role: "admin",
  authenticated: true,
  invoice: null as Record<string, unknown> | null,
  sent: false,
  eventError: false,
  events: [] as Record<string, unknown>[],
  queries: [] as { table: string; filters: Record<string, unknown> }[],
}));
const mail = vi.hoisted(() => vi.fn());
vi.mock("@/lib/email", () => ({ sendReminderEmail: mail }));
vi.mock("@/lib/invoice-pdf", () => ({
  generateInvoicePdf: async () => new Uint8Array([1, 2]),
  invoicePdfFilename: () => "Faktura.pdf",
}));
vi.mock("@/lib/structured-log", () => ({
  logError: vi.fn(),
  requestId: () => "fixture",
}));
class Query {
  filters: Record<string, unknown> = {};
  inserted: Record<string, unknown> | null = null;
  constructor(readonly table: string) {
    state.queries.push({ table, filters: this.filters });
  }
  select() {
    return this;
  }
  eq(key: string, value: unknown) {
    this.filters[key] = value;
    return this;
  }
  contains(key: string, value: unknown) {
    this.filters[key] = value;
    return this;
  }
  limit() {
    return this;
  }
  insert(value: Record<string, unknown>) {
    this.inserted = value;
    return this;
  }
  result() {
    if (this.inserted) {
      state.events.push(this.inserted);
      if (!state.eventError) state.sent = true;
      return {
        data: null,
        error: state.eventError ? { message: "database unavailable" } : null,
      };
    }
    return {
      data:
        this.table === "invoices"
          ? state.invoice
          : this.table === "organizations"
            ? {
                ...supplier,
                name: "Changed company settings",
                bank_account_czk: "changed",
              }
            : state.sent
              ? [{ id: "event" }]
              : [],
      error: null,
    };
  }
  maybeSingle() {
    return Promise.resolve(this.result());
  }
  then(resolve: (value: ReturnType<Query["result"]>) => unknown) {
    return Promise.resolve(this.result()).then(resolve);
  }
}
vi.mock("@/lib/auth", () => ({
  getRequestIdentity: () =>
    state.authenticated
      ? {
          membership: { organization_id: "our-org", role: state.role },
          user: { id: "our-user" },
          service: { from: (table: string) => new Query(table), rpc: async (name: string, args: Record<string, unknown>) => {
            if (name === "claim_invoice_email") {
              if (state.claimError) return { data: null, error: { message: "unavailable" } };
              if (state.suppressed) return { data: { state: "suppressed" }, error: null };
              if (state.claim?.state === "accepted") return { data: state.claim, error: null };
              if (state.claim?.state === "claimed") return { data: { state: "busy" }, error: null };
              state.claim = { state: "claimed", id: "delivery-1", lease_token: "lease-1" };
              return { data: state.claim, error: null };
            }
            if (name === "finish_invoice_email" && state.claim) {
              state.claim.state = args.accepted_provider_id ? "accepted" : "failed";
              return { data: true, error: null };
            }
            throw new Error(`Unexpected RPC ${name}`);
          } },
        }
      : null,
  canManageInvoices: (role: string) => ["admin", "accounting"].includes(role),
}));
import { POST } from "./route";
const request = (
  body: unknown = { purpose: "issue", recipient_confirmed: true },
  origin = "http://localhost",
) =>
  new Request("http://localhost/api/invoices/invoice/send", {
    method: "POST",
    headers: { origin, "content-type": "application/json" },
    body: JSON.stringify(body),
  });
const context = () => ({
  params: Promise.resolve({ id: fixture().request_id }),
});
beforeEach(() => {
  state.suppressed = false; state.claimError = false; state.claim = null;
  state.role = "admin";
  state.authenticated = true;
  state.sent = false;
  state.eventError = false;
  state.events = [];
  state.queries = [];
  state.invoice = {
    id: fixture().request_id,
    organization_id: "our-org",
    status: "pending",
    paid_amount: 0,
    ...creationInput(creationDocument(fixture(), supplier)),
  };
  mail.mockReset().mockResolvedValue({ data: { id: "message" }, error: null });
});
describe("delivery of an issued invoice", () => {
  it("requires same origin, an authorized tenant and explicit recipient confirmation", async () => {
    expect(
      (await POST(request({}, "https://foreign.example"), context())).status,
    ).toBe(403);
    state.authenticated = false;
    expect((await POST(request(), context())).status).toBe(401);
    state.authenticated = true;
    state.role = "viewer";
    expect((await POST(request(), context())).status).toBe(403);
    state.role = "accounting";
    expect((await POST(request({ purpose: "issue" }), context())).status).toBe(
      400,
    );
    expect(mail).not.toHaveBeenCalled();
    expect(
      state.queries.find((q) => q.table === "invoices")?.filters,
    ).toMatchObject({ organization_id: "our-org" });
  });
  it("uses the immutable supplier, neutral issuance template and a stable provider key", async () => {
    expect((await POST(request(), context())).status).toBe(200);
    expect(mail).toHaveBeenCalledWith(
      expect.objectContaining({
        purpose: "issue",
        to: fixture().customer.email,
        idempotencyKey: `invoice-issued-${fixture().request_id}`,
        company: expect.objectContaining({
          name: supplier.name,
          registered_address: supplier.address,
          bank_account_czk: supplier.bank_account_czk,
        }),
        template: expect.objectContaining({
          subject: "Faktura {{invoice_number}}",
        }),
      }),
    );
    expect(state.events[0]).toMatchObject({
      organization_id: "our-org",
      event_type: "emailed",
      details: { purpose: "issue", sent_to: fixture().customer.email },
    });
    expect((await POST(request(), context())).status).toBe(200);
    expect(mail).toHaveBeenCalledTimes(1);
  });
  it("does not record delivery without provider acceptance and retries the same document", async () => {
    mail.mockResolvedValueOnce({ data: null, error: null });
    expect((await POST(request(), context())).status).toBe(502);
    expect(state.events).toHaveLength(0);
    expect((await POST(request(), context())).status).toBe(200);
    expect(mail.mock.calls[0][0].idempotencyKey).toBe(
      mail.mock.calls[1][0].idempotencyKey,
    );
    expect(state.events).toHaveLength(1);
  });
  it("retains accepted delivery when the activity log fails", async () => {
    state.eventError = true;
    expect((await POST(request(), context())).status).toBe(200);
    expect(mail).toHaveBeenCalledTimes(1);
  });
});

describe("manual email guard", () => {
  it.each([{}, { purpose: "issue", recipient_confirmed: true }])("never sends to a suppressed recipient", async body => {
    state.suppressed = true;
    expect((await POST(request(body), context())).status).toBe(409);
    expect(mail).not.toHaveBeenCalled();
    expect(state.events).toHaveLength(0);
  });
  it("fails closed when the database cannot reserve delivery", async () => {
    state.claimError = true;
    const response = await POST(request({}), context());
    expect(response.status).toBe(503);
    expect(await response.json()).toMatchObject({ request_id: "fixture" });
    expect(mail).not.toHaveBeenCalled();
  });
  it("claims once for concurrent legacy requests and replays accepted delivery", async () => {
    let accept!: (value: unknown) => void;
    mail.mockImplementationOnce(() => new Promise(resolve => { accept = resolve; }));
    const first = POST(request({}), context());
    await vi.waitFor(() => expect(mail).toHaveBeenCalledTimes(1));
    expect((await POST(request({}), context())).status).toBe(409);
    accept({ data: { id: "provider-1" }, error: null });
    expect((await first).status).toBe(200);
    expect(await (await POST(request({}), context())).json()).toMatchObject({ already_sent: true });
    expect(mail).toHaveBeenCalledTimes(1);
  });
  it("uses the same durable provider key after an ambiguous failure", async () => {
    mail.mockRejectedValueOnce(new Error("network disconnected"));
    expect((await POST(request({}), context())).status).toBe(502);
    expect((await POST(request({}), context())).status).toBe(200);
    expect(mail.mock.calls.map(([params]) => params.idempotencyKey)).toEqual(["invoice-send-delivery-1", "invoice-send-delivery-1"]);
  });
});
