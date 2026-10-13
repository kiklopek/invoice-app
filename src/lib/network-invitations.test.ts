import { describe, expect, it } from "vitest";
import {
  createNetworkInvitationToken,
  hashNetworkInvitationToken,
  isNetworkInvitationToken,
  networkInvitationExpiry,
  networkInvitationOptOutUrl,
  networkInvitationUrl,
  renderNetworkInvitationEmail,
} from "./network-invitations";

const render = (overrides: Partial<Parameters<typeof renderNetworkInvitationEmail>[0]> = {}) => renderNetworkInvitationEmail({
  inviterName: "Alfa s.r.o.",
  inviterIco: "12345601",
  senderEmail: "admin@alfa.cz",
  openCount: 3,
  url: "https://splatno.cz/pripojeni/token",
  optOutUrl: "https://splatno.cz/pripojeni/token?odhlasit=1",
  ...overrides,
});

describe("pozvánka do Splatno Sítě", () => {
  it("stores only a hash of a one-time token and links to the public page", () => {
    const { token, hash } = createNetworkInvitationToken();
    expect(isNetworkInvitationToken(token)).toBe(true);
    expect(hash).toBe(hashNetworkInvitationToken(token));
    expect(hash).toMatch(/^[a-f0-9]{64}$/);
    expect(networkInvitationUrl("https://splatno.cz", token)).toBe(`https://splatno.cz/pripojeni/${token}`);
    expect(networkInvitationOptOutUrl("https://splatno.cz", token)).toBe(`https://splatno.cz/pripojeni/${token}?odhlasit=1`);
    const now = new Date("2026-10-13T10:00:00Z");
    expect(networkInvitationExpiry(now).toISOString()).toBe("2026-11-03T10:00:00.000Z");
  });

  it("is a factual, relationship-bound message with sender, address source and opt-out", () => {
    const email = render();
    expect(email.subject).toBe("Alfa s.r.o. vás zve k propojení ve Splatnu");
    for (const part of [email.html, email.text]) {
      expect(part).toContain("3 otevřené faktury");
      expect(part).toContain("admin@alfa.cz");
      expect(part).toContain("12345601");
      expect(part).toContain("převzalo z faktur");
      expect(part).toContain("odhlasit=1");
    }
    // Žádné pobídky: z transakční zprávy by se stalo obchodní sdělení.
    expect(`${email.html} ${email.text}`).not.toMatch(/zdarma|sleva|měsíc|bonus|odměn/i);
  });

  it("escapes the inviter name in HTML", () => {
    const email = render({ inviterName: "<script>alert(1)</script> & syn" });
    expect(email.html).not.toContain("<script>");
    expect(email.html).toContain("&lt;script&gt;");
    expect(email.html).toContain("&amp; syn");
  });

  it("does not mention invoices when there are none", () => {
    const email = render({ openCount: 0 });
    expect(email.text).not.toContain("eviduje");
    expect(render({ openCount: 1 }).text).toContain("1 otevřenou fakturu");
    expect(render({ openCount: 7 }).text).toContain("7 otevřených faktur");
  });
});
