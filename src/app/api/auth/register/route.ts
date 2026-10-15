import { NextResponse } from "next/server";
import { apiError } from "@/lib/api-response";
import { getAuthenticatedSession, resolveMembership } from "@/lib/auth";
import { isValidEmail, normalizeEmail } from "@/lib/auth-policy";
import { consumePublicAuthLimit } from "@/lib/auth-rate-limit";
import { getEmailMfaConfiguration, requireEmailMfaSecret, setTrustedDeviceCookie, setVerifiedEmailMfaCookie } from "@/lib/email-mfa-server";
import { setLoginSessionPreference } from "@/lib/login-session-server";
import { assertLocalEmailRecipientsAllowed, LocalEmailRecipientBlockedError } from "@/lib/local-email-allowlist";
import { passwordProblem } from "@/lib/password-policy";
import { getRegistrationAccess } from "@/lib/registration-access-server";
import { sendRegistrationCode } from "@/lib/registration-email-server";
import { registrationNextPath } from "@/lib/registration-flow";
import { isSameOriginMutation } from "@/lib/request-security";
import { logInfo, requestId } from "@/lib/structured-log";
import { createServiceClient, createUserServerClient } from "@/lib/supabase-server";
import { isCustomEntryBrand } from "@/lib/tenant-entries";
import { isVerificationCode, normalizeVerificationCode } from "@/lib/verification-code";
import { prepareRegistrationCode, registrationCodeRetryAfter, saveRegistrationChallenge, discardRegistrationChallenge, finishRegistrationCode } from "@/lib/registration-code-server";

