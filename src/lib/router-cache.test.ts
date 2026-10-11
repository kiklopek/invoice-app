import { describe, expect, it } from "vitest";
import { isDataMutation } from "./router-cache";

const origin = "https://splatno.cz";
const ok = { ok: true };

describe("kdy zahodit zapamatované stránky", () => {
  it("po úspěšné změně přes vlastní API", () => {
    expect(isDataMutation("/api/invoices/1", { method: "PATCH" }, ok, origin)).toBe(true);
    expect(isDataMutation("/api/payments", { method: "delete" }, ok, origin)).toBe(true);
    expect(isDataMutation(new URL("/api/settings/company", origin), { method: "PUT" }, ok, origin)).toBe(true);
    expect(isDataMutation(new Request(`${origin}/api/customers`, { method: "POST" }), undefined, ok, origin)).toBe(true);
  });

  it("ne po čtení, chybě ani požadavku jinam", () => {
    expect(isDataMutation("/api/dashboard", undefined, ok, origin)).toBe(false);
    expect(isDataMutation("/api/dashboard", { method: "GET" }, ok, origin)).toBe(false);
    expect(isDataMutation("/api/invoices/1", { method: "PATCH" }, { ok: false }, origin)).toBe(false);
    expect(isDataMutation("https://example.com/api/x", { method: "POST" }, ok, origin)).toBe(false);
    expect(isDataMutation("/invoices/1", { method: "POST" }, ok, origin)).toBe(false);
    expect(isDataMutation("/api/auth/logout", { method: "POST" }, ok, origin)).toBe(false);
  });
});
