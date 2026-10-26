import { beforeEach, expect, it } from "vitest";
import { loadPaymentsPageData } from "./payments-page-data";
import type { RequestIdentity } from "./auth";
const oldId = "11111111-1111-4111-8111-111111111111";
let calls: Array<{ table: string; filters: Array<[string, unknown]> }>;
let identity: RequestIdentity;
let ids: string[];
beforeEach(() => {
  calls = [];
  ids = [];
  const from = (table: string) => {
    const filters: Array<[string, unknown]> = [];
    const chain: unknown = new Proxy(
      {},
      {
        get(_target, prop) {
          if (prop === "then")
            return (resolve: (value: unknown) => void) => {
              calls.push({ table, filters });
              expect(filters).toContainEqual(["organization_id", "org-one"]);
              let data: unknown[] = [];
              if (table === "bank_payments")
                data = filters.some(([field]) => field === "id")
                  ? filters.some(
                      ([field, value]) => field === "id" && value === oldId,
                    )
                    ? [{ id: oldId }]
                    : []
                  : Array.from({ length: 100 }, (_, index) => ({
                      id: `recent-${index}`,
                    }));
              resolve({ data, error: null });
            };
          return (...args: unknown[]) => {
            if (prop === "eq") filters.push([args[0] as string, args[1]]);
            if (prop === "in" && args[0] === "bank_payment_id")
              ids = args[1] as string[];
            return chain;
          };
        },
      },
    );
    return chain;
  };
  identity = {
    user: { id: "user" },
    membership: { organization_id: "org-one", role: "admin" },
    service: { from },
  } as unknown as RequestIdentity;
});
it("includes a selected older payment beyond the latest hundred and loads its allocations", async () => {
  const data = await loadPaymentsPageData(identity, {
    highlightPaymentId: oldId,
  });
  expect(data.payments).toHaveLength(101);
  expect(data.payments[0].id).toBe(oldId);
  expect(ids).toContain(oldId);
  expect(calls.filter((call) => call.table === "bank_payments")).toHaveLength(
    2,
  );
});
it("never bypasses the tenant filter for a missing payment target", async () => {
  const data = await loadPaymentsPageData(identity, {
    highlightPaymentId: "22222222-2222-4222-8222-222222222222",
  });
  expect(data.payments).toHaveLength(100);
});
it("ignores invalid targets and does not add a query to ordinary loads", async () => {
  await loadPaymentsPageData(identity, { highlightPaymentId: "invalid" });
  expect(calls.filter((call) => call.table === "bank_payments")).toHaveLength(
    1,
  );
});
it("does not read the archive for the upload-only page", async () => {
  await loadPaymentsPageData(identity, {
    includePayments: false,
    highlightPaymentId: oldId,
  });
  expect(calls.filter((call) => call.table === "bank_payments")).toHaveLength(
    0,
  );
});
it("retains the operations role guard", async () => {
  identity.membership.role = "viewer";
  await expect(
    loadPaymentsPageData(identity, { highlightPaymentId: oldId }),
  ).rejects.toMatchObject({ status: 403 });
  expect(calls).toHaveLength(0);
});
