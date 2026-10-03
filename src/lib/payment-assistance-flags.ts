export type AssistanceFlags = { mode: "off" | "shadow" | "review"; memory: boolean; reevaluation: boolean; camt: boolean };
export function assistanceFlags(organizationId: string, env: Readonly<Record<string,string | undefined>> = process.env): AssistanceFlags {
  const enabled = (env.PAYMENT_ASSISTANCE_ORGANIZATIONS ?? "").split(",").map(s => s.trim()).includes(organizationId);
  if (!enabled) return { mode: "off", memory: false, reevaluation: false, camt: false };
  return {
    mode: env.PAYMENT_ASSISTANCE_MODE === "review" ? "review" : env.PAYMENT_ASSISTANCE_MODE === "shadow" ? "shadow" : "off",
    memory: env.PAYMENT_PAYER_MEMORY_ENABLED === "true",
    reevaluation: env.PAYMENT_REEVALUATION_ENABLED === "true",
    camt: env.PAYMENT_CAMT_ENABLED === "true" && env.PAYMENT_CAMT_KB_SAMPLE_VERIFIED === "true",
  };
}
