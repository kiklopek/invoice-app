import { afterEach, describe, expect, it, vi } from "vitest";
import { onRequestError } from "./instrumentation";

afterEach(() => vi.restoreAllMocks());
const context: Parameters<typeof onRequestError>[2] = {
  routerKind: "App Router", routePath: "/auth/recovery", routeType: "route",
  renderSource: "react-server-components", revalidateReason: undefined,
};

describe("unhandled error log privacy", () => {
  it("logs only a route template and safe diagnostic fields", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    const error = Object.assign(new Error("password=private-password user@example.invalid"), { digest: "123456789" });
    await onRequestError(error, {
      path: "/auth/recovery?token_hash=private-token", method: "GET",
      headers: { "x-request-id": "private-header-token", cookie: "private-cookie" },
    }, context);
    const text = String(log.mock.calls[0][0]);
    expect(JSON.parse(text)).toMatchObject({ path: "/auth/recovery", error: { name: "Error", digest: "123456789" } });
    for (const value of ["private-password", "user@example.invalid", "private-token", "private-header-token", "private-cookie"]) expect(text).not.toContain(value);
  });

  it("does not serialize an arbitrary thrown object or error name", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    await onRequestError({ token: "private-token" }, { path: "/auth/recovery", method: "GET", headers: {} }, context);
    await onRequestError(Object.assign(new Error("private-token"), { name: "user@example.invalid" }), { path: "/auth/recovery", method: "GET", headers: {} }, context);
    expect(log.mock.calls.map(([text]) => String(text)).join("\n")).not.toMatch(/private-token|user@example/);
  });
});
