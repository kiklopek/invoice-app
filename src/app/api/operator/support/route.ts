import { NextResponse } from "next/server";
import { Resend } from "resend";
import { apiError } from "@/lib/api-response";
import { logError } from "@/lib/structured-log";
import { getOperatorSession } from "@/lib/operator-server";
import { isSameOriginMutation } from "@/lib/request-security";
import { assertLocalEmailRecipientsAllowed } from "@/lib/local-email-allowlist";
import { getPasswordRecoveryBaseUrl } from "@/lib/password-recovery-server";
import { renderSupportNotice } from "@/lib/support-notice";

// Support provozovatele: vstup do firmy zákazníka jako administrátor na
// 15/60/240 minut s důvodem. Bez souhlasu firmy, ale viditelně: e-mail
// administrátorům, záznam v Nastavení → Tým, pruh v aplikaci. Jen
// provozovatel s 2FA (getOperatorSession); zápis dělá databáze
// (start_support_session) a nikdy se nepočítá jako člen firmy.
const DURATIONS = new Set([15, 60, 240]);
const DEFAULT_FROM = "Splatno <prihlaseni@mail.splatno.cz>";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function POST(request: Request) {
  if (!isSameOriginMutation(request)) return NextResponse.json({ error: "Požadavek pochází z nepovoleného webu." }, { status: 403 });
  const session = await getOperatorSession();
  if (!session) return NextResponse.json({ error: "Jen pro provozovatele Splatna." }, { status: 403 });
  const body = await request.json().catch(() => null) as { organization_id?: unknown; reason?: unknown; minutes?: unknown; preview?: unknown } | null;
  const organizationId = typeof body?.organization_id === "string" && UUID.test(body.organization_id) ? body.organization_id : "";
  const reason = typeof body?.reason === "string" ? body.reason.trim() : "";
  const minutes = Number(body?.minutes);
  if (!organizationId) return NextResponse.json({ error: "Vyberte firmu." }, { status: 400 });

  const { data: organization } = await session.service.from("organizations").select("name").eq("id", organizationId).maybeSingle();
  if (!organization) return NextResponse.json({ error: "Firma nebyla nalezena." }, { status: 404 });
  // Náhled pro potvrzení: kolik administrátorů dostane upozornění.
  if (body?.preview === true) {
    const { count } = await session.service.from("organization_members").select("id", { count: "exact", head: true })
      .eq("organization_id", organizationId).eq("role", "admin").is("support_expires_at", null).not("user_id", "is", null);
    return NextResponse.json({ company_name: organization.name, admin_count: count ?? 0 });
  }
  if (reason.length < 5 || reason.length > 300) return NextResponse.json({ error: "Napište důvod vstupu (5–300 znaků)." }, { status: 400 });
  if (!DURATIONS.has(minutes)) return NextResponse.json({ error: "Vyberte dobu 15, 60 nebo 240 minut." }, { status: 400 });
  const { data, error } = await session.service.rpc("start_support_session", {
    target_org: organizationId,
    operator_user: session.user.id,
    operator_email: session.email,
    reason,
    minutes,
  });
  if (error?.message.includes("operator_is_member"))
    return NextResponse.json({ error: "Účet provozovatele je členem firmy; support musí běžet z odděleného účtu." }, { status: 409 });
  if (error) {
    logError("Vstup podpory selhal", error, { organization_id: organizationId });
    return apiError(request, "Vstup podpory se nepodařilo zahájit.", 500, "support_start_failed");
  }
  const started = data as { session_id: string; expires_at: string; admin_emails: string[] };

  // Upozornění administrátorům. Selhání e-mailu vstup nezruší (záznam v Týmu
  // a pruh v aplikaci zůstávají), ale provozovatel ho uvidí.
  let notified = 0;
  const apiKey = process.env.RESEND_API_KEY?.trim();
  if (apiKey && started.admin_emails.length) {
    const notice = renderSupportNotice({
      companyName: organization.name,
      operatorEmail: session.email,
      reason,
      expiresAt: started.expires_at,
      settingsUrl: `${getPasswordRecoveryBaseUrl()}/settings`,
    });
    try {
      assertLocalEmailRecipientsAllowed(started.admin_emails);
      const result = await new Resend(apiKey).emails.send({
        from: process.env.AUTH_EMAIL_FROM?.trim() || DEFAULT_FROM,
        to: started.admin_emails,
        replyTo: session.email,
        subject: notice.subject,
        html: notice.html,
        text: notice.text,
      }, { idempotencyKey: `support-session/${started.session_id}` });
      if (result.error) throw new Error(result.error.name);
      notified = started.admin_emails.length;
    } catch (deliveryError) {
      logError("Upozornění na vstup podpory se nepodařilo odeslat", deliveryError, { organization_id: organizationId });
    }
  }
  return NextResponse.json({ started: true, expires_at: started.expires_at, notified, admins: started.admin_emails.length });
}

// Konec supportu: provozovatel sám (pruh v aplikaci, /provoz) nebo odhlášením.
export async function DELETE(request: Request) {
  if (!isSameOriginMutation(request)) return NextResponse.json({ error: "Požadavek pochází z nepovoleného webu." }, { status: 403 });
  const session = await getOperatorSession();
  if (!session) return NextResponse.json({ error: "Jen pro provozovatele Splatna." }, { status: 403 });
  const { error } = await session.service.rpc("end_support_session", { operator_user: session.user.id, ended_by_user: session.user.id });
  if (error) {
    logError("Ukončení podpory selhalo", error);
    return apiError(request, "Podporu se nepodařilo ukončit.", 500, "support_end_failed");
  }
  return NextResponse.json({ ended: true });
}
