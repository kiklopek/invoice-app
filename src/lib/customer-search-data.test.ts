import { expect, it, vi } from "vitest";
import type { RequestIdentity } from "./auth";
import { searchCustomers } from "./customer-search-data";
it("supplies first-letter suggestions with a scoped literal name prefix, without changing the two-character RPC", async () => {
  const calls: Array<[string, ...unknown[]]> = [];
  const rpc = vi.fn();
  const chain: unknown = new Proxy(
    {},
    {
      get(_target, prop) {
        if (prop === "then")
          return (resolve: (value: unknown) => void) =>
            resolve({
              data: [{ id: "customer", name: "Štůšek" }],
              error: null,
            });
        return (...args: unknown[]) => {
          calls.push([String(prop), ...args]);
          return chain;
        };
      },
    },
  );
  const identity = {
    membership: { organization_id: "own-org" },
    service: { from: () => chain, rpc },
  } as unknown as RequestIdentity;
  expect(await searchCustomers(identity, "s")).toHaveLength(1);
  expect(calls).toContainEqual(["eq", "organization_id", "own-org"]);
  expect(calls).toContainEqual(["filter", "name", "imatch", "^[sš]"]);
  expect(calls).toContainEqual(["limit", 4]);
  expect(rpc).not.toHaveBeenCalled();
});
