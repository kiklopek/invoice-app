import { NextResponse } from "next/server";
import { apiError } from "@/lib/api-response";
import { canManageInvoices, getRequestIdentity } from "@/lib/auth";
import { isSameOriginMutation } from "@/lib/request-security";
import { logError } from "@/lib/structured-log";

export async function POST(request: Request) {
  if (!isSameOriginMutation(request)) return NextResponse.json({ error:"Nepovolený původ požadavku." },{ status:403 });
  const identity = await getRequestIdentity();
  if (!identity) return NextResponse.json({ error:"Nejste přihlášený uživatel." },{ status:401 });
  if (!canManageInvoices(identity.membership.role)) return NextResponse.json({ error:"Nemáte oprávnění potvrdit kontrolu duplicity." },{ status:403 });
  const body = await request.json().catch(() => null);
  if (!body || typeof body.entry_id !== "string" || !/^[0-9a-f-]{36}$/i.test(body.entry_id) || !Number.isInteger(body.revision) || body.revision<1) return NextResponse.json({ error:"Neplatná položka nebo revize." },{ status:400 });
  try {
    const { error } = await identity.service.rpc("acknowledge_statement_overlap", { target_org:identity.membership.organization_id,actor_user:identity.user.id,target_entry:body.entry_id,expected_revision:body.revision });
    if (error) return NextResponse.json({ error:"Import se změnil. Obnovte jej před potvrzením kontroly." },{ status:409 });
    return NextResponse.json({ acknowledged:true,revision:body.revision+1 });
  } catch (cause) {
    logError("Potvrzení kontroly duplicity selhalo",cause);
    return apiError(request,"Potvrzení kontroly duplicity není dostupné.",503,"overlap_acknowledgement_failed");
  }
}
