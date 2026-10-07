import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ create: vi.fn(), status: vi.fn(), config: vi.fn(), from: vi.fn(), rpc: vi.fn() }));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/comgate", () => ({ comgateConfiguration: mocks.config, createComgatePayment: mocks.create, getComgatePayment: mocks.status }));
vi.mock("@/lib/supabase-server", () => ({ createServiceClient: () => ({ from: mocks.from, rpc: mocks.rpc }) }));
vi.mock("@/lib/billing-pdf", () => ({ generateBillingPdf: vi.fn() }));
vi.mock("@/lib/password-recovery-server", () => ({ getPasswordRecoveryBaseUrl: () => "https://splatno.cz" }));
import { createOrder, syncCardPayment } from "./billing-server";
import { fakeChain } from "@/app/api/payments/__test-helpers__";

const supplierEnv = {
  SPLATNO_SUPPLIER_NAME: "Splatno s.r.o.", SPLATNO_SUPPLIER_ICO: "27082440", SPLATNO_SUPPLIER_ADDRESS: "Ulice 1",
  SPLATNO_SUPPLIER_ACCOUNT: "19-2000145399/0800", SPLATNO_SUPPLIER_VAT_PAYER: "true",
};
const billing = { name: "Firma s.r.o.", ico: "25596641", email: "faktury@firma.cz" };
const identity = (rpc: ReturnType<typeof vi.fn>) => ({
  user: { id: "u1" }, membership: { organization_id: "org-1", role: "admin" }, service: { rpc },
}) as never;

beforeEach(() => {
  vi.resetAllMocks();
  for (const [key, value] of Object.entries(supplierEnv)) vi.stubEnv(key, value);
  vi.stubEnv("RESEND_API_KEY", "");
  mocks.config.mockReturnValue({ merchant: "1", secret: "s", test: true });
});

describe("createOrder", () => {
  it("computes the price on the server and ignores any amount sent by the browser", async () => {
    const rpc = vi.fn(async (name: string) => name === "create_billing_order"
      ? { data: { order_id: "o1", order_number: "SP-2026-000001", gross_halere: 192390 }, error: null }
      : { data: null, error: null });
    mocks.create.mockResolvedValue({ ok: true, transId: "T1", redirect: "https://payments.comgate.cz/x" });
    const result = await createOrder(identity(rpc), { plan: "profi", period: "monthly", method: "card", billing, price: 1, gross: 1 } as never);
    expect(result).toEqual({ ok: true, orderId: "o1", redirect: "https://payments.comgate.cz/x" });
    expect((rpc.mock.calls[0] as unknown[])[1]).toMatchObject({ target_plan: "profi", net: 159000, vat: 33390, gross: 192390, method: "card" });
    expect(mocks.create.mock.calls[0][0]).toMatchObject({ orderId: "o1", priceHalere: 192390, returnUrl: "https://splatno.cz/predplatne/navrat?objednavka=o1" });
  });

  it("charges no VAT when Splatno is not a VAT payer", async () => {
    vi.stubEnv("SPLATNO_SUPPLIER_VAT_PAYER", "false");
    const rpc = vi.fn(async () => ({ data: { order_id: "o1", order_number: "SP-1", gross_halere: 159000 }, error: null }));
    await createOrder(identity(rpc), { plan: "profi", period: "monthly", method: "transfer", billing });
    expect((rpc.mock.calls[0] as unknown[])[1]).toMatchObject({ net: 159000, vat: 0, gross: 159000 });
  });

  it("explains that an unverified company must verify first", async () => {
    const rpc = vi.fn(async () => ({ data: null, error: { message: "organization_not_verified" } }));
    expect(await createOrder(identity(rpc), { plan: "profi", period: "yearly", method: "transfer", billing })).toMatchObject({ ok: false, code: "not_verified" });
  });

  it("refuses unknown plans before touching the database", async () => {
    const rpc = vi.fn();
    expect((await createOrder(identity(rpc), { plan: "free", period: "monthly", method: "card", billing })).ok).toBe(false);
    expect(rpc).not.toHaveBeenCalled();
  });
});

describe("syncCardPayment", () => {
  const order = { id: "11111111-1111-4111-8111-111111111111", payment_method: "card", gateway_transaction_id: "T1", status: "pending", billing: {} };

  it("activates only when Comgate itself says PAID for exactly this order", async () => {
    mocks.from.mockReturnValue(fakeChain({ data: order, error: null }));
    mocks.status.mockResolvedValue({ ok: true, status: "PAID", priceHalere: 192390, currency: "CZK", refId: order.id, transId: "T1" });
    mocks.rpc.mockResolvedValue({ data: { already_paid: false }, error: null });
    expect(await syncCardPayment(order.id)).toEqual({ state: "paid" });
    expect(mocks.rpc).toHaveBeenCalledWith("mark_billing_order_paid", { target_order: order.id, source: "comgate", transaction_id: "T1", paid_halere: 192390 });
  });

  it("refuses a payment that belongs to another order", async () => {
    mocks.from.mockReturnValue(fakeChain({ data: order, error: null }));
    mocks.status.mockResolvedValue({ ok: true, status: "PAID", priceHalere: 192390, currency: "CZK", refId: "someone-else", transId: "T1" });
    expect(await syncCardPayment(order.id)).toEqual({ state: "mismatch" });
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it("leaves a pending payment pending", async () => {
    mocks.from.mockReturnValue(fakeChain({ data: order, error: null }));
    mocks.status.mockResolvedValue({ ok: true, status: "PENDING", priceHalere: 192390, currency: "CZK", refId: order.id, transId: "T1" });
    expect(await syncCardPayment(order.id)).toEqual({ state: "pending" });
  });
});
