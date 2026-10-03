import { NextResponse } from "next/server";
import { canManageInvoices, getRequestIdentity } from "@/lib/auth";
import { isSameOriginMutation } from "@/lib/request-security";
import { assistanceFlags } from "@/lib/payment-assistance-flags";
import { configureAssistance, processAssistanceJob } from "@/lib/payment-assistance-server";
import { logError } from "@/lib/structured-log";
import { apiError } from "@/lib/api-response";

export const maxDuration = 60;
const uuid = (value: unknown): value is string => typeof value === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
const text = (value: unknown, max: number) => value === null || value === undefined || value === "" ? null : typeof value === "string" && value.trim().length <= max ? value.trim() : undefined;

export async function GET(request: Request) {
  const identity = await getRequestIdentity();
  if (!identity) return NextResponse.json({ error: "Nejste přihlášený uživatel." }, { status: 401 });
  if (!canManageInvoices(identity.membership.role)) return NextResponse.json({ error: "Nemáte oprávnění ke správě párování." }, { status: 403 });
  const org = identity.membership.organization_id;
  const flags = assistanceFlags(org);
  if (flags.mode === "off") return NextResponse.json({ flags });
  try {
    await configureAssistance(identity.service, org);
    const { data, error } = await identity.service.rpc("payment_assistance_overview", { target_org: org, actor_user: identity.user.id });
    if (error) throw error;
    return NextResponse.json({ flags, ...(data as object) });
  } catch (cause) {
    logError("Doplňkové párování není dostupné", cause);
    return apiError(request,"Nové návrhy nejsou dostupné. Stávající párování můžete dál používat.",503,"assistance_unavailable");
  }
}

export async function POST(request: Request) {
  if (!isSameOriginMutation(request)) return NextResponse.json({ error: "Nepovolený původ požadavku." }, { status: 403 });
  const identity = await getRequestIdentity();
  if (!identity) return NextResponse.json({ error: "Nejste přihlášený uživatel." }, { status: 401 });
  if (!canManageInvoices(identity.membership.role)) return NextResponse.json({ error: "Nemáte oprávnění ke správě párování." }, { status: 403 });
  const org = identity.membership.organization_id, flags = assistanceFlags(org);
  if (flags.mode === "off") return NextResponse.json({ error: "Doplňkové párování je vypnuté." }, { status: 404 });
  const body = await request.json().catch(() => null);
  if (!body || typeof body !== "object" || Array.isArray(body)) return NextResponse.json({ error: "Neplatný požadavek." }, { status: 400 });
  const actor = { target_org: org, actor_user: identity.user.id };
  try {
    await configureAssistance(identity.service, org);
    if (body.action === "reevaluate") {
      const { error } = await identity.service.rpc("request_payment_assistance", actor);
      if (error) throw error;
      await processAssistanceJob(identity.service, org);
      return NextResponse.json({ queued: true });
    }
    if (flags.mode !== "review") return NextResponse.json({ error: "Probíhá pouze porovnávání bez změny úhrad." }, { status: 403 });
    let result;
    if (body.action === "waiting" && uuid(body.payment_id) && typeof body.waiting === "boolean") {
      result = await identity.service.rpc("set_payment_assistance_waiting", { ...actor, target_payment: body.payment_id, waiting: body.waiting });
    } else if (body.action === "decide" && uuid(body.proposal_id) && typeof body.accept === "boolean") {
      result = await identity.service.rpc("decide_payment_assistance", { ...actor, target_proposal: body.proposal_id, accept: body.accept });
    } else if (body.action === "memory" && flags.memory) {
      const account = text(body.account, 100), name = text(body.payer_name, 200), reference = text(body.reference, 500), ico = text(body.counterparty_ico, 20);
      if (!ico || account === undefined || name === undefined || reference === undefined || (!account && !name && !reference) ||
          !Array.isArray(body.source_payment_ids) || body.source_payment_ids.length < 1 || body.source_payment_ids.length > 12 || !body.source_payment_ids.every(uuid) ||
          (body.id != null && !uuid(body.id)) || typeof body.active !== "boolean" || (body.id && (!Number.isInteger(body.revision) || body.revision < 1))) {
        return NextResponse.json({ error: "Vyplňte identitu a zdrojové potvrzené platby." }, { status: 400 });
      }
      result = await identity.service.rpc("save_payment_payer_memory", { ...actor, target_memory: body.id ?? null, expected_revision: body.revision ?? 0,
        ico, new_account: account, new_name: name, new_reference: reference, sources: body.source_payment_ids, new_active: body.active });
    } else return NextResponse.json({ error: "Neplatný požadavek." }, { status: 400 });
    if (result.error) {
      logError("Potvrzení návrhu párování selhalo", result.error);
      return NextResponse.json({ error: "Data nebo oprávnění se změnila. Obnovte návrhy; žádné nové přiřazení nebylo provedeno." }, { status: 409 });
    }
    return NextResponse.json({ result: result.data });
  } catch (cause) {
    logError("Doplňkové párování selhalo", cause);
    return apiError(request,"Doplňkové párování není dostupné. Použijte současné ruční přiřazení.",503,"assistance_mutation_failed");
  }
}
