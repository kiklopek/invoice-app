// @vitest-environment jsdom
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { EskoAssistantProvider } from "@/components/esko/esko-context";
import { AppSidebar } from "./app-shell";
import { canAccessPage, type AccessRole } from "@/lib/role-access";

const state = vi.hoisted(() => ({
  pathname: "/dashboard",
  replace: vi.fn(),
  confirm: vi.fn(),
  signOut: vi.fn(),
}));
vi.mock("next/navigation", () => ({
  usePathname: () => state.pathname,
  useRouter: () => ({ replace: state.replace }),
}));
vi.mock("next/link", () => ({
  default: ({
    children,
    ...props
  }: React.AnchorHTMLAttributes<HTMLAnchorElement>) => (
    <a {...props}>{children}</a>
  ),
}));
vi.mock("@/components/company-logo", () => ({
  CompanyLogo: () => <span>Logo firmy</span>,
}));
vi.mock("@/components/esko/esko-assistant", () => ({
  EskoAssistant: () => null,
}));
vi.mock("@/components/popup-fitter", () => ({ PopupFitter: () => null }));
vi.mock("@/lib/confirm-action", () => ({ confirmAction: state.confirm }));
vi.mock("@/lib/sign-out", () => ({ signOutCurrentSession: state.signOut }));

let root: Root;
let container: HTMLDivElement;
beforeEach(() => {
  vi.stubGlobal("React", React);
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  state.pathname = "/dashboard";
  state.replace.mockReset();
  state.signOut.mockReset();
  state.confirm.mockReset().mockResolvedValue(false);
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});
async function render(role: AccessRole = "admin", path = "/dashboard") {
  state.pathname = path;
  await act(async () =>
    root.render(
      <EskoAssistantProvider><AppSidebar
        initialProfile={{
          role,
          name: "Anna Nováková",
          email: "anna@example.invalid",
          companyName: "Ukázková firma",
        }}
        invoiceCount={35}
      /></EskoAssistantProvider>,
    ),
  );
}
const mainLinks = () =>
  Array.from(
    container.querySelectorAll<HTMLAnchorElement>(
      ".desktop-navigation .nav-item-group > a",
    ),
  );

describe("shared workspace navigation", () => {
  it.each([
    "/dashboard",
    "/invoices",
    "/invoices/payments/archive",
    "/reminders",
    "/customers",
    "/reports",
    "/settings/email-template",
    "/predplatne",
  ])("keeps one set of top-level destinations on %s", async (path) => {
    await render("admin", path);
    expect(mainLinks().map((a) => a.getAttribute("href"))).toEqual([
      "/dashboard",
      "/invoices",
      "/invoices/payments",
      "/reminders",
      "/customers",
      "/reports",
      "/settings",
    ]);
    expect(container.querySelector(".brand")?.textContent).toBe("splatno");
    expect(container.querySelector(".user-card")?.textContent).toContain(
      "Anna Nováková",
    );
    expect(container.querySelectorAll(".user-card")).toHaveLength(1);
  });
  it.each(["viewer", "accounting", "admin"] as const)(
    "preserves %s route restrictions for parent and child links",
    async (role) => {
      await render(role, "/invoices");
      const links = Array.from(
        container.querySelectorAll<HTMLAnchorElement>(".desktop-navigation a"),
      );
      expect(
        links.every((a) => canAccessPage(role, a.getAttribute("href")!)),
      ).toBe(true);
      const invoiceChildren = [
        "/invoices/import",
        "/invoices/create",
        "/invoices/new",
        "/invoices/archive",
      ];
      expect(
        Array.from(
          container.querySelectorAll<HTMLAnchorElement>(
            ".desktop-navigation .nav-subitems a",
          ),
          (link) => link.getAttribute("href"),
        ),
      ).toEqual(invoiceChildren.filter((href) => canAccessPage(role, href)));
      if (role === "viewer")
        expect(mainLinks().map((a) => a.textContent)).toEqual([
          "Nástěnka",
          "Faktury35",
          "Zákazníci",
          "Reporty",
        ]);
    },
  );
  it("belongs to payments rather than invoices on a nested payment route", async () => {
    await render("admin", "/invoices/payments/archive");
    expect(
      container
        .querySelector('.desktop-navigation a[href="/invoices"]')
        ?.classList.contains("active"),
    ).toBe(false);
    expect(
      container
        .querySelector(
          '.desktop-navigation a[href="/invoices/payments/archive"]',
        )
        ?.getAttribute("aria-current"),
    ).toBe("page");
    expect(
      container.querySelector(".mobile-navigation-current strong")?.textContent,
    ).toBe("Platby");
  });
  it("shows a dedicated sign-out icon instead of an account menu", async () => {
    await render();
    const card = container.querySelector(".user-card")!;
    const button = card.querySelector<HTMLButtonElement>('button[aria-label="Odhlásit se"]')!;
    expect(button).not.toBeNull();
    expect(button.querySelector("svg")).not.toBeNull();
    expect(button.textContent).toBe("");
    expect(button.title).toBe("Odhlásit se");
    expect(card.querySelector("details, summary, a")).toBeNull();
    expect(container.querySelector('.desktop-navigation a[href="/settings"]')).not.toBeNull();
  });
  it("retains the existing sign-out confirmation and does not log out when declined", async () => {
    await render();
    await act(async () =>
      container.querySelector<HTMLButtonElement>('.user-card button[aria-label="Odhlásit se"]')!.click(),
    );
    expect(state.confirm).toHaveBeenCalledOnce();
    expect(state.signOut).not.toHaveBeenCalled();
  });
  it("reports sign-out failure and allows retrying", async () => {
    state.confirm.mockResolvedValue(true);
    state.signOut.mockRejectedValue(new Error("Odhlášení se nepodařilo."));
    await render();
    await act(async () => container.querySelector<HTMLButtonElement>('.user-card button[aria-label="Odhlásit se"]')!.click());
    expect(state.signOut).toHaveBeenCalledOnce();
    expect(container.querySelector('.sidebar-logout-error')?.textContent).toBe("Odhlášení se nepodařilo.");
    expect(container.querySelector<HTMLButtonElement>('.user-card button[aria-label="Odhlásit se"]')!.disabled).toBe(false);
  });
});
