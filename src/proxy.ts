import { createServerClient, type CookieOptions } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { routeFor, type AccessState, type RouteDecision } from "@/lib/access-state";
import {
  EMAIL_MFA_COOKIE,
  createEmailMfaToken,
  isEmailMfaBypassed,
  verifyEmailMfaToken,
} from "@/lib/email-mfa-core";
import {
  LOGIN_SESSION_COOKIE,
  REMEMBER_LOGIN_COOKIE,
  REMEMBER_LOGIN_TTL_SECONDS,
  createLoginSessionToken,
  hasActiveLoginSession,
  isRememberedLogin,
} from "@/lib/login-session";
import type { Database } from "@/types/database";

const rememberedCookieOptions = {
  httpOnly: true,
  secure: process.env.NODE_ENV === "production",
  sameSite: "strict" as const,
  path: "/",
  maxAge: REMEMBER_LOGIN_TTL_SECONDS,
  priority: "high" as const,
};

function redirectWithCookies(url: URL, source: NextResponse) {
  const redirect = NextResponse.redirect(url);
  source.cookies.getAll().forEach((cookie) => redirect.cookies.set(cookie));
  for (const header of ["cache-control", "expires", "pragma"]) {
    const value = source.headers.get(header);
    if (value) redirect.headers.set(header, value);
  }
  return redirect;
}

function finishProxy(response: NextResponse, startedAt: number) {
  response.headers.set("cache-control", "private, no-store");
  response.headers.append("server-timing", `proxy;dur=${(performance.now() - startedAt).toFixed(1)}`);
  return response;
}

