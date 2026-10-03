import "server-only";
import type { RequestIdentity } from "./auth";
import type { Json } from "@/types/database";
import { buildAssistanceProposals, type AssistanceInvoice, type AssistancePayment, type PayerMemory } from "./payment-assistance";
import { assistanceFlags } from "./payment-assistance-flags";
import { logError } from "./structured-log";

type Service = RequestIdentity["service"];
export type AssistanceInputs = { generation: number; payments: AssistancePayment[]; invoices: AssistanceInvoice[]; closed_invoices?: AssistanceInvoice[]; memories: PayerMemory[] };
export async function configureAssistance(service: Service, org: string) {
  const flags = assistanceFlags(org);
  if (flags.mode === "off") return flags;
  const { error } = await service.rpc("configure_payment_assistance", { target_org: org, new_mode: flags.mode, new_memory: flags.memory, new_reevaluation: flags.reevaluation });
  if (error) throw new Error("Nastavení návrhů párování není dostupné.");
  return flags;
}
export async function processAssistanceJob(service: Service, org: string) {
  const flags = await configureAssistance(service, org);
  if (flags.mode === "off") return;
  const { data: claim, error: claimError } = await service.rpc("claim_payment_assistance_job", { target_org: org });
  if (claimError) throw new Error("Frontu párování se nepodařilo načíst.");
  if (!claim) return;
  const job = claim as { lease_token: string; requested_generation: number };
  const started = Date.now();
  let errorCode: string | null = null;
  let proposals: Json = [];
  let generation = job.requested_generation;
  try {
    const { data, error } = await service.rpc("payment_assistance_inputs", { target_org: org });
    if (error || !data) throw new Error("assistance_inputs_failed");
    const inputs = data as unknown as AssistanceInputs;
    generation = inputs.generation;
    proposals = buildAssistanceProposals(inputs.payments, [...inputs.invoices,...(inputs.closed_invoices ?? [])], inputs.memories) as unknown as Json;
  } catch (cause) {
    errorCode = "assistance_evaluation_failed";
    logError("Nové návrhy párování se nepodařilo vyhodnotit", cause);
  }
  const { error } = await service.rpc("finish_payment_assistance_job", { target_org: org, token: job.lease_token, expected_generation: generation, proposals, error_code: errorCode, elapsed_ms: Date.now() - started });
  if (error) throw new Error("Výsledek vyhodnocení se nepodařilo uložit.");
}

export async function runAssistanceJobs(service: Service) {
  // Explicit organization allowlist is also the emergency kill switch. Never
  // process database-configured organizations absent from current deployment.
  const orgs = [...new Set((process.env.PAYMENT_ASSISTANCE_ORGANIZATIONS ?? "").split(",").map(s => s.trim()).filter(s => /^[0-9a-f-]{36}$/i.test(s)))];
  const started = Date.now();
  for (const org of orgs) {
    if (Date.now() - started > 40_000) break;
    if (assistanceFlags(org).mode === "off") continue;
    try { await processAssistanceJob(service, org); }
    catch (cause) { logError("Doplňkové párování selhalo; původní párování pokračuje", cause); }
  }
}
