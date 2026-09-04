import { createHmac, timingSafeEqual } from "node:crypto";

export const LOGIN_SESSION_COOKIE = "splatno-login-session";
export const REMEMBER_LOGIN_COOKIE = "splatno-remember-login";
export const REMEMBER_LOGIN_TTL_SECONDS = 30 * 24 * 60 * 60;
export const CURRENT_LOGIN_TTL_SECONDS = 12 * 60 * 60;

type LoginSessionPayload = {
  v: 1;
  sub: string;
  sid: string;
  remember: boolean;
  exp: number;
};

type CookieReader = {
  get(name: string): { value: string } | undefined;
};

type LoginSessionIdentity = {
  userId: string;
  sessionId: string;
  secret?: string;
  now?: number;
};

type LoginSessionEnvironment = {
  NODE_ENV?: string;
  VERCEL_ENV?: string;
  SUPABASE_SERVICE_ROLE_KEY?: string;
};

const DEVELOPMENT_SESSION_SECRET = "splatno-local-development-session-secret-v1";

export function resolveLoginSessionSecret(
  secret: string | undefined,
  env: LoginSessionEnvironment = process.env,
) {
  if (secret && secret.length >= 32) return secret;
  if (env.NODE_ENV === "production" || env.VERCEL_ENV === "production") return null;
  return env.SUPABASE_SERVICE_ROLE_KEY && env.SUPABASE_SERVICE_ROLE_KEY.length >= 32
    ? env.SUPABASE_SERVICE_ROLE_KEY
    : DEVELOPMENT_SESSION_SECRET;
}

function signature(value: string, secret: string) {
  return createHmac("sha256", secret)
    .update(`splatno-login-session:${value}`)
    .digest("base64url");
}

export function createLoginSessionToken(params: LoginSessionIdentity & { remember: boolean; ttlSeconds?: number }) {
  const secret = resolveLoginSessionSecret(params.secret);
  if (!secret) throw new Error("Chybí bezpečný EMAIL_MFA_SECRET.");
  const payload: LoginSessionPayload = {
    v: 1,
    sub: params.userId,
    sid: params.sessionId,
    remember: params.remember,
    exp: Math.floor((params.now ?? Date.now()) / 1000) + (params.ttlSeconds ?? (
      params.remember ? REMEMBER_LOGIN_TTL_SECONDS : CURRENT_LOGIN_TTL_SECONDS
    )),
  };
  const encoded = Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
  return `${encoded}.${signature(encoded, secret)}`;
}

export function verifyLoginSessionToken(token: string | null | undefined, identity: LoginSessionIdentity) {
  const secret = resolveLoginSessionSecret(identity.secret);
  if (!token || !secret) return null;
  const [encoded, providedSignature, extra] = token.split(".");
  if (!encoded || !providedSignature || extra) return null;
  const expectedSignature = signature(encoded, secret);
  const provided = Buffer.from(providedSignature);
  const expected = Buffer.from(expectedSignature);
  if (provided.length !== expected.length || !timingSafeEqual(provided, expected)) return null;
  try {
    const payload = JSON.parse(Buffer.from(encoded, "base64url").toString("utf8")) as LoginSessionPayload;
    const now = Math.floor((identity.now ?? Date.now()) / 1000);
    return payload.v === 1 &&
      payload.sub === identity.userId &&
      payload.sid === identity.sessionId &&
      typeof payload.remember === "boolean" &&
      payload.exp > now
      ? payload
      : null;
  } catch {
    return null;
  }
}

export function hasActiveLoginSession(cookies: CookieReader, identity: LoginSessionIdentity) {
  const current = verifyLoginSessionToken(cookies.get(LOGIN_SESSION_COOKIE)?.value, identity);
  if (current && !current.remember) return true;
  const remembered = verifyLoginSessionToken(cookies.get(REMEMBER_LOGIN_COOKIE)?.value, identity);
  return Boolean(remembered?.remember);
}

export function isRememberedLogin(cookies: CookieReader, identity: LoginSessionIdentity) {
  return Boolean(verifyLoginSessionToken(cookies.get(REMEMBER_LOGIN_COOKIE)?.value, identity)?.remember);
}
