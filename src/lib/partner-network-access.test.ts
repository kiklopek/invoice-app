import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { APP_SECTIONS, pageKind, routeFor } from "./access-state";
import { canAccessPage, canManageNetwork, canViewNetwork } from "./role-access";

const source = (path: string) => readFileSync(join(process.cwd(), path), "utf8");

// Splatno Síť: kdo smí co. Bilance s partnery jsou finanční data jiné firmy,
// takže čtenář je nevidí vůbec; propojení a pozvánky jsou závazek za firmu,
// takže je smí dělat jen administrátor.
describe("Splatno Síť – role a přístup", () => {
  it("lets accounting and admin read the network, but only admin manage it", () => {
    expect(canViewNetwork("admin")).toBe(true);
    expect(canViewNetwork("accounting")).toBe(true);
    expect(canViewNetwork("viewer")).toBe(false);
    expect(canViewNetwork(null)).toBe(false);
    expect(canManageNetwork("admin")).toBe(true);
    expect(canManageNetwork("accounting")).toBe(false);
    expect(canManageNetwork("viewer")).toBe(false);
  });

  it("keeps readers out of every network page", () => {
    for (const path of ["/partneri", "/partneri/prijate", "/partneri/0b5f6a8e-2c39-4a8e-9a77-3a3b0d8a2f10"]) {
      expect(canAccessPage("viewer", path), path).toBe(false);
      expect(canAccessPage("accounting", path), path).toBe(true);
    }
  });

  it("treats /partneri as an application section behind login and the proxy", () => {
    expect(APP_SECTIONS).toContain("/partneri");
    expect(pageKind("/partneri/prijate")).toBe("app");
    expect(routeFor("anonymous", "/partneri")).toEqual({ type: "redirect", to: "/login?returnTo=%2Fpartneri" });
    expect(source("src/proxy.ts")).toContain('"/partneri/:path*"');
  });

  it("shows the public invitation link to anyone and lets a stale session sign out", () => {
    expect(pageKind("/pripojeni/abc")).toBe("invitation");
    expect(pageKind("/pripojeni")).toBe("other");
    expect(routeFor("anonymous", "/pripojeni/abc")).toEqual({ type: "show" });
    expect(routeFor("member", "/pripojeni/abc")).toEqual({ type: "show" });
    expect(routeFor("needs_onboarding", "/pripojeni/abc")).toEqual({ type: "show" });
    expect(source("src/proxy.ts")).toContain('"/pripojeni/:path*"');
  });

  it("gates every network route by the network predicates, never by the invoice ones", () => {
    const reads = [
      "src/lib/partners-page-data.ts",
      "src/app/api/partners/flags/route.ts",
      "src/app/api/partners/flags/[id]/route.ts",
      "src/app/api/partners/invoices/[invoiceId]/pdf/route.ts",
      "src/app/api/invoices/[id]/network/route.ts",
    ];
    for (const path of reads) expect(source(path), path).toContain("canViewNetwork(");
    const manages = [
      "src/app/api/partners/route.ts",
      "src/app/api/partners/lookup/route.ts",
      "src/app/api/partners/[id]/route.ts",
      "src/app/api/partners/invitations/route.ts",
      "src/app/api/network-invitations/[token]/route.ts",
    ];
    for (const path of manages) expect(source(path), path).toContain("canManageNetwork(");
  });

  it("never lets a request choose the organization it acts for", () => {
    for (const path of [
      "src/app/api/partners/route.ts",
      "src/app/api/partners/[id]/route.ts",
      "src/app/api/partners/flags/route.ts",
      "src/app/api/partners/flags/[id]/route.ts",
      "src/app/api/network-invitations/[token]/route.ts",
      "src/lib/partners-page-data.ts",
      "src/lib/network-invitation-server.ts",
    ]) {
      const code = source(path);
      expect(code, path).not.toMatch(/target_org:\s*(body|params|searchParams)/);
      expect(code, path).toContain(".membership.organization_id");
    }
  });
});
