// Shared by the route-level tests under src/app/api/payments/**. Deliberately
// named so it doesn't match vitest's *.test.ts glob -- it's test scaffolding,
// not a test file itself.
import type { AccessRole } from "@/lib/role-access";

// A minimal chainable "thenable" that stands in for a Supabase PostgREST
// query builder: every method call (.select/.eq/.order/.range/.single/...)
// returns the same object again, and awaiting it resolves to the configured
// {data, error} result. Good enough for routes that only branch on the final
// {data, error}, without needing a real Supabase client or network I/O.
export function fakeChain(result: { data: unknown; error: unknown }) {
  const chain: unknown = new Proxy(() => undefined, {
    get(_target, prop) {
      if (prop === "then") {
        return (resolve: (value: unknown) => void, reject?: (reason: unknown) => void) =>
          Promise.resolve(result).then(resolve, reject);
      }
      return () => chain;
    },
    apply() {
      return chain;
    },
  });
  return chain;
}

// The default `service` for a fake identity: any access at all (.from/.rpc/
// .storage/...) throws. Used for guard-clause tests (auth/CSRF/role) so a
// test both proves the guard rejects the request AND proves the route never
// reached the database while doing it -- if it had, the test would fail with
// this error instead of the expected status.
function unreachableService() {
  return new Proxy(
    {},
    {
      get(_target, prop) {
        return () => {
          throw new Error(
            `identity.service.${String(prop)} should not be called -- this request should have been rejected by an earlier auth/role/CSRF guard`,
          );
        };
      },
    },
  );
}

export function fakeIdentity(overrides: {
  role?: AccessRole;
  organizationId?: string;
  userId?: string;
  service?: unknown;
} = {}) {
  return {
    user: { id: overrides.userId ?? "11111111-1111-4111-8111-111111111111" },
    membership: {
      id: "membership-11111111-1111-4111-8111-111111111111",
      organization_id: overrides.organizationId ?? "22222222-2222-4222-8222-222222222222",
      role: overrides.role ?? "admin",
      email: "ucetni@hlavica.cz",
    },
    service: overrides.service ?? unreachableService(),
  };
}

export function fakeRequest(
  url: string,
  init: { method?: string; origin?: string | null; body?: BodyInit } = {},
) {
  const headers: Record<string, string> = {};
  if (init.origin !== null) headers.origin = init.origin ?? new URL(url).origin;
  return new Request(url, { method: init.method ?? "GET", headers, body: init.body });
}

// A syntactically valid v4-shaped UUID for request bodies/path params that
// only need to pass a UUID-format check, not resolve to any real row.
export const SOME_UUID = "11111111-1111-4111-8111-111111111111";
export const OTHER_UUID = "33333333-3333-4333-8333-333333333333";
