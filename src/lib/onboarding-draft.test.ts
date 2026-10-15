import { afterEach, describe, expect, it, vi } from "vitest";
import { normalizeOnboardingCompany } from "./onboarding";
import { normalizeOnboardingDraft, onboardingDraftKey, readLocalOnboardingDraft, writeLocalOnboardingDraft, type OnboardingDraft } from "./onboarding-draft";

export const draftFixture: OnboardingDraft = {
  version: 1, step: 4, reached: 6, updatedAt: 100,
  company: normalizeOnboardingCompany({ name: "Moje firma", ico: "27082440", email: "firma@example.cz" }),
  vatPayer: true, invites: [{ email: "kolega@example.cz", role: "viewer" }],
  reminders: { days: [], replyTo: "", ccText: "" }, inviteEmail: "rozepsany@", inviteRole: "accounting", logo: null,
};
afterEach(() => vi.unstubAllGlobals());
describe("rozpracovaný onboarding", () => {
  it("preserves the exact current step, reachable steps, incomplete fields, invitations and explicit VAT choice", () => {
    expect(normalizeOnboardingDraft(draftFixture)).toEqual(draftFixture);
  });
  it.each([{ step: 8 }, { reached: 8 }, { step: 7, reached: 3 }, { version: 99 }, { updatedAt: -1 }])("rejects invalid navigation %j", (change) => {
    expect(normalizeOnboardingDraft({ ...draftFixture, ...change })).toBeNull();
  });
  it("does not persist arbitrary account fields or roles", () => {
    expect(normalizeOnboardingDraft({ ...draftFixture, user_id: "other" })).not.toHaveProperty("user_id");
    expect(normalizeOnboardingDraft({ ...draftFixture, invites: [{ email: "x@example.cz", role: "owner" }] })).toBeNull();
  });
  it("bounds text and logo data", () => {
    expect(normalizeOnboardingDraft({ ...draftFixture, company: { name: "x".repeat(241) } })).toBeNull();
    expect(normalizeOnboardingDraft({ ...draftFixture, logo: { name: "test.svg", data: btoa("<svg/>") } })).toBeNull();
  });
  it("separates accounts and deletes only the completed account's copy", () => {
    const values = new Map<string, string>();
    vi.stubGlobal("localStorage", { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => values.set(key, value), removeItem: (key: string) => values.delete(key) });
    writeLocalOnboardingDraft("first", draftFixture);
    expect(readLocalOnboardingDraft("second")).toBeNull();
    writeLocalOnboardingDraft("second", { ...draftFixture, step: 2 });
    writeLocalOnboardingDraft("first", null);
    expect(readLocalOnboardingDraft("first")).toBeNull();
    expect(readLocalOnboardingDraft("second")?.step).toBe(2);
    values.set(onboardingDraftKey("first"), "{invalid");
    expect(readLocalOnboardingDraft("first")).toBeNull();
  });
});
