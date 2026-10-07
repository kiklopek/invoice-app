import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ secret: vi.fn(), sync: vi.fn() }));
vi.mock("@/lib/comgate", () => ({ isComgateSecret: mocks.secret }));
vi.mock("@/lib/billing-server", () => ({ syncCardPayment: mocks.sync }));
import { POST } from "./route";

const ORDER = "11111111-1111-4111-8111-111111111111";
const notify = (body: unknown) => POST(new Request("http://localhost/api/billing/comgate", { method: "POST", body: JSON.stringify(body) }));

beforeEach(() => {
  vi.resetAllMocks();
  mocks.sync.mockResolvedValue({ state: "paid" });
});

describe("oznámení z Comgate", () => {
  it("ignores a notification without the merchant secret", async () => {
    mocks.secret.mockReturnValue(false);
    expect((await notify({ refId: ORDER, status: "PAID", secret: "x" })).status).toBe(401);
    expect(mocks.sync).not.toHaveBeenCalled();
  });

  it("never trusts the notification's status: it re-checks the payment with Comgate", async () => {
    mocks.secret.mockReturnValue(true);
    expect((await notify({ refId: ORDER, status: "PAID", price: 1, secret: "ok" })).status).toBe(200);
    expect(mocks.sync).toHaveBeenCalledWith(ORDER);
  });

  it("does nothing for a reference that is not an order id", async () => {
    mocks.secret.mockReturnValue(true);
    expect((await notify({ refId: "'; drop table", status: "PAID", secret: "ok" })).status).toBe(200);
    expect(mocks.sync).not.toHaveBeenCalled();
  });
});
