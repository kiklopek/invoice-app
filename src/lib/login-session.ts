export const LOGIN_SESSION_COOKIE = "splatno-login-session";
export const REMEMBER_LOGIN_COOKIE = "splatno-remember-login";
export const LOGIN_COOKIE_VALUE = "active";
export const REMEMBER_LOGIN_TTL_SECONDS = 30 * 24 * 60 * 60;

type CookieReader = {
  get(name: string): { value: string } | undefined;
};

export function hasActiveLoginSession(cookies: CookieReader) {
  return cookies.get(LOGIN_SESSION_COOKIE)?.value === LOGIN_COOKIE_VALUE ||
    cookies.get(REMEMBER_LOGIN_COOKIE)?.value === LOGIN_COOKIE_VALUE;
}

export function isRememberedLogin(cookies: CookieReader) {
  return cookies.get(REMEMBER_LOGIN_COOKIE)?.value === LOGIN_COOKIE_VALUE;
}
