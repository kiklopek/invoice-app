import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { canClaimInvitation } from "./invitation-claim";

const now = new Date("2026-10-10T12:00:00Z");
const confirmed = { email_confirmed_at: "2026-10-01T00:00:00Z" };

describe("canClaimInvitation", () => {
  it("lets a confirmed e-mail claim a pending membership without a token (R. Hlavica entry)", () => {
    expect(canClaimInvitation(confirmed, { invite_expires_at: null }, now)).toBe(true);
  });

  it("lets a confirmed e-mail claim an unexpired e-mail invitation", () => {
    expect(canClaimInvitation(confirmed, { invite_expires_at: "2026-10-12T00:00:00Z" }, now)).toBe(true);
  });

  it("never binds an account whose e-mail ownership is unproven", () => {
    // Bez potvrzeného e-mailu by se k firmě připojil kdokoli, kdo si
    // zaregistruje pozvanou adresu -- jen podle e-mailu, bez tokenu.
    expect(canClaimInvitation({ email_confirmed_at: null }, { invite_expires_at: null }, now)).toBe(false);
    expect(canClaimInvitation({}, { invite_expires_at: null }, now)).toBe(false);
  });

  it("does not claim an expired invitation", () => {
    expect(canClaimInvitation(confirmed, { invite_expires_at: "2026-10-09T00:00:00Z" }, now)).toBe(false);
  });

  it("is the only gate resolveMembership uses before writing user_id", () => {
    const auth = readFileSync(join(process.cwd(), "src/lib/auth.ts"), "utf8");
    const claim = auth.indexOf("canClaimInvitation(");
    expect(claim).toBeGreaterThan(-1);
    expect(claim).toBeLessThan(auth.indexOf('.update({ user_id: user.id'));
    expect(auth).toContain("invite_expires_at");
  });
});
