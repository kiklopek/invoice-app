import { describe, expect, it } from "vitest";
import { pageKind, routeFor, type AccessState, type RouteDecision } from "./access-state";

const show: RouteDecision = { type: "show" };
const showSignedOut: RouteDecision = { type: "show", signOut: true };
const to = (path: string, signOut = false): RouteDecision =>
  signOut ? { type: "redirect", to: path, signOut: true } : { type: "redirect", to: path };

// Tabulka P12 z návrhu procesů, řádek po řádku. Kdo mění chování
// přesměrování, mění tuhle tabulku -- a s ní i návrh.
const table: Record<AccessState, Record<string, RouteDecision>> = {
  anonymous: {
    "/": show, "/login": show, "/hlavica": show, "/register": show, "/forgot-password": show,
    "/reset-password": show, "/auth/callback": show, "/pozvanka/abc": show,
    "/mfa": to("/login"), "/onboarding": to("/login"), "/invoices": to("/login?returnTo=%2Finvoices"),
  },
  stale_session: {
    "/": show, "/login": showSignedOut, "/hlavica": showSignedOut, "/register": showSignedOut,
    "/forgot-password": showSignedOut, "/pozvanka/abc": showSignedOut, "/auth/callback": show,
    "/reset-password": to("/login", true), "/mfa": to("/login", true),
    "/onboarding": to("/login", true), "/invoices": to("/login", true),
  },
  mfa_pending: {
    "/": show, "/login": showSignedOut, "/hlavica": showSignedOut, "/register": show,
    "/forgot-password": show, "/reset-password": show, "/auth/callback": show, "/pozvanka/abc": show,
    "/mfa": show, "/onboarding": to("/mfa"), "/invoices": to("/mfa"),
  },
  verified: {
    "/": show, "/login": to("/dashboard"), "/hlavica": to("/dashboard"), "/register": to("/dashboard"),
    "/forgot-password": to("/dashboard"), "/reset-password": show, "/auth/callback": show,
    "/pozvanka/abc": show, "/mfa": to("/dashboard"), "/onboarding": show, "/invoices": show,
  },
  needs_onboarding: {
    "/": show, "/login": to("/onboarding"), "/hlavica": to("/onboarding"), "/register": to("/onboarding"),
    "/forgot-password": to("/onboarding"), "/reset-password": show, "/auth/callback": show,
    "/pozvanka/abc": show, "/mfa": to("/onboarding"), "/onboarding": show, "/invoices": to("/onboarding"),
  },
  // Firma založená, ale bez karty: do aplikace až po dokončení platby.
  needs_payment: {
    "/": show, "/login": to("/onboarding"), "/hlavica": to("/onboarding"), "/register": to("/onboarding"),
    "/forgot-password": to("/onboarding"), "/reset-password": show, "/auth/callback": show,
    "/pozvanka/abc": show, "/mfa": to("/onboarding"), "/onboarding": show, "/invoices": to("/onboarding"),
  },
  member: {
    "/": show, "/login": to("/dashboard"), "/hlavica": to("/dashboard"), "/register": to("/dashboard"),
    "/forgot-password": to("/dashboard"), "/reset-password": show, "/auth/callback": show,
    "/pozvanka/abc": show, "/mfa": to("/dashboard"), "/onboarding": to("/dashboard"), "/invoices": show,
  },
};

describe("routeFor (tabulka P12)", () => {
  for (const [state, row] of Object.entries(table) as [AccessState, Record<string, RouteDecision>][]) {
    for (const [path, expected] of Object.entries(row)) {
      it(`${state} na ${path}`, () => {
        expect(routeFor(state, path)).toEqual(expected);
      });
    }
  }

  it("keeps the query of the page the visitor was heading to", () => {
    expect(routeFor("anonymous", "/invoices/payments", "?tab=open")).toEqual(
      to("/login?returnTo=%2Finvoices%2Fpayments%3Ftab%3Dopen"),
    );
  });
});

describe("pageKind", () => {
  it("classifies every workspace section as the application", () => {
    for (const path of ["/dashboard", "/customers/1", "/invoices", "/reminders", "/reports", "/settings"]) {
      expect(pageKind(path)).toBe("app");
    }
  });

  it("treats the R. Hlavica registration like registration", () => {
    expect(pageKind("/hlavica/registrace")).toBe("signup");
    expect(routeFor("anonymous", "/hlavica/registrace")).toEqual({ type: "show" });
    expect(routeFor("member", "/hlavica/registrace")).toEqual({ type: "redirect", to: "/dashboard" });
  });

  it("does not treat look-alike paths as login pages", () => {
    expect(pageKind("/loginx")).toBe("other");
    expect(pageKind("/hlavica/../dashboard")).toBe("other");
    expect(pageKind("/pozvanka")).toBe("other");
  });
});

describe("provoz Splatna", () => {
  it("is never shown without login and 2FA", () => {
    expect(routeFor("anonymous", "/provoz")).toEqual({ type: "redirect", to: "/login" });
    expect(routeFor("mfa_pending", "/provoz")).toEqual({ type: "redirect", to: "/mfa" });
    expect(routeFor("verified", "/provoz")).toEqual({ type: "show" });
  });
});
