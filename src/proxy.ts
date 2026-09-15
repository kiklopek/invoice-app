import { createServerClient, type CookieOptions } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { isAllowedCorporateEmail } from "@/lib/auth-policy";
import {
  EMAIL_MFA_COOKIE,
  isEmailMfaBypassed,
  verifyEmailMfaToken,
} from "@/lib/email-mfa-core";
import {
  LOGIN_SESSION_COOKIE,
  REMEMBER_LOGIN_COOKIE,
  hasActiveLoginSession,
} from "@/lib/login-session";
import type { Database } from "@/types/database";

function redirectWithCookies(url: URL, source: NextResponse) {
  const redirect = NextResponse.redirect(url);
  source.cookies.getAll().forEach((cookie) => redirect.cookies.set(cookie));
  return redirect;
}

export async function proxy(request: NextRequest) {
  const pathname = request.nextUrl.pathname;

  const publicRoutes = [
    "/login",
    "/register",
    "/forgot-password",
    "/reset-password",
    "/auth",
    "/favicon.ico",
  ];

  const isPublicRoute = publicRoutes.some((route) =>
    pathname.startsWith(route),
  );

  let response = NextResponse.next({
    request,
  });

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  // Bez skutečného Supabase připojení nikdy neobcházíme autentizaci ani
  // nevytváříme lokální uživatelskou relaci.
  if (!supabaseUrl || !supabaseKey) {
    if (isPublicRoute) {
      return response;
    }

    return NextResponse.redirect(new URL("/login", request.url));
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

  // Staré Supabase cookies samy o sobě nestačí. Bez aktivní relace prohlížeče
  // nebo výslovného „Zapamatovat si mě“ uživatele odhlásíme ještě před MFA.
  if (user && !hasLoginSession && !pathname.startsWith("/auth/")) {
    await supabase.auth.signOut({ scope: "local" });
    response.cookies.set(EMAIL_MFA_COOKIE, "", { path: "/", maxAge: 0 });

    if (
      pathname === "/login" ||
      pathname === "/register" ||
      pathname === "/forgot-password"
    ) {
      return response;
    }

    return redirectWithCookies(new URL("/login", request.url), response);
  }

  // Veřejné stránky necháme být
  if (isPublicRoute) {
    if (!user) {
      return response;
    }

    // Plně ověřený uživatel (MFA hotové) už nemá chodit zpět na login.
    if (pathname === "/login") {
      if (hasMfa) {
        return redirectWithCookies(new URL("/dashboard", request.url), response);
      }

      // Uživatel je přihlášený, ale MFA ještě nedokončil a výslovně otevřel
      // /login (např. aby se vzdal této relace a přihlásil se jiným účtem).
      // Neposílat ho zpět na /mfa — to by ho tam uvěznilo bez úniku.
      // Odhlásíme ho a necháme zobrazit skutečnou přihlašovací stránku.
      await supabase.auth.signOut({ scope: "local" });
      response.cookies.set(EMAIL_MFA_COOKIE, "", { path: "/", maxAge: 0 });
      response.cookies.set(LOGIN_SESSION_COOKIE, "", { path: "/", maxAge: 0 });
      response.cookies.set(REMEMBER_LOGIN_COOKIE, "", { path: "/", maxAge: 0 });
      return response;
    }

    return response;
  }

  const protectedRoute = [
    "/dashboard",
    "/invoices",
    "/reminders",
    "/reports",
    "/settings",
    "/mfa",
  ].some((path) => pathname === path || pathname.startsWith(`${path}/`));

  if (!protectedRoute) {
    return response;
  }

  // Není session
  if (!user) {
    return redirectWithCookies(new URL("/login", request.url), response);
  }

  // Firemní email kontrola
  if (!isAllowedCorporateEmail(user.email)) {
    await supabase.auth.signOut();

    return redirectWithCookies(
      new URL("/login?error=domain", request.url),
      response,
    );
  }

  // MFA není hotové
  if (pathname !== "/mfa" && !hasMfa) {
    return redirectWithCookies(new URL("/mfa", request.url), response);
  }

  // MFA hotové → zpět do aplikace
  if (pathname === "/mfa" && hasMfa) {
    return redirectWithCookies(new URL("/dashboard", request.url), response);
  }

  return response;
}

export const config = {
  matcher: [
    "/dashboard/:path*",
    "/invoices/:path*",
    "/reminders/:path*",
    "/reports/:path*",
    "/settings/:path*",
    "/mfa",
    "/login",
    "/register",
    "/forgot-password",
    "/reset-password",
    "/auth/:path*",
  ],
};
