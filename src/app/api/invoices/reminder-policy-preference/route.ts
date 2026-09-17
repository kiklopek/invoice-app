import { NextResponse } from "next/server";
import { canManageInvoices, getRequestIdentity } from "@/lib/auth";
import { normalizeCounterpartyIco, resolveReminderPolicyPreference } from "@/lib/counterparty-reminder-preferences";

// Live lookup used by InvoiceForm for manual invoice creation/editing so the
// remembered-per-IČO reminder policy (previously OCR-only, see
// supabase/migrations/20260916010000_remember_reminder_policy_for_all_sources.sql)
// can be pre-filled as the accountant types, the same way the OCR extract
// route already resolves it server-side at extract-time.
export async function GET(request: Request) {
  const identity = await getRequestIdentity();
  if (!identity) return NextResponse.json({ error: "Nejste přihlášený uživatel." }, { status: 401 });
  if (!canManageInvoices(identity.membership.role)) {
    return NextResponse.json({ error: "Nemáte oprávnění zobrazit kategorie upomínek." }, { status: 403 });
  }
  const url = new URL(request.url);
  const normalizedIco = normalizeCounterpartyIco(url.searchParams.get("ico"));
  const organizationId = identity.membership.organization_id;

  const preferencePromise = normalizedIco
    ? identity.service.from("counterparty_reminder_preferences").select("reminder_policy_id")
        .eq("organization_id", organizationId).eq("counterparty_ico", normalizedIco).maybeSingle()
    : Promise.resolve({ data: null, error: null });
  const policiesPromise = identity.service.from("reminder_policies")
    .select("id, name, is_default").eq("organization_id", organizationId)
    .is("archived_at", null).order("is_default", { ascending: false });
  const [{ data: preference, error: preferenceError }, { data: policies, error: policiesError }] = await Promise.all([
    preferencePromise,
    policiesPromise,
  ]);
  if (preferenceError || policiesError) {
    return NextResponse.json({ error: "Kategorii upomínek podle IČO se nepodařilo načíst." }, { status: 503 });
  }
  const assignment = resolveReminderPolicyPreference({
    counterpartyIco: normalizedIco,
    preferredPolicyId: preference?.reminder_policy_id,
    policies: policies ?? [],
  });
  return NextResponse.json({ assignment });
}
