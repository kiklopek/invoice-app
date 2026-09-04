import "server-only";

import { cookies } from "next/headers";
import {
  LOGIN_SESSION_COOKIE,
  REMEMBER_LOGIN_COOKIE,
  REMEMBER_LOGIN_TTL_SECONDS,
  createLoginSessionToken,
  hasActiveLoginSession,
  isRememberedLogin,
} from "@/lib/login-session";

const baseOptions = {
  httpOnly: true,
  secure: process.env.NODE_ENV === "production",
  sameSite: "strict" as const,
  path: "/",
  priority: "high" as const,
};

type SessionIdentity = { userId: string; sessionId: string };

function token(identity: SessionIdentity, remember: boolean) {
  return createLoginSessionToken({
    ...identity,
    remember,
    secret: process.env.EMAIL_MFA_SECRET,
  });
}

export async function setLoginSessionPreference(remember: boolean, identity: SessionIdentity) {
  const cookieStore = await cookies();

  // Deliberately omit Max-Age: without "remember me" this is a browser-session
  // cookie and disappears when the browser session is closed.
  cookieStore.set(LOGIN_SESSION_COOKIE, token(identity, false), baseOptions);
  cookieStore.set(REMEMBER_LOGIN_COOKIE, remember ? token(identity, true) : "", {
    ...baseOptions,
    maxAge: remember ? REMEMBER_LOGIN_TTL_SECONDS : 0,
  });
}

export async function clearLoginSessionPreference() {
  const cookieStore = await cookies();
  cookieStore.set(LOGIN_SESSION_COOKIE, "", { ...baseOptions, maxAge: 0 });
  cookieStore.set(REMEMBER_LOGIN_COOKIE, "", { ...baseOptions, maxAge: 0 });
}

export async function hasServerLoginSession(identity: SessionIdentity) {
  return hasActiveLoginSession(await cookies(), {
    ...identity,
    secret: process.env.EMAIL_MFA_SECRET,
  });
}

export async function hasRememberedLogin(identity: SessionIdentity) {
  return isRememberedLogin(await cookies(), {
    ...identity,
    secret: process.env.EMAIL_MFA_SECRET,
  });
}
