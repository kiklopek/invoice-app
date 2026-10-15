// @vitest-environment jsdom
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getDictionary } from "@/i18n/dictionaries";
import { InvitationClient } from "./invitation-client";

vi.mock("@/components/auth/auth-shell", () => ({
  AuthShell: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  authStyles: new Proxy({}, { get: (_, key) => String(key) }),
}));
vi.mock("@/components/company-logo", () => ({ CompanyLogo: () => null }));
vi.mock("@/lib/sign-out", () => ({ signOutCurrentSession: vi.fn() }));
vi.mock("@/i18n/client", () => ({ useI18n: () => ({ locale: "cs", t: getDictionary("cs") }) }));

let root: Root;
let container: HTMLDivElement;
const invitation = { status: "valid" as const, email: "kolega@example.org", role: "accounting" as const, companyName: "Firma Novák", companyLogo: null, expiresAt: "2099-01-01T00:00:00Z" };
const copy = getDictionary("cs").auth.invite;

beforeEach(() => {
  vi.stubGlobal("React", React);
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});
const render = (signedInAs: string | null = null) => act(async () => root.render(<InvitationClient token={"A".repeat(43)} invitation={invitation} signedInAs={signedInAs} />));

describe("invitation entry for new and existing accounts", () => {
  it("locks the company e-mail and lets an existing user choose their current password immediately", async () => {
    await render();
    const email = container.querySelector<HTMLInputElement>('input[type="email"]')!;
    expect(email.value).toBe(invitation.email);
    expect(email.readOnly).toBe(true);
    expect(container.querySelectorAll('input[autocomplete="new-password"]')).toHaveLength(2);
    const existing = [...container.querySelectorAll("button")].find((button) => button.textContent === copy.existingAccount)!;
    await act(async () => existing.click());
    expect(existing.getAttribute("aria-pressed")).toBe("true");
    expect(container.querySelector('input[autocomplete="name"]')).toBeNull();
    expect(container.querySelector('input[autocomplete="new-password"]')).toBeNull();
    const password = container.querySelector<HTMLInputElement>('input[autocomplete="current-password"]')!;
    expect(password.required).toBe(true);
    expect(password.minLength).toBe(-1);
    expect(container.textContent).toContain(copy.existingAccountNote);
  });

  it("uses the existing-account mode when the invited person is already signed in", async () => {
    await render(invitation.email);
    expect(container.querySelector('input[autocomplete="current-password"]')).not.toBeNull();
    expect(container.querySelector('input[autocomplete="name"]')).toBeNull();
  });

  it("does not submit another user's active session to the invitation", async () => {
    await render("other@example.org");
    expect(container.querySelector("form")).toBeNull();
    expect(container.textContent).toContain(copy.otherEmail(invitation.email));
  });

  it.each(["expired", "invalid", "unavailable"] as const)("offers no registration form for a %s invitation", async (status) => {
    await act(async () => root.render(<InvitationClient token={"A".repeat(43)} invitation={{ status }} signedInAs={null} />));
    expect(container.querySelector("form")).toBeNull();
    expect(container.textContent).toContain(copy[status]);
  });
});
