import "server-only";

import { cookies } from "next/headers";
import {
  LOGIN_COOKIE_VALUE,
  LOGIN_SESSION_COOKIE,
  REMEMBER_LOGIN_COOKIE,
  REMEMBER_LOGIN_TTL_SECONDS,
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

export async function setLoginSessionPreference(remember: boolean) {
  const cookieStore = await cookies();

  cookieStore.set(LOGIN_SESSION_COOKIE, LOGIN_COOKIE_VALUE, baseOptions);
  cookieStore.set(REMEMBER_LOGIN_COOKIE, remember ? LOGIN_COOKIE_VALUE : "", {
    ...baseOptions,
    maxAge: remember ? REMEMBER_LOGIN_TTL_SECONDS : 0,
  });
}

export async function clearLoginSessionPreference() {
  const cookieStore = await cookies();
  cookieStore.set(LOGIN_SESSION_COOKIE, "", { ...baseOptions, maxAge: 0 });
  cookieStore.set(REMEMBER_LOGIN_COOKIE, "", { ...baseOptions, maxAge: 0 });
}

export async function hasServerLoginSession() {
  return hasActiveLoginSession(await cookies());
}

export async function hasRememberedLogin() {
  return isRememberedLogin(await cookies());
}
