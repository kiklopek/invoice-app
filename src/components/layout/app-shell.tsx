"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import {
  createContext,
  Fragment,
  useContext,
  useEffect,
  useState,
} from "react";
import { Icon, type IconName } from "@/components/icons";
import { CompanyLogo } from "@/components/company-logo";
import { confirmAction } from "@/lib/confirm-action";
import { signOutCurrentSession } from "@/lib/sign-out";
import {
  canAccessPage,
  landingPageForRole,
  roleNames,
  type AccessRole,
} from "@/lib/role-access";
import {
  AccessProfileProvider,
  useAccessProfile,
  type AccessProfile,
} from "@/lib/use-access-role";
import { profileInitials } from "@/lib/user-display";
import "./mobile-navigation.css";

type NavChild = { href: string; label: string };
type NavItem = {
  href: string;
  label: string;
  icon: IconName;
  children?: NavChild[];
};

// Faktury and Platby used to be three flat, equally-weighted top-level
// entries (Faktury, Bankovní platby, Archiv) even though Archiv is really
// just another view of Faktury. Grouping them here means a new person sees
// two sections instead of guessing which of three unrelated-looking links
// holds the thing they want.
const items: NavItem[] = [
  { href: "/dashboard", label: "Přehled", icon: "dashboard" },
  {
    href: "/invoices",
    label: "Faktury",
    icon: "invoice",
    children: [
      { href: "/invoices/new", label: "Přidat ručně" },
      { href: "/invoices/import", label: "Importovat fakturu" },
      { href: "/invoices/archive", label: "Archiv faktur" },
    ],
  },
  {
    href: "/invoices/payments",
    label: "Platby",
    icon: "bank",
    children: [
      { href: "/invoices/payments/archive", label: "Historie a archiv" },
    ],
  },
  { href: "/customers", label: "Zákazníci", icon: "users" },
  { href: "/reports", label: "Reporty", icon: "chart" },
  {
    href: "/settings",
    label: "Nastavení",
    icon: "settings",
    children: [{ href: "/reminders", label: "Upomínky a šablony" }],
  },
];

// Visibility is derived straight from canAccessPage -- the same function that
// gates a direct page load -- instead of a second, separately maintained
// allowlist. A role that cannot open a route no longer has any way to end up
// with a nav item (parent or child) that dead-ends it.
function visibleNavForRole(role: AccessRole | null): NavItem[] {
  if (!role) return [];
  return items
    .filter((item) => canAccessPage(role, item.href))
    .map((item) => ({
      ...item,
      children: item.children?.filter((child) =>
        canAccessPage(role, child.href),
      ),
    }));
}

