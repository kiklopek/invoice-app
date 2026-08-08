import { createHmac, timingSafeEqual } from "node:crypto";

export const EMAIL_MFA_COOKIE = "splatno-email-mfa";
export const EMAIL_MFA_CODE_TTL_SECONDS = 10 * 60;
export const EMAIL_MFA_SESSION_TTL_SECONDS = 12 * 60 * 60;

type EmailMfaTokenPayload = {
  v: 1;
  sub: string;
  sid: string;
  exp: number;
};

function signature(value: string, secret: string) {
  return createHmac("sha256", secret).update(value).digest("base64url");
}

export function sessionIdFromAccessToken(accessToken?: string | null) {
  if (!accessToken) return null;
  try {
    const encoded = accessToken.split(".")[1];
    if (!encoded) return null;
    const payload = JSON.parse(Buffer.from(encoded, "base64url").toString("utf8")) as { session_id?: unknown };
    return typeof payload.session_id === "string" && /^[0-9a-f-]{36}$/i.test(payload.session_id)
      ? payload.session_id
      : null;
  } catch {
    return null;
  }
}

export function isEmailMfaBypassed(email: string, configured = process.env.EMAIL_MFA_BYPASS_EMAILS) {
  const normalized = email.trim().toLowerCase();
  if (!normalized || !configured) return false;
  return configured.split(",").some((candidate) => candidate.trim().toLowerCase() === normalized);
}

export function hashEmailMfaCode(params: {
  challengeId: string;
  userId: string;
  sessionId: string;
  code: string;
  secret: string;
}) {
  return createHmac("sha256", params.secret)
    .update(`${params.challengeId}:${params.userId}:${params.sessionId}:${params.code}`)
    .digest("hex");
}

export function createEmailMfaToken(params: {
  userId: string;
  sessionId: string;
  secret: string;
  now?: number;
}) {
  const now = params.now ?? Date.now();
  const payload: EmailMfaTokenPayload = {
    v: 1,
    sub: params.userId,
    sid: params.sessionId,
    exp: Math.floor(now / 1000) + EMAIL_MFA_SESSION_TTL_SECONDS,
  };
  const encoded = Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
  return `${encoded}.${signature(encoded, params.secret)}`;
}

export function verifyEmailMfaToken(params: {
  token?: string | null;
  userId: string;
  sessionId: string;
  secret?: string;
  now?: number;
}) {
  if (!params.token || !params.secret || params.secret.length < 32) return false;
  const [encoded, providedSignature, extra] = params.token.split(".");
  if (!encoded || !providedSignature || extra) return false;
  const expectedSignature = signature(encoded, params.secret);
  const provided = Buffer.from(providedSignature);
  const expected = Buffer.from(expectedSignature);
  if (provided.length !== expected.length || !timingSafeEqual(provided, expected)) return false;
  try {
    const payload = JSON.parse(Buffer.from(encoded, "base64url").toString("utf8")) as EmailMfaTokenPayload;
    const now = Math.floor((params.now ?? Date.now()) / 1000);
    return payload.v === 1 && payload.sub === params.userId && payload.sid === params.sessionId && payload.exp > now;
  } catch {
    return false;
  }
}

export function maskEmail(email: string) {
  const [local, domain] = email.split("@");
  if (!local || !domain) return email;
  const visible = local.slice(0, Math.min(2, local.length));
  return `${visible}${"*".repeat(Math.max(3, local.length - visible.length))}@${domain}`;
}
