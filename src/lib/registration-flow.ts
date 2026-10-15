import { withEntry, type EntryBrand } from "@/lib/tenant-entries";

// Membership, not the registration URL or the e-mail domain, decides whether
// the verified account should set up a company or enter an existing one.
export function registrationNextPath(input: { hasCompany: boolean; mfaVerified: boolean; brand: EntryBrand }) {
  const destination = input.hasCompany ? "/dashboard" : "/onboarding";
  return input.mfaVerified
    ? destination
    : withEntry(`/mfa?returnTo=${encodeURIComponent(destination)}`, input.brand);
}
