import { beforeEach, describe, expect, it, vi } from "vitest";
import { fixture, supplier } from "@/test/invoice-creation-fixtures";
import type { RequestIdentity } from "./auth";

const state = vi.hoisted(() => ({ existing: null as Record<string, unknown> | null, inserts: [] as Record<string, unknown>[], queries: [] as { table: string; filters: Record<string, unknown> }[], number: 42, collisions: 0, blocked: false }));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/billing-server", () => ({ subscriptionBlock: async () => state.blocked ? Response.json({ code: "monthly_invoice_limit", error: "Limit" }, { status: 402 }) : null, subscriptionErrorResponse: () => null }));
vi.mock("@/lib/ares", () => ({ lookupAresSubject: async () => ({ status: "not_found" }) }));
class Query {
  filters: Record<string, unknown> = {};
  values: Record<string, unknown> | null = null;
  constructor(readonly table: string) { state.queries.push({ table, filters: this.filters }); }
  select() { return this; }
  eq(key: string, value: unknown) { this.filters[key] = value; return this; }
  is() { return this; }
  gt() { return this; }
  insert(value: Record<string, unknown>) { this.values = value; return this; }
  update() { return this; }
  single() { return this.maybeSingle(); }
  maybeSingle(): Promise<{ data: unknown; error: unknown }> {
    if (this.table === "organizations") return Promise.resolve({ data: { ...supplier, registered_address: supplier.address }, error: null });
    if (this.table === "reminder_policies") return Promise.resolve({ data: { id: "policy", days_from_due: [0, 7], is_active: true }, error: null });
    if (this.table === "invoices" && this.values) {
      state.inserts.push(this.values);
      if (state.collisions-- > 0) return Promise.resolve({ data: null, error: { code: "23505" } });
      state.existing = { ...this.values, paid_amount: 0, status: "pending" };
      return Promise.resolve({ data: state.existing, error: null });
    }
    return Promise.resolve({ data: this.table === "invoices" ? state.existing : null, error: null });
  }
}
const rpc = vi.fn(async () => ({ data: `FV-2026-${String(++state.number).padStart(6, "0")}`, error: null }));
const identity = { service: { from: (table: string) => new Query(table), rpc } as unknown as RequestIdentity["service"], membership: { organization_id: "our-org", role: "admin" as const }, user: { id: "our-user" } };
import { issueCreation } from "./invoice-issue-server";
beforeEach(() => { state.existing = null; state.inserts = []; state.queries = []; state.number = 42; state.collisions = 0; state.blocked = false; rpc.mockClear(); });
describe("shared invoice issuance", () => {
  it("uses server totals and replays only identical requests within the organization", async () => {
    const draft = fixture();
    const result = await issueCreation(identity, draft);
    expect(result.replayed).toBe(false);
    expect(state.inserts[0]).toMatchObject({ organization_id: "our-org", created_by: "our-user", amount: 60500 });
    expect((await issueCreation(identity, draft)).replayed).toBe(true);
    expect(state.inserts).toHaveLength(1);
    expect(state.queries.filter(q => q.table === "invoices" && Boolean(q.filters.id)).every(q => q.filters.organization_id === "our-org" || !q.filters.id)).toBe(true);
    draft.items[0].unit_price = "1";
    await expect(issueCreation(identity, draft)).rejects.toMatchObject({ status: 409 });
  });
  it("rejects a total mismatch or unconfirmed invalid payment before insertion", async () => {
    await expect(issueCreation(identity, fixture(), { expectedTotal: 1 })).rejects.toMatchObject({ status: 422, code: "total_mismatch", details: { computed: 60500 } });
    for (const paidAmount of [-1, 60501, 1.001]) await expect(issueCreation(identity, fixture(), { paidAmount })).rejects.toMatchObject({ status: 400 });
    expect(state.inserts).toHaveLength(0);
  });
  it("reserves numbers atomically and retries a number occupied by an internal writer", async () => {
    const draft = fixture(); draft.invoice_number = "";
    state.collisions = 1;
    const result = await issueCreation(identity, draft, { autoNumber: true });
    expect(result.invoice.invoice_number).toBe("FV-2026-000044");
    expect(rpc).toHaveBeenCalledWith("reserve_invoice_number", { target_org: "our-org", actor_user: "our-user", invoice_year: 2026 });
    expect(rpc).toHaveBeenCalledTimes(2);
    expect((await issueCreation(identity, draft, { autoNumber: true })).replayed).toBe(true);
    expect(rpc).toHaveBeenCalledTimes(2);
  });
  it("enforces role and subscription while allowing a replay after the quota is exhausted", async () => {
    await expect(issueCreation({ ...identity, membership: { organization_id: "our-org", role: "viewer" } }, fixture())).rejects.toMatchObject({ status: 403 });
    state.blocked = true;
    await expect(issueCreation(identity, fixture())).rejects.toMatchObject({ status: 402 });
    state.blocked = false; await issueCreation(identity, fixture()); state.blocked = true;
    expect((await issueCreation(identity, fixture())).replayed).toBe(true);
  });
  it("records confirmed initial payment for the database ledger without inventing direct balances", async () => {
    await issueCreation(identity, fixture(), { paidAmount: 60500 });
    expect(state.inserts[0].money_evidence).toMatchObject({ initial_paid: 60500, initial_paid_confirmed: true });
    expect(state.inserts[0]).not.toHaveProperty("paid_amount");
    expect(state.inserts[0]).not.toHaveProperty("status");
  });
  it("binds initial payments and API payload to the replay hash", async () => {
    const draft = fixture();
    await issueCreation(identity, draft, { paidAmount: 1 });
    await expect(issueCreation(identity, draft, { paidAmount: 2 })).rejects.toMatchObject({ status: 409 });
  });
  it("uses the configured account only when the machine caller explicitly requests a default", async () => {
    const draft = fixture(); draft.payment_account = "";
    await expect(issueCreation(identity, draft)).rejects.toMatchObject({ status: 400 });
    await issueCreation(identity, draft, { defaultPaymentAccount: true });
    expect(state.inserts[0]).toHaveProperty("payment_account", supplier.bank_account_czk);
  });
});
