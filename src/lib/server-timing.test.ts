import { afterEach, describe, expect, it, vi } from "vitest";
import { measuredSupabaseFetch, measureServerOperation, withServerTiming } from "./server-timing";

afterEach(() => vi.unstubAllGlobals());

describe("request performance instrumentation", () => {
  it("keeps concurrent request measurements isolated", async () => {
    const [first, second] = await Promise.all([
      withServerTiming(async () => {
        await measureServerOperation("claims", async () => {});
        await measureServerOperation("claims", async () => {});
        return new Response(null);
      }),
      withServerTiming(async () => {
        await measureServerOperation("db", async () => {});
        return new Response(null);
      }),
    ]);
    expect(first.headers.get("server-timing")).toMatch(/claims;dur=[\d.]+;desc="2 calls"/);
    expect(first.headers.get("server-timing")).not.toContain("db");
    expect(second.headers.get("server-timing")).toMatch(/db;dur=[\d.]+;desc="1 calls"/);
    expect(second.headers.get("server-timing")).not.toContain("claims");
  });

  it("counts failed operations and prevents caching error responses", async () => {
    const response = await withServerTiming(async () => {
      await measureServerOperation("auth_user", async () => { throw new Error("private failure"); }).catch(() => {});
      return new Response(null, { status: 401 });
    });
    expect(response.status).toBe(401);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(response.headers.get("server-timing")).toContain("auth_user;");
    expect(response.headers.get("server-timing")).not.toContain("private failure");
  });

  it("never retains credentials, query values, or response bodies", async () => {
    const fetch = vi.fn().mockResolvedValue(new Response("sensitive response"));
    vi.stubGlobal("fetch", fetch);
    const response = await withServerTiming(async () => {
      await measuredSupabaseFetch("https://example.supabase.co/rest/v1/organizations?email=secret-person", {
        headers: { authorization: "Bearer private-token" }, cache: "force-cache",
      });
      return new Response(null, { headers: { "server-timing": "data;dur=1" } });
    });
    expect(fetch).toHaveBeenCalledWith(expect.any(String), expect.objectContaining({ cache: "no-store" }));
    const timing = response.headers.get("server-timing")!;
    expect(timing).toContain("data;dur=1");
    expect(timing).toContain("db;");
    for (const value of ["secret-person", "private-token", "sensitive response", "organizations", "https:"]) expect(timing).not.toContain(value);
  });

  it("does not leak a completed request into subsequent operations", async () => {
    await withServerTiming(async () => {
      await measureServerOperation("db", async () => {});
      return new Response(null);
    });
    const response = await withServerTiming(async () => new Response(null));
    expect(response.headers.get("server-timing")).toBeNull();
    expect(await measureServerOperation("claims", async () => 42)).toBe(42);
  });
});
