import { normalizeOnboardingCompany, type OnboardingCompany } from "./onboarding";
import { COMPANY_INPUT_LIMITS } from "./company-validation";
import { normalizeEmail } from "./auth-policy";
import { detectLogoType, MAX_LOGO_BYTES } from "./company-logo-file";
import type { AccessRole } from "./role-access";

export type DraftStep = 1 | 2 | 3 | 4 | 5 | 6 | 7;
export type DraftLogo = { name: string; data: string };
export type OnboardingDraft = {
  version: 1; step: DraftStep; reached: DraftStep; updatedAt: number;
  company: OnboardingCompany; vatPayer: boolean;
  invites: { email: string; role: AccessRole }[];
  reminders: { days: number[]; replyTo: string; ccText: string };
  inviteEmail: string; inviteRole: AccessRole; logo: DraftLogo | null;
};
export const MAX_DRAFT_BYTES = 800_000;
export const onboardingDraftKey = (accountId: string) => `splatno:onboarding-draft:v2:${accountId}`;
const roles = ["viewer", "accounting", "admin"];
const isStep = (value: unknown): value is DraftStep => Number.isInteger(value) && Number(value) >= 1 && Number(value) <= 7;

/** A draft deliberately permits incomplete fields; creation still validates them. */
export function normalizeOnboardingDraft(input: unknown): OnboardingDraft | null {
  if (!input || typeof input !== "object" || Array.isArray(input)) return null;
  const raw = input as Record<string, unknown>;
  if (raw.version !== 1 || !isStep(raw.step) || !isStep(raw.reached) || raw.step > raw.reached) return null;
  if (!Number.isSafeInteger(raw.updatedAt) || Number(raw.updatedAt) < 0) return null;
  const company = normalizeOnboardingCompany(raw.company);
  if (Object.entries(company).some(([field, value]) => value.length > COMPANY_INPUT_LIMITS[field as keyof OnboardingCompany])) return null;
  const reminders = raw.reminders as Partial<OnboardingDraft["reminders"]> | null;
  if (!reminders || !Array.isArray(reminders.days) || reminders.days.length > 10 || reminders.days.some(day => !Number.isInteger(day) || day < -90 || day > 365)) return null;
  if (typeof reminders.replyTo !== "string" || reminders.replyTo.length > 254 || typeof reminders.ccText !== "string" || reminders.ccText.length > 1280) return null;
  if (!Array.isArray(raw.invites) || raw.invites.length > 100) return null;
  const invites: OnboardingDraft["invites"] = [];
  for (const item of raw.invites) {
    if (!item || typeof item.email !== "string" || item.email.length > 254 || !roles.includes(item.role)) return null;
    invites.push({ email: normalizeEmail(item.email), role: item.role });
  }
  let logo: DraftLogo | null = null;
  if (raw.logo) {
    const value = raw.logo as Partial<DraftLogo>;
    if (typeof value.name !== "string" || value.name.length > 255 || typeof value.data !== "string" || value.data.length > Math.ceil(MAX_LOGO_BYTES / 3) * 4) return null;
    try {
      const decoded = atob(value.data);
      if (decoded.length > MAX_LOGO_BYTES || btoa(decoded) !== value.data) return null;
      if (!detectLogoType(Uint8Array.from(decoded.slice(0, 16), char => char.charCodeAt(0)))) return null;
    } catch { return null; }
    logo = { name: value.name, data: value.data };
  }
  return {
    version: 1, step: raw.step, reached: raw.reached, updatedAt: Number(raw.updatedAt), company,
    vatPayer: raw.vatPayer === true, invites,
    reminders: { days: [...new Set(reminders.days)], replyTo: reminders.replyTo, ccText: reminders.ccText },
    inviteEmail: typeof raw.inviteEmail === "string" ? raw.inviteEmail.slice(0, 254) : "",
    inviteRole: roles.includes(String(raw.inviteRole)) ? raw.inviteRole as AccessRole : "accounting", logo,
  };
}

export function readLocalOnboardingDraft(accountId: string): OnboardingDraft | null {
  try { return normalizeOnboardingDraft(JSON.parse(localStorage.getItem(onboardingDraftKey(accountId)) ?? "null")); }
  catch { return null; }
}
export function writeLocalOnboardingDraft(accountId: string, draft: OnboardingDraft | null) {
  try {
    if (draft) localStorage.setItem(onboardingDraftKey(accountId), JSON.stringify(draft));
    else localStorage.removeItem(onboardingDraftKey(accountId));
  } catch { /* The server copy still works if browser storage is unavailable. */ }
}