export async function proxy(request: NextRequest) {
  const startedAt = performance.now();
  const pathname = request.nextUrl.pathname;

  let response = NextResponse.next({
    request,
  });

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  // Bez skutečného Supabase připojení nikdy neobcházíme autentizaci ani
  // nevytváříme lokální uživatelskou relaci.
  if (!supabaseUrl || !supabaseKey) {
    const decision = routeFor("anonymous", pathname, request.nextUrl.search);
    return finishProxy(decision.type === "show"
      ? response
      : NextResponse.redirect(new URL("/login", request.url)), startedAt);
  }

  const supabase = createServerClient<Database>(supabaseUrl, supabaseKey, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },

      setAll(
        cookies: {
          name: string;
          value: string;
          options: CookieOptions;
        }[],
        headers: Record<string, string>,
      ) {
        cookies.forEach(({ name, value }) => request.cookies.set(name, value));

        response = NextResponse.next({
          request,
        });

        cookies.forEach(({ name, value, options }) => {
          response.cookies.set(name, value, options);
        });

        Object.entries(headers).forEach(([name, value]) =>
          response.headers.set(name, value),
        );
      },
    },
  });

  const { data: claimsData, error: claimsError } =
    await supabase.auth.getClaims();
  const claims = claimsError ? null : claimsData?.claims;
  const user = claims?.sub
    ? {
        id: claims.sub,
        email: typeof claims.email === "string" ? claims.email : "",
      }
    : null;
  const sessionId =
    typeof claims?.session_id === "string" ? claims.session_id : null;
  const email = user?.email || "";
  const hasLoginSession = Boolean(
    user &&
    sessionId &&
    hasActiveLoginSession(request.cookies, {
      userId: user.id,
      sessionId,
      secret: process.env.EMAIL_MFA_SECRET,
    }),
  );
  const hasMfa = Boolean(
    user &&
    sessionId &&
    (isEmailMfaBypassed(email) ||
      verifyEmailMfaToken({
        token: request.cookies.get(EMAIL_MFA_COOKIE)?.value,
        userId: user.id,
        sessionId,
        secret: process.env.EMAIL_MFA_SECRET,
      })),
  );

  // Stav přihlášení podle tabulky P12 (src/lib/access-state.ts). Proxy
  // nezná členství ve firmě; ověřeného uživatele vede jako "verified" a
  // firmu (nebo onboarding) dořeší layout aplikace a stránka onboardingu.
  // Staré Supabase cookies samy o sobě nestačí: bez aktivní relace
  // prohlížeče nebo výslovného „Zapamatovat si mě“ uživatele odhlásíme.
  const state: AccessState = !user
    ? "anonymous"
    : !hasLoginSession
      ? "stale_session"
      : hasMfa
        ? "verified"
        : "mfa_pending";

  // "Zapamatovat si mě" dřív razítkovalo pevnou 30denní expiraci k okamžiku
  // přihlášení, takže uživatel, co appku nepoužívá denně, "vypadl" dřív, než
  // by od průběžně používaného "remember me" čekal. Místo toho posouváme
  // okno na každém autentizovaném requestu od poslední aktivity -- stejně tak
  // MFA cookie, pokud právě ona díky remember-login dostala 30denní platnost
  // (jinak by po pár dnech nutila znovu projít MFA, i když si appka "pamatuje").
  if (
    user &&
    sessionId &&
    isRememberedLogin(request.cookies, {
      userId: user.id,
      sessionId,
      secret: process.env.EMAIL_MFA_SECRET,
    })
  ) {
    response.cookies.set(
      REMEMBER_LOGIN_COOKIE,
      createLoginSessionToken({
        userId: user.id,
        sessionId,
        remember: true,
        secret: process.env.EMAIL_MFA_SECRET,
      }),
      rememberedCookieOptions,
    );

    const mfaSecret = process.env.EMAIL_MFA_SECRET;
    if (hasMfa && mfaSecret && mfaSecret.length >= 32) {
      response.cookies.set(
        EMAIL_MFA_COOKIE,
        createEmailMfaToken({
          userId: user.id,
          sessionId,
          secret: mfaSecret,
          ttlSeconds: REMEMBER_LOGIN_TTL_SECONDS,
        }),
        rememberedCookieOptions,
      );
    }
  }

  const decision = routeFor(state, pathname, request.nextUrl.search);
  // Prefetch and RSC refreshes can race with signInWithPassword: the JWT
  // cookie already exists, but /api/auth/access has not set the app-session
  // cookie yet. Revoking that session here makes the bootstrap's getUser
  // fail with session_not_found. Keep the same access decision, but only an
  // actual page visit may revoke/clear cookies; background reads never do.
  // Next strips internal Flight headers in Proxy, so also use browser fetch
  // metadata rather than relying only on next-router-prefetch.
  const backgroundRead = request.method === "HEAD"
    || request.headers.get("sec-fetch-dest") === "empty"
    || request.headers.has("next-router-prefetch")
    || request.headers.get("purpose") === "prefetch"
    || request.nextUrl.searchParams.has("_rsc");
  if (decision.signOut && !backgroundRead) await signOutEverywhere(supabase, response);
  return finishProxy(respond(decision, request, response), startedAt);
}

async function signOutEverywhere(
  supabase: { auth: { signOut: (options: { scope: "local" }) => Promise<unknown> } },
  response: NextResponse,
) {
  await supabase.auth.signOut({ scope: "local" });
  response.cookies.set(EMAIL_MFA_COOKIE, "", { path: "/", maxAge: 0 });
  response.cookies.set(LOGIN_SESSION_COOKIE, "", { path: "/", maxAge: 0 });
  response.cookies.set(REMEMBER_LOGIN_COOKIE, "", { path: "/", maxAge: 0 });
}

function respond(decision: RouteDecision, request: NextRequest, response: NextResponse) {
  if (decision.type === "show") return response;
  return redirectWithCookies(new URL(decision.to, request.url), response);
}

export const config = {
  matcher: [
    "/dashboard/:path*",
    "/customers/:path*",
    "/invoices/:path*",
    "/predplatne/:path*",
    "/reminders/:path*",
    "/reports/:path*",
    "/notifications/:path*",
    "/settings/:path*",
    "/onboarding",
    "/provoz",
    "/pozvanka/:path*",
    "/mfa",
    "/login",
    "/hlavica",
    "/hlavica/registrace",
    "/register",
    "/forgot-password",
    "/reset-password",
    "/auth/:path*",
  ],
};
