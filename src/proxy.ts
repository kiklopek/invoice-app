import { createServerClient, type CookieOptions } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { isAllowedCorporateEmail } from "@/lib/auth-policy";

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
    pathname.startsWith(route)
  );

  let response = NextResponse.next({
    request,
  });

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  const isLocalDemo =
    process.env.NODE_ENV !== "production" &&
    (!supabaseUrl || !supabaseKey || !process.env.SUPABASE_SERVICE_ROLE_KEY);

  // V lokálním demo režimu jsou stránky dostupné bez session. Produkce se do
  // této větve kvůli kontrole NODE_ENV nikdy nedostane.
  if (isLocalDemo) {
    if (pathname === "/login") {
      return NextResponse.redirect(new URL("/dashboard", request.url));
    }
    return response;
  }

  // V produkci s neúplnou konfigurací ponech přístup pouze na login stránku.
  if (!supabaseUrl || !supabaseKey) {
    if (isPublicRoute) {
      return response;
    }

    return NextResponse.redirect(
      new URL("/login", request.url)
    );
  }


  const supabase = createServerClient(
    supabaseUrl,
    supabaseKey,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },

        setAll(
          cookies: {
            name: string;
            value: string;
            options: CookieOptions;
          }[]
        ) {
          cookies.forEach(({ name, value }) =>
            request.cookies.set(name, value)
          );

          response = NextResponse.next({
            request,
          });

          cookies.forEach(
            ({ name, value, options }) => {
              response.cookies.set(
                name,
                value,
                options
              );
            }
          );
        },
      },
    }
  );


  const {
    data: {
      user,
    },
  } = await supabase.auth.getUser();


  // Veřejné stránky necháme být
  if (isPublicRoute) {

    if (!user) {
      return response;
    }

    // Přihlášený uživatel už nemá chodit zpět na login
    const { data: assurance } =
      await supabase.auth.mfa.getAuthenticatorAssuranceLevel();

    const hasMfa =
      assurance?.currentLevel === "aal2";


    if (pathname === "/login") {
      return NextResponse.redirect(
        new URL(
          hasMfa
            ? "/dashboard"
            : "/mfa",
          request.url
        )
      );
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
  ].some((path) =>
    pathname === path ||
    pathname.startsWith(`${path}/`)
  );


  if (!protectedRoute) {
    return response;
  }


  // Není session
  if (!user) {
    return NextResponse.redirect(
      new URL("/login", request.url)
    );
  }


  // Firemní email kontrola
  if (!isAllowedCorporateEmail(user.email)) {

    await supabase.auth.signOut();

    return NextResponse.redirect(
      new URL(
        "/login?error=domain",
        request.url
      )
    );
  }


  const { data: assurance } =
    await supabase.auth.mfa.getAuthenticatorAssuranceLevel();


  const hasMfa =
    assurance?.currentLevel === "aal2";


  // MFA není hotové
  if (
    pathname !== "/mfa" &&
    !hasMfa
  ) {
    return NextResponse.redirect(
      new URL("/mfa", request.url)
    );
  }


  // MFA hotové → zpět do aplikace
  if (
    pathname === "/mfa" &&
    hasMfa
  ) {
    return NextResponse.redirect(
      new URL("/dashboard", request.url)
    );
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
