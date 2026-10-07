import { NextResponse } from "next/server";
import { getRequestIdentity } from "@/lib/auth";
import { isSameOriginMutation } from "@/lib/request-security";
import { canManageMembers } from "@/lib/role-access";
import { invitationErrorMessage } from "@/lib/invitations";
import { apiError } from "@/lib/api-response";
import { logError } from "@/lib/structured-log";
import { sendInvitation } from "@/lib/invitation-server";

// Poslat pozvánku znovu: vydá nový odkaz (starý přestane platit) s novou
// sedmidenní platností. Jen pro člověka, který pozvánku ještě nepřijal.
export async function POST(request: Request) {
  if (!isSameOriginMutation(request)) return NextResponse.json({ error: "Požadavek pochází z nepovoleného webu." }, { status: 403 });
  const body = await request.json().catch(() => null) as { id?: unknown } | null;
  const id = typeof body?.id === "string" ? body.id : "";
  if (!id) return NextResponse.json({ error: "Chybí pozvánka." }, { status: 400 });
  const identity = await getRequestIdentity();
  if (!identity) return NextResponse.json({ error: "Nejste přihlášený uživatel." }, { status: 401 });
  if (!canManageMembers(identity.membership.role)) return NextResponse.json({ error: "Pozvánky může posílat pouze administrátor." }, { status: 403 });

  const delivery = await sendInvitation(request, identity, id);
  if (!delivery.sent && delivery.reason === "issue_failed") {
    const known = invitationErrorMessage(delivery.message);
    if (known) return NextResponse.json({ error: known.message, code: known.code }, { status: known.status });
    logError("Pozvánku se nepodařilo připravit", null, { member_id: id });
    return apiError(request, "Pozvánku se nepodařilo připravit.", 500, "invitation_issue_failed");
  }
  // Neodeslaný e-mail není chyba požadavku: pozvánka zůstává „Neodesláno“
  // a admin to v odpovědi i v seznamu uvidí (nikdy falešné „Odesláno“).
  return NextResponse.json({ invitation: delivery });
}
