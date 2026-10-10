import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { invitationApiError, mfaApiError } from "./api-errors";

const source = (path: string) => readFileSync(join(process.cwd(), path), "utf8");
// Kódy, které routy skutečně vrací (apiError(request, "…", status, "kód")).
const codesIn = (path: string) =>
  [...source(path).matchAll(/apiError\([\s\S]*?\d{3},\s*"([a-z_]+)"/g)].map((match) => match[1]);

describe("hlášky z API podle jazyka", () => {
  it("česky ukáže text ze serveru beze změny", () => {
    expect(mfaApiError("cs", { error: "Kód není správný.", code: "invalid_code" }, "x")).toBe("Kód není správný.");
    expect(invitationApiError("cs", { error: "Zadejte celé jméno.", code: "name_required" }, "x")).toBe("Zadejte celé jméno.");
  });

  it("anglicky přeloží podle kódu", () => {
    expect(mfaApiError("en", { error: "Kód není správný.", code: "invalid_code" }, "x")).toBe("The code isn't correct.");
    expect(invitationApiError("en", { error: "…", code: "rate_limited" }, "x")).toMatch(/Too many attempts/);
    expect(mfaApiError("en", { error: "…", code: "rate_limited" }, "x")).toMatch(/one minute/);
  });

  it("bez textu nebo s neznámým kódem použije náhradní text", () => {
    expect(mfaApiError("cs", null, "Náhradní")).toBe("Náhradní");
    expect(mfaApiError("en", { error: "Česky", code: "something_new" }, "Fallback")).toBe("Fallback");
    expect(invitationApiError("en", undefined, "Fallback")).toBe("Fallback");
  });

  it("každý kód, který routy vrací, má anglický text", () => {
    const mfaCodes = [
      ...codesIn("src/app/api/auth/email-mfa/send/route.ts"),
      ...codesIn("src/app/api/auth/email-mfa/verify/route.ts"),
    ];
    expect(mfaCodes.length).toBeGreaterThan(5);
    for (const code of mfaCodes) expect(mfaApiError("en", { code }, "MISSING"), code).not.toBe("MISSING");

    const invitationCodes = [
      ...codesIn("src/app/api/invitations/[token]/route.ts"),
      ...[...source("src/lib/invitations.ts").matchAll(/^\s+([a-z_]+): \{ status: \d{3}/gm)].map((match) => match[1]),
    ].filter((code) => !["invalid_role", "insufficient_permission", "member_not_found"].includes(code));
    expect(invitationCodes.length).toBeGreaterThan(5);
    for (const code of invitationCodes) expect(invitationApiError("en", { code }, "MISSING"), code).not.toBe("MISSING");
  });
});
