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

export function resolveOcrReminderPolicy({
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
