import { afterEach, describe, expect, it, vi } from "vitest";
import { isSameOriginMutation } from "./request-security";

describe("isSameOriginMutation", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("accepts loopback aliases only in development on the same protocol and port", () => {
    vi.stubEnv("NODE_ENV", "development");
    const request = (origin: string) => new Request("http://localhost:3100/api/invoices", { headers: { origin } });
    expect(isSameOriginMutation(request("http://127.0.0.1:3100"))).toBe(true);
    expect(isSameOriginMutation(request("http://127.0.0.1:3101"))).toBe(false);
    expect(isSameOriginMutation(request("https://127.0.0.1:3100"))).toBe(false);
    expect(isSameOriginMutation(request("http://evil.example:3100"))).toBe(false);
    expect(isSameOriginMutation(request("null"))).toBe(false);
    vi.stubEnv("NODE_ENV", "production");
    expect(isSameOriginMutation(request("http://127.0.0.1:3100"))).toBe(false);
  });
  it("povolí vlastní origin a serverový požadavek bez Origin hlavičky", () => {
    expect(isSameOriginMutation(new Request("https://app.example.cz/api/invoices", { headers: { origin: "https://app.example.cz" } }))).toBe(true);
    expect(isSameOriginMutation(new Request("https://app.example.cz/api/invoices"))).toBe(true);
  });

  it("odmítne mutaci z cizího webu", () => {
    expect(isSameOriginMutation(new Request("https://app.example.cz/api/invoices", { headers: { origin: "https://evil.example" } }))).toBe(false);
  });
});