// Five-character proof is rate-limited and consumed atomically before the
// encrypted native Supabase signup token can be used to confirm the email.
export async function POST(request: Request) {
  if (!isSameOriginMutation(request)) return apiError(request, "Nepovolený požadavek.", 403, "origin_denied");
  const body = await request.json().catch(() => null) as {
    action?: unknown; email?: unknown; password?: unknown; fullName?: unknown;
    acceptTerms?: unknown; entry?: unknown; code?: unknown; locale?: unknown;
  } | null;
  const email = normalizeEmail(typeof body?.email === "string" ? body.email : "");
  const password = typeof body?.password === "string" ? body.password : "";
  const fullName = typeof body?.fullName === "string" ? body.fullName.trim() : "";
  if (!body || !["send", "verify"].includes(String(body.action)) || !isValidEmail(email)) {
    return apiError(request, "Neplatný požadavek.", 400, "invalid_request");
  }
  if (fullName.length < 3 || fullName.length > 120) return apiError(request, "Zadejte celé jméno.", 400, "invalid_name");
  if (passwordProblem(password)) return apiError(request, "Zvolte silnější heslo.", 400, "weak_password");
  const brand = isCustomEntryBrand(body.entry) ? body.entry : "splatno";
  if (brand === "splatno" && body.acceptTerms !== true) return apiError(request, "Potvrďte souhlas s podmínkami.", 400, "terms_required");
  const code = normalizeVerificationCode(typeof body.code === "string" ? body.code : "");
  if (body.action === "verify" && !isVerificationCode(code)) return apiError(request, "Zadejte kód z e-mailu.", 400, "invalid_code");

  try {
    if (!await consumePublicAuthLimit(request, body.action === "send" ? "registration_send" : "registration_verify", email)) {
      return apiError(request, "Příliš mnoho pokusů. Zkuste to později.", 429, "rate_limited");
    }
    const access = await getRegistrationAccess(email, brand);
    if (!access.allowed) return apiError(request, "Tento vstup nelze pro registraci použít.", 403, access.kind);
    requireEmailMfaSecret();
    if (body.action === "send") {
      if (!getEmailMfaConfiguration()) return apiError(request, "Odesílání e-mailů není dostupné.", 503, "email_unavailable");
      // Check local delivery restrictions before creating a pending account.
      assertLocalEmailRecipientsAllowed([email]);
      if (await registrationCodeRetryAfter(email)) return apiError(request, "Nový kód lze poslat po jedné minutě.", 429, "rate_limited");
      const service = createServiceClient();
      // generateLink generates a native OTP but sends no Supabase email.
      // Only the code is delivered through the same provider as login MFA.
      const { data, error } = await service.auth.admin.generateLink({
        type: "signup", email, password,
        options: { data: { full_name: fullName } },
      });
      // Preserve account privacy and never change a confirmed user's password.
      if (error?.code === "email_exists") return NextResponse.json({ sent: true });
      if (error || !data.properties?.hashed_token || !data.user || data.user.email_confirmed_at) {
        return apiError(request, "Účet se nepodařilo vytvořit.", 503, "registration_unavailable");
      }
      const prepared = await prepareRegistrationCode({ userId: data.user.id, email, nativeTokenHash: data.properties.hashed_token });
      if (!prepared) return apiError(request, "Nový kód lze poslat po jedné minutě.", 429, "rate_limited");
      try {
        await sendRegistrationCode({ email, code: prepared.code, locale: body.locale === "en" ? "en" : "cs" });
        await saveRegistrationChallenge(prepared.challenge);
      } catch (error) {
        const provider = error as { code?: unknown; statusCode?: unknown };
        logInfo("registration_email_delivery_failed", {
          request_id: requestId(request),
          provider_code: typeof provider?.code === "string" ? provider.code : undefined,
          provider_status: typeof provider?.statusCode === "number" ? provider.statusCode : undefined,
        });
        await discardRegistrationChallenge(prepared.challenge);
        return apiError(request, "Ověřovací kód se nepodařilo odeslat. Zkuste to znovu.", 503, "email_delivery_failed");
      }
      return NextResponse.json({ sent: true });
    }

    const supabase = await createUserServerClient();
    const challenge = await finishRegistrationCode(email, code);
    if (!challenge) return apiError(request, "Kód není správný nebo vypršel. Pošlete si nový.", 400, "invalid_code");
    const { data, error } = await supabase.auth.verifyOtp({ token_hash: challenge.nativeTokenHash, type: "signup" });
    if (error || !data.session || !data.user?.email_confirmed_at || normalizeEmail(data.user.email) !== email || data.user.id !== challenge.userId) {
      return apiError(request, "Kód není správný nebo vypršel. Pošlete si nový.", 400, "invalid_code");
    }
    // A pending account may have been started previously. After proving email
    // ownership, use the password/name chosen by THIS registration, so an old
    // unfinished signup cannot leave another person's password on the account.
    const metadata = { full_name: fullName, ...(body.acceptTerms === true ? { terms_accepted_at: new Date().toISOString() } : {}) };
    let updated = await supabase.auth.updateUser({
      password,
      data: metadata,
    });
    if (updated.error?.code === "same_password") updated = await supabase.auth.updateUser({ data: metadata });
    if (updated.error) {
      await supabase.auth.signOut({ scope: "local" });
      return apiError(request, "Účet se nepodařilo dokončit. Pokračujte přihlášením.", 503, "registration_finalize_failed");
    }
    const session = await getAuthenticatedSession({ requireMfa: false, requireLoginSession: false, accessToken: data.session.access_token });
    if (!session) {
      await supabase.auth.signOut({ scope: "local" });
      return apiError(request, "Přihlaste se prosím znovu.", 401, "invalid_session");
    }
    try {
      await setLoginSessionPreference(false, { userId: session.user.id, sessionId: session.sessionId });
      await setVerifiedEmailMfaCookie(session.user.id, session.sessionId);
    } catch {
      await supabase.auth.signOut({ scope: "local" });
      return apiError(request, "Přihlášení se nepodařilo uložit. Pokračujte přihlášením.", 503, "session_save_failed");
    }
    try {
      await setTrustedDeviceCookie(session.user.id);
    } catch {
      logInfo("registration_trusted_device_failed", { request_id: requestId(request) });
    }
    const membership = await resolveMembership(session);
    return NextResponse.json({ verified: true, redirect: registrationNextPath({ hasCompany: Boolean(membership), mfaVerified: true, brand }) });
  } catch (error) {
    if (error instanceof LocalEmailRecipientBlockedError) {
      logInfo("registration_local_email_blocked", { request_id: requestId(request) });
      return apiError(request, "Odesílání na tuto adresu není v lokálním prostředí povolené.", 503, "local_email_blocked");
    }
    // Provider exceptions can contain OTPs/URLs: retain no exception payload.
    logInfo("registration_request_failed", { request_id: requestId(request), action: String(body.action) });
    return apiError(request, "Registraci se nepodařilo dokončit. Zkuste to znovu.", 503, "registration_unavailable");
  }
}
