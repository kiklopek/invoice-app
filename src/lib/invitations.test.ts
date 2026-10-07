import { describe, expect, it } from "vitest";
import {
  createInvitationToken,
  hashInvitationToken,
  invitationErrorMessage,
  invitationStatus,
  invitationUrl,
  isInvitationToken,
  renderInvitationEmail,
} from "./invitations";

describe("invitation token", () => {
  it("is random, url-safe and stored only as a sha-256 hash", () => {
    const first = createInvitationToken();
    const second = createInvitationToken();
    expect(first.token).not.toBe(second.token);
    expect(first.token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(first.hash).toMatch(/^[a-f0-9]{64}$/);
    expect(first.hash).toBe(hashInvitationToken(first.token));
    expect(first.hash).not.toContain(first.token);
  });

  it("rejects anything that is not a token before touching the database", () => {
    expect(isInvitationToken(createInvitationToken().token)).toBe(true);
    for (const value of ["", "abc", "../../etc", "a".repeat(200), "x y"]) expect(isInvitationToken(value)).toBe(false);
  });

  it("builds the link on the configured site", () => {
    expect(invitationUrl("https://splatno.cz", "TOKEN_1")).toBe("https://splatno.cz/pozvanka/TOKEN_1");
  });
});

describe("invitationStatus", () => {
  const now = new Date("2026-10-07T10:00:00Z");
  it("tells the admin the truth about every invitation", () => {
    expect(invitationStatus({ user_id: "u1", invite_expires_at: null, invite_sent_at: null }, now)).toBe("active");
    expect(invitationStatus({ user_id: null, invite_expires_at: null, invite_sent_at: null }, now)).toBe("not_sent");
    expect(invitationStatus({ user_id: null, invite_expires_at: "2026-10-10T10:00:00Z", invite_sent_at: null }, now)).toBe("not_sent");
    expect(invitationStatus({ user_id: null, invite_expires_at: "2026-10-10T10:00:00Z", invite_sent_at: "2026-10-07T09:00:00Z" }, now)).toBe("pending");
    expect(invitationStatus({ user_id: null, invite_expires_at: "2026-10-07T09:59:59Z", invite_sent_at: "2026-10-01T09:00:00Z" }, now)).toBe("expired");
  });
});

describe("invitation e-mail", () => {
  it("names the company, the role and the expiry, and escapes every value", () => {
    const email = renderInvitationEmail({
      companyName: "Firma <script>",
      inviterName: "Jana Nováková",
      role: "accounting",
      url: "https://splatno.cz/pozvanka/abc",
      expiresAt: new Date("2026-10-14T10:00:00Z"),
    });
    expect(email.subject).toBe("Firma <script> vás zve do Splatna");
    expect(email.html).toContain("Firma &lt;script&gt;");
    expect(email.html).not.toContain("<script>");
    expect(email.html).toContain("Účetní");
    expect(email.html).toContain("https://splatno.cz/pozvanka/abc");
    expect(email.text).toContain("14. 10. 2026");
    expect(email.text).toContain("Jana Nováková");
  });
});

describe("invitationErrorMessage", () => {
  it("translates database refusals into words the admin can act on", () => {
    expect(invitationErrorMessage("email_domain_not_allowed")?.status).toBe(400);
    expect(invitationErrorMessage("member_of_other_organization")?.message).toContain("jiné firmy");
    expect(invitationErrorMessage("invitation_expired")?.status).toBe(410);
    expect(invitationErrorMessage("email_mismatch")?.status).toBe(403);
    expect(invitationErrorMessage("something unexpected")).toBeNull();
  });
});
