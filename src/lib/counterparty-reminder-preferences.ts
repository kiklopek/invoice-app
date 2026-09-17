import type { OcrReminderPolicyAssignment } from "./invoice-ocr";

export type AvailableReminderPolicy = {
  id: string;
  name: string;
  is_default: boolean;
};

export function normalizeCounterpartyIco(value: string | null | undefined) {
  const normalized = (value ?? "").replace(/\D/g, "");
  return /^\d{8}$/.test(normalized) ? normalized : null;
}

// Despite the "Ocr" in the payload type's name (kept for now to avoid a wider
// rename), this resolver is source-agnostic: it's used both by the OCR
// extract flow and by manual invoice creation/editing to look up whichever
// reminder policy was last used for a given counterparty IČO.
export function resolveReminderPolicyPreference({
  counterpartyIco,
  preferredPolicyId,
  policies,
}: {
  counterpartyIco: string | null | undefined;
  preferredPolicyId: string | null | undefined;
  policies: AvailableReminderPolicy[];
}): OcrReminderPolicyAssignment | null {
  const normalizedIco = normalizeCounterpartyIco(counterpartyIco);
  const preferred = normalizedIco && preferredPolicyId
    ? policies.find(policy => policy.id === preferredPolicyId)
    : undefined;
  const selected = preferred ?? policies.find(policy => policy.is_default) ?? policies[0];
  if (!selected) return null;
  return {
    status: !normalizedIco ? "missing_ico" : preferred ? "remembered" : "default",
    counterparty_ico: normalizedIco,
    policy_id: selected.id,
    policy_name: selected.name,
  };
}
