import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const source = (path: string) => readFileSync(join(process.cwd(), path), "utf8");

describe("authentication flow", () => {
  it("keeps password login behind organization membership verification", () => {
    expect(source("src/app/login/page.tsx")).toContain('fetch("/api/auth/access", { method: "POST" })');
    expect(source("src/app/api/auth/access/route.ts")).toContain("getRequestIdentity({ requireMfa: false })");
  });

  it("does not let magic-link login silently create users", () => {
    expect(source("src/app/login/page.tsx")).toContain("shouldCreateUser: false");
  });

  it("only accepts the password reset destination in the auth callback", () => {
    const callback = source("src/app/auth/callback/route.ts");
    expect(callback).toContain('requestedNext === "/reset-password"');
    expect(callback).toContain('const next =');
  });
});
