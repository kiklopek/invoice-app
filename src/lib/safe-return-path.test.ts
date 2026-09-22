import { describe, expect, it } from "vitest";
import { safeReturnPath } from "./safe-return-path";

describe("safeReturnPath", () => {
  it("keeps ordinary in-app paths", () => {
    expect(safeReturnPath("/customers")).toBe("/customers");
    expect(safeReturnPath("/invoices/123")).toBe("/invoices/123");
    expect(safeReturnPath("/invoices?q=Nov%C3%A1k")).toBe("/invoices?q=Novák");
  });

  it("accepts a single layer of encoding, because that is what the client sends", () => {
    expect(safeReturnPath(encodeURIComponent("/invoices/archive"))).toBe("/invoices/archive");
  });

  it("falls back when nothing usable is given", () => {
    for (const value of [null, undefined, "", "   "]) {
      expect(safeReturnPath(value)).toBe("/dashboard");
    }
  });

  // Tohle je ten skutecny duvod, proc funkce existuje.
  it("refuses anything that could leave the site", () => {
    for (const attack of [
      "//evil.example/x",          // prohlizec chape jako absolutni URL
      "https://evil.example",
      "http://evil.example",
      "javascript:alert(1)",
      "\\\\evil.example",
      "/\\evil.example",
      "%2F%2Fevil.example",        // zakodovane //
    ]) {
      expect(safeReturnPath(attack), attack).toBe("/dashboard");
    }
  });

  it("refuses paths that would bounce straight back to login", () => {
    for (const loop of ["/login", "/login?error=domain", "/mfa", "/register", "/reset-password"]) {
      expect(safeReturnPath(loop), loop).toBe("/dashboard");
    }
  });

  it("refuses control characters and absurd lengths", () => {
    expect(safeReturnPath("/invoices\n/evil")).toBe("/dashboard");
    expect(safeReturnPath(`/${"a".repeat(600)}`)).toBe("/dashboard");
  });

  it("honours an explicit fallback", () => {
    expect(safeReturnPath("https://evil.example", "/invoices")).toBe("/invoices");
  });
});
