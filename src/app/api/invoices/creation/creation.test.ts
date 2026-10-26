import { beforeEach, describe, expect, it, vi } from "vitest";
import { fixture, supplier } from "@/test/invoice-creation-fixtures";

vi.mock("server-only", () => ({}));
const state = vi.hoisted(() => ({
  role: "admin",
  authenticated: true,
  existing: null as Record<string, unknown> | null,
  inserted: [] as Record<string, unknown>[],
  queries: [] as { table: string; filters: Record<string, unknown> }[],
  customerAvailable: true,
  insertError: "",
}));
class Query {
  filters: Record<string, unknown> = {};
  operation = "read";
  values: Record<string, unknown> = {};
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
  gt() {
    return this;
  }
  is() {
    return this;
  }
  like() {
    return this;
  }
  order() {
    return this;
  }
  limit() {
    return this;
  }
  insert(values: Record<string, unknown>) {
    this.operation = "insert";
    this.values = values;
    return this;
  }
  update() {
    return this;
  }
  execute(many = false): { data: unknown; error: { code: string } | null } {
    if (this.table === "organizations")
      return {
        data: { ...supplier, registered_address: supplier.address },
        error: null,
      };
    if (this.table === "customers")
      return {
        data: state.customerAvailable
          ? {
              ...fixture().customer,
              id: this.filters.id,
              address: "Registry address",
            }
          : null,
        error: null,
      };
    if (this.table === "reminder_policies")
      return {
        data: { id: "policy", days_from_due: [-3, 0, 7, 14], is_active: true },
        error: null,
      };
    if (this.table === "invoice_uploads") return { data: null, error: null };
    if (this.table === "invoices" && this.operation === "insert") {
      state.inserted.push(this.values);
      if (state.insertError)
        return { data: null, error: { code: state.insertError } };
      state.existing = { ...this.values, paid_amount: 0, status: "pending" };
      return { data: state.existing, error: null };
    }
    return { data: many ? [] : state.existing, error: null };
  }
  maybeSingle() {
    return Promise.resolve(this.execute());
  }
  single() {
    return this.maybeSingle();
  }
  then(
    resolve: (value: {
      data: unknown;
      error: { code: string } | null;
    }) => unknown,
  ) {
    return Promise.resolve(this.execute(true)).then(resolve);
  }
}
vi.mock("@/lib/auth", () => ({
  getRequestIdentity: () =>
    state.authenticated
      ? {
          membership: { organization_id: "our-org", role: state.role },
          user: { id: "our-user" },
          service: { from: (table: string) => new Query(table) },
        }
      : null,
  canManageInvoices: (role: string) =>
    role === "admin" || role === "accounting",
}));
vi.mock("@/lib/billing-server", () => ({
  subscriptionBlock: async () => null,
  subscriptionErrorResponse: () => null,
}));
vi.mock("@/lib/ares", () => ({
  lookupAresSubject: async () => ({ status: "not_found" }),
}));
import { POST } from "../route";
import { GET } from "./route";
const request = (creation: unknown) =>
  new Request("http://localhost/api/invoices", {
    method: "POST",
    headers: { origin: "http://localhost", "content-type": "application/json" },
    body: JSON.stringify({ creation }),
  });
beforeEach(() => {
  state.role = "admin";
  state.authenticated = true;
  state.existing = null;
  state.inserted = [];
  state.queries = [];
  state.customerAvailable = true;
  state.insertError = "";
});
describe("invoice creation boundary", () => {
  it("requires identity and an authorized role for issuance and supplier reads", async () => {
    state.authenticated = false;
    expect((await POST(request(fixture()))).status).toBe(401);
    expect(
      (await GET(new Request("http://localhost/api/invoices/creation"))).status,
    ).toBe(401);
    state.authenticated = true;
    state.role = "viewer";
    expect((await POST(request(fixture()))).status).toBe(403);
    expect(
      (await GET(new Request("http://localhost/api/invoices/creation"))).status,
    ).toBe(403);
    expect(state.inserted).toHaveLength(0);
  });
  it("persists a custom unit and decimal VAT with server-calculated totals", async () => {
    const draft = fixture();
    draft.items[0] = { ...draft.items[0], unit: "licence", unit_price: "100", vat_rate: 7.55 };
    expect((await POST(request(draft))).status).toBe(201);
    expect(state.inserted[0]).toMatchObject({ amount_without_vat: 100, amount: 107.55, vat_rate: 7.55 });
    expect(JSON.stringify(state.inserted[0].money_evidence)).toContain('"unit":"licence"');
  });
  it.each([-1, 100.01, 7.555])("rejects unsupported VAT %s before saving", async rate => {
    const draft = fixture(); draft.items[0].vat_rate = rate;
    expect((await POST(request(draft))).status).toBe(400);
    expect(state.inserted).toHaveLength(0);
  });
  it("recomputes totals and supplier on the server, scopes ownership and replays one document", async () => {
    const draft = fixture();
    const forged = {
      ...draft,
      supplier: { name: "Forged supplier" },
      totals: { gross: 1 },
      organization_id: "other-org",
    };
    const response = await POST(request(forged));
    expect(response.status).toBe(201);
    const row = state.inserted[0];
    expect(row).toMatchObject({
      organization_id: "our-org",
      created_by: "our-user",
      id: draft.request_id,
      amount: 60500,
    });
    expect(JSON.stringify(row.money_evidence)).toContain(supplier.name);
    expect(JSON.stringify(row.money_evidence)).not.toContain("Forged supplier");
    expect((await POST(request(forged))).status).toBe(200);
    expect(state.inserted).toHaveLength(1);
    draft.items[0].unit_price = "1";
    expect((await POST(request(draft))).status).toBe(409);
    expect(state.inserted).toHaveLength(1);
  });
  it("rejects another organization's customer and attachment", async () => {
    const draft = fixture();
    draft.customer_id = "550e8400-e29b-41d4-a716-446655440001";
    state.customerAvailable = false;
    expect((await POST(request(draft))).status).toBe(400);
    expect(state.inserted).toHaveLength(0);
    expect(
      state.queries.find((q) => q.table === "customers")?.filters,
    ).toMatchObject({ id: draft.customer_id, organization_id: "our-org" });
    draft.customer_id = "";
    draft.attachment = { path: "other-org/private.pdf", name: "private.pdf" };
    expect((await POST(request(draft))).status).toBe(403);
    expect(state.inserted).toHaveLength(0);
    draft.attachment.path = "our-org/unverified.pdf";
    expect((await POST(request(draft))).status).toBe(400);
    expect(state.inserted).toHaveLength(0);
  });
  it("does not invent an email and pauses reminders when issuing without one", async () => {
    const draft = fixture();
    draft.customer.email = "";
    expect((await POST(request(draft))).status).toBe(201);
    expect(state.inserted[0]).toMatchObject({
      counterparty_email: "",
      reminders_paused: true,
      next_reminder_at: null,
    });
  });
  it("returns a recoverable conflict for an occupied document number", async () => {
    state.insertError = "23505";
    const response = await POST(request(fixture()));
    expect(response.status).toBe(409);
    expect(await response.text()).toContain("Číslo faktury");
  });
  it("rejects malformed decimals without inserting financial data", async () => {
    const draft = fixture();
    draft.items[0].unit_price = "Infinity";
    expect((await POST(request(draft))).status).toBe(400);
    expect(state.inserted).toHaveLength(0);
  });
});
