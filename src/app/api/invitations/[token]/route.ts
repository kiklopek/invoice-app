import { NextResponse } from "next/server";
import { apiError } from "@/lib/api-response";
import { consumePublicAuthLimit } from "@/lib/auth-rate-limit";
import { sessionIdFromAccessToken } from "@/lib/email-mfa-core";
import { setVerifiedEmailMfaCookie } from "@/lib/email-mfa-server";
import { invitationErrorMessage, isInvitationToken } from "@/lib/invitations";
import { loadInvitation } from "@/lib/invitation-server";
import { setLoginSessionPreference } from "@/lib/login-session-server";
import { passwordProblem } from "@/lib/password-policy";
import { isSameOriginMutation } from "@/lib/request-security";
import { createServiceClient, createUserServerClient } from "@/lib/supabase-server";
import { logError, requestId } from "@/lib/structured-log";

type Context = { params: Promise<{ token: string }> };

// Přijetí pozvánky (P7). Jedním požadavkem: účet (nebo ověření hesla
// existujícího účtu), členství ve firmě s rolí z pozvánky, přihlášení.
// Odkaz z e-mailu sám dokazuje vlastnictví schránky, proto se počítá jako
// 2FA pro tuto první relaci; každé další přihlášení už kód vyžaduje.
export async function POST(request: Request, { params }: Context) {
  if (!isSameOriginMutation(request)) {
    return apiError(request, "Požadavek pochází z nepovoleného webu.", 403, "origin_denied");
  }
  const { token } = await params;
  if (!isInvitationToken(token)) return apiError(request, "Odkaz pozvánky je neplatný.", 404, "invitation_not_found");

  const body = await request.json().catch(() => null) as { fullName?: unknown; password?: unknown; acceptTerms?: unknown } | null;
  const fullName = typeof body?.fullName === "string" ? body.fullName.trim() : "";
  const password = typeof body?.password === "string" ? body.password : "";
  if (body?.acceptTerms !== true) return apiError(request, "Pro vstup je potřeba souhlasit s podmínkami.", 400, "terms_required");
  if (fullName.length < 3 || fullName.length > 120) return apiError(request, "Zadejte celé jméno.", 400, "name_required");
  const problem = passwordProblem(password);
  if (problem) return apiError(request, problem, 400, "weak_password");

  let invitation: Awaited<ReturnType<typeof loadInvitation>>;
  try {
    if (!await consumePublicAuthLimit(request, "invitation_accept", token)) {
      return apiError(request, "Příliš mnoho pokusů. Zkuste to znovu za několik minut.", 429, "rate_limited");
    }
    invitation = await loadInvitation(token);
  } catch (error) {
    logError("Pozvánku se nepodařilo ověřit", error, { request_id: requestId(request) });
    return apiError(request, "Pozvánku se teď nepodařilo ověřit. Zkuste to prosím za chvíli.", 503, "invitation_unavailable");
  }
  if (invitation.status !== "valid") {
    const known = invitationErrorMessage(invitation.status === "expired" ? "invitation_expired" : "invitation_not_found")!;
    return apiError(request, known.message, known.status, known.code);
  }

  const service = createServiceClient();
  let createdUserId: string | null = null;
  const { data: created, error: createError } = await service.auth.admin.createUser({
    email: invitation.email,
    password,
    email_confirm: true,
    user_metadata: { full_name: fullName, terms_accepted_at: new Date().toISOString() },
  });
  if (created?.user) {
    createdUserId = created.user.id;
  } else if (createError && createError.code !== "email_exists") {
    logError("Účet z pozvánky se nepodařilo vytvořit", createError, { request_id: requestId(request) });
    return apiError(request, "Účet se nepodařilo vytvořit. Zkuste to prosím znovu.", 500, "account_create_failed");
  }

  // Přihlášení nastaví session cookies. U existujícího účtu je to zároveň
  // důkaz, že pozvánku přijímá jeho majitel (zná heslo).
  const supabase = await createUserServerClient();
  const { data: signIn, error: signInError } = await supabase.auth.signInWithPassword({ email: invitation.email, password });
  const sessionId = sessionIdFromAccessToken(signIn.session?.access_token);
  if (signInError || !signIn.user || !sessionId) {
    if (createdUserId) {
      await service.auth.admin.deleteUser(createdUserId, false);
      logError("Přihlášení nově vytvořeného účtu z pozvánky selhalo", signInError, { request_id: requestId(request) });
      return apiError(request, "Účet se nepodařilo dokončit. Zkuste to prosím znovu.", 500, "account_sign_in_failed");
    }
    return apiError(request, "Pro tento e-mail už účet máte. Zadejte jeho stávající heslo.", 401, "existing_account_password");
  }

  const { error: acceptError } = await service.rpc("accept_organization_invitation", {
    token_hash: invitation.tokenHash,
    accepting_user: signIn.user.id,
  });
  if (acceptError) {
    await supabase.auth.signOut({ scope: "local" });
    if (createdUserId) await service.auth.admin.deleteUser(createdUserId, false);
    const known = invitationErrorMessage(acceptError.message);
    if (!known) logError("Přijetí pozvánky selhalo", acceptError, { request_id: requestId(request) });
    return apiError(request, known?.message ?? "Pozvánku se nepodařilo přijmout.", known?.status ?? 500, known?.code ?? "invitation_accept_failed");
  }

  try {
    await setLoginSessionPreference(false, { userId: signIn.user.id, sessionId });
    await setVerifiedEmailMfaCookie(signIn.user.id, sessionId);
  } catch (error) {
    // Členství už vzniklo; jen se nepodařilo uložit relaci. Uživatel se
    // přihlásí běžně přes /login a projde 2FA kódem.
    logError("Relaci po přijetí pozvánky se nepodařilo uložit", error, { request_id: requestId(request) });
    return NextResponse.json({ accepted: true, redirect: "/login" });
  }
  return NextResponse.json({ accepted: true, redirect: "/dashboard" });
}