export function AppSidebar({
  invoiceCount,
  initialProfile,
}: {
  invoiceCount?: number;
  initialProfile: AccessProfile | null;
}) {
  const pathname = usePathname();
  const router = useRouter();
  const profile = useAccessProfile(initialProfile);
  const role = profile?.role ?? null;
  const [signingOut, setSigningOut] = useState(false);
  const [logoutError, setLogoutError] = useState<string | null>(null);
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const visibleItems = visibleNavForRole(role);
  const isChildActive = (href: string) =>
    pathname === href || pathname.startsWith(`${href}/`);
  // A nested route belongs to its top-level item UNLESS some other top-level
  // item's own href is a more specific prefix of it -- e.g. "/invoices/payments"
  // claims "/invoices/payments/archive" away from "Faktury" (href "/invoices")
  // even though the string "/invoices/" is technically a prefix of both. This
  // replaces what used to be two routes hardcoded by name inside the check.
  const isActive = (href: string) => {
    const item = visibleItems.find((candidate) => candidate.href === href);
    if (item?.children?.some((child) => isChildActive(child.href))) return true;
    if (pathname === href) return true;
    if (href === "/dashboard" || !pathname.startsWith(`${href}/`)) return false;
    return !visibleItems.some(
      (other) =>
        other.href !== href &&
        other.href.startsWith(`${href}/`) &&
        (pathname === other.href || pathname.startsWith(`${other.href}/`)),
    );
  };
  const activeItem = visibleItems.find((item) => isActive(item.href));

  useEffect(() => {
    if (role && !canAccessPage(role, pathname))
      router.replace(landingPageForRole(role));
  }, [pathname, role, router]);

  useEffect(() => {
    setMobileNavOpen(false);
    document.body.classList.remove("mobile-navigation-lock");
  }, [pathname]);

  useEffect(() => {
    if (!mobileNavOpen) return;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setMobileNavOpen(false);
    };
    document.body.classList.add("mobile-navigation-lock");
    window.addEventListener("keydown", closeOnEscape);
    return () => {
      document.body.classList.remove("mobile-navigation-lock");
      window.removeEventListener("keydown", closeOnEscape);
    };
  }, [mobileNavOpen]);

  async function signOut() {
    if (signingOut) return;
    const confirmed = await confirmAction({
      title: "Opravdu se chcete odhlásit?",
      description: "Pro návrat do aplikace se budete muset znovu přihlásit.",
      confirmLabel: "Odhlásit se",
    });
    if (!confirmed) return;
    setSigningOut(true);
    setLogoutError(null);
    try {
      await signOutCurrentSession();
      window.location.replace("/login");
    } catch (error) {
      setLogoutError(
        error instanceof Error ? error.message : "Odhlášení se nepodařilo.",
      );
      setSigningOut(false);
    }
  }
  return (
    <>
    {/* Uzivatel klavesnice drive musel na KAZDE strance protabovat deset
        navigacnich odkazu a ucet, nez se dostal k obsahu. Odkaz je videt
        az pri zaostreni, takze mysi uzivatele nijak neruší. */}
    <a href="#obsah" className="skip-link">Přeskočit na obsah</a>
    <aside className="sidebar">
      <Link href={landingPageForRole(role)} className="brand">
        <CompanyLogo className="sidebar-company-logo" />
      </Link>
      <nav
        className="sidebar-nav desktop-navigation"
        data-role={role}
        aria-label="Hlavní navigace"
      >
        <span className="nav-heading">Hlavní nabídka</span>
        {visibleItems.map((item) => {
          const active = isActive(item.href);
          const selected = active && !item.children?.some((child) => isChildActive(child.href));
          return (
            <div key={item.href} className="nav-item-group">
              <Link
                href={item.href}
                prefetch={true}
                aria-current={pathname === item.href ? "page" : undefined}
                className={[
                  selected ? "active" : "",
                  item.href === "/dashboard" ? "nav-primary" : "",
                ]
                  .filter(Boolean)
                  .join(" ")}
              >
                <span className="nav-symbol">
                  <Icon name={item.icon} />
                </span>
                <span>{item.label}</span>
                {item.href === "/invoices" && invoiceCount ? (
                  <em>{invoiceCount}</em>
                ) : null}
              </Link>
              {active && item.children && item.children.length > 0 ? (
                <div className="nav-subitems">
                  {item.children.map((child) => (
                    <Link
                      key={child.href}
                      href={child.href}
                      prefetch={true}
                      aria-current={
                        isChildActive(child.href) ? "page" : undefined
                      }
                      className={isChildActive(child.href) ? "active" : ""}
                    >
                      {child.label}
                    </Link>
                  ))}
                </div>
              ) : null}
            </div>
          );
        })}
      </nav>
      <div className="mobile-navigation-shell">
        <div className="mobile-navigation-bar">
          <Link
            href={landingPageForRole(role)}
            className="mobile-navigation-brand"
            aria-label="Přejít na přehled"
          >
            <CompanyLogo className="mobile-navigation-logo" />
          </Link>
          <div className="mobile-navigation-current">
            {activeItem && (
              <span>
                <Icon name={activeItem.icon} />
              </span>
            )}
            <div>
              <small>Aktuální sekce</small>
              <strong>{activeItem?.label ?? "Navigace"}</strong>
            </div>
          </div>
          <button
            type="button"
            className={`mobile-navigation-toggle ${mobileNavOpen ? "is-open" : ""}`}
            aria-label={mobileNavOpen ? "Zavřít navigaci" : "Otevřít navigaci"}
            aria-expanded={mobileNavOpen}
            aria-controls="mobile-navigation-panel"
            onClick={() => setMobileNavOpen((open) => !open)}
          >
            <span />
            <span />
            <span />
          </button>
        </div>
        {mobileNavOpen && (
          <>
            <button
              type="button"
              className="mobile-navigation-backdrop"
              aria-label="Zavřít navigaci"
              onClick={() => setMobileNavOpen(false)}
            />
            <div
              id="mobile-navigation-panel"
              className="mobile-navigation-panel"
            >
              <div className="mobile-navigation-panel-heading">
                <span>Navigace</span>
                <small>Vyberte část aplikace</small>
              </div>
              <nav
                className="mobile-navigation-links"
                aria-label="Mobilní navigace"
              >
                {visibleItems.map((item) => {
                  const active = isActive(item.href);
                  const selected = active && !item.children?.some((child) => isChildActive(child.href));
                  return (
                    <Fragment key={item.href}>
                      <Link
                        href={item.href}
                        prefetch={true}
                        aria-current={
                          pathname === item.href ? "page" : undefined
                        }
                        className={selected ? "active" : ""}
                        onClick={() => setMobileNavOpen(false)}
                      >
                        <span className="nav-symbol">
                          <Icon name={item.icon} />
                        </span>
                        <span>{item.label}</span>
                        {item.href === "/invoices" && invoiceCount ? (
                          <em>{invoiceCount}</em>
                        ) : null}
                      </Link>
                      {active && item.children && item.children.length > 0 ? (
                        <div className="mobile-navigation-subitems">
                          {item.children.map((child) => (
                            <Link
                              key={child.href}
                              href={child.href}
                              prefetch={true}
                              aria-current={
                                isChildActive(child.href) ? "page" : undefined
                              }
                              className={
                                isChildActive(child.href) ? "active" : ""
                              }
                              onClick={() => setMobileNavOpen(false)}
                            >
                              {child.label}
                            </Link>
                          ))}
                        </div>
                      ) : null}
                    </Fragment>
                  );
                })}
              </nav>
              {role && (
                <div className="mobile-navigation-profile">
                  <div className="avatar">
                    {profile
                      ? profileInitials(profile.name, profile.email)
                      : "…"}
                  </div>
                  <div>
                    <strong>{profile?.name ?? "Uživatel"}</strong>
                    <small>
                      {profile?.companyName ?? ""}
                      {profile && role ? ` · ${roleNames[role]}` : ""}
                    </small>
                  </div>
                  <button
                    type="button"
                    onClick={signOut}
                    disabled={signingOut}
                    aria-label={signingOut ? "Odhlašuji" : "Odhlásit se"}
                  >
                    <Icon name="logout" />
                  </button>
                </div>
              )}
              {logoutError && (
                <p className="mobile-navigation-error" role="alert">
                  {logoutError}
                </p>
              )}
            </div>
          </>
        )}
      </div>
      <div className="sidebar-bottom">
        {logoutError && (
          <p className="sidebar-logout-error" role="alert">
            {logoutError}
          </p>
        )}
        <div className="user-card">
          <div className="avatar">
            {profile ? profileInitials(profile.name, profile.email) : "…"}
          </div>
          <div
            className="user-card-details"
            title={
              profile ? `${profile.name}\n${profile.companyName}` : undefined
            }
          >
            <strong>{profile?.name ?? "Načítám uživatele…"}</strong>
            <small>
              {profile?.companyName ?? ""}
              {profile && role ? ` · ${roleNames[role]}` : ""}
            </small>
          </div>
          <button
            type="button"
            onClick={signOut}
            disabled={signingOut}
            aria-label={signingOut ? "Odhlašuji" : "Odhlásit se"}
            title={signingOut ? "Odhlašuji…" : "Odhlásit se"}
          >
            <Icon name="logout" />
            <span>{signingOut ? "Odhlašuji…" : "Odhlásit"}</span>
          </button>
        </div>
      </div>
    </aside>
    </>
  );
}

const InvoiceCountContext = createContext<((count: number) => void) | null>(
  null,
);

export function AppShell({
  children,
  initialProfile,
}: {
  children: React.ReactNode;
  initialProfile: AccessProfile | null;
}) {
  const [invoiceCount, setInvoiceCount] = useState<number>();
  return (
    <AccessProfileProvider profile={initialProfile}>
      <InvoiceCountContext.Provider value={setInvoiceCount}>
        <div className="app-shell">
          <AppSidebar
            invoiceCount={invoiceCount}
            initialProfile={initialProfile}
          />
          {children}
        </div>
      </InvoiceCountContext.Provider>
    </AccessProfileProvider>
  );
}

export function AppFrame({
  children,
  invoiceCount,
  className = "content section-page",
}: {
  children: React.ReactNode;
  invoiceCount?: number;
  className?: string;
}) {
  const setInvoiceCount = useContext(InvoiceCountContext);
  useEffect(() => {
    if (invoiceCount !== undefined) setInvoiceCount?.(invoiceCount);
  }, [invoiceCount, setInvoiceCount]);
  return <main id="obsah" className={className}>{children}</main>;
}
