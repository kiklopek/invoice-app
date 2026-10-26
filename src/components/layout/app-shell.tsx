"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import {
  createContext,
  Fragment,
  useContext,
  useEffect,
  useRef,
  useState,
} from "react";
import { MobileHeaderSearch } from "./mobile-header-search";
import { CloseIcon } from "@/components/close-icon";
import {
  MobileHeaderProvider,
  MobileNotificationSlot,
  useSmallMobile,
} from "./mobile-header-slot";
import "./small-mobile-navigation.css";
import { WorkspaceTopbar } from "./workspace-topbar";
import { Icon, type IconName } from "@/components/icons";
import { CompanyLogo } from "@/components/company-logo";
import { RibbonMark } from "@/components/landing/landing-icons";
import workspaceStyles from "./workspace-shell.module.css";
import { AppBackground } from "./app-background";
import { EskoAssistant } from "@/components/esko/esko-assistant";
import { MobilePortraitGuard } from "./mobile-portrait-guard";
import { PopupFitter } from "@/components/popup-fitter";
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
import { EskoAssistantProvider, EskoNavigationButton, useEskoAssistant } from "@/components/esko/esko-context";
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
  { href: "/dashboard", label: "Nástěnka", icon: "home" },
  {
    href: "/invoices",
    label: "Faktury",
    icon: "file-invoice",
    children: [
      { href: "/invoices/import", label: "Importovat fakturu" },
      { href: "/invoices/create", label: "Vystavit fakturu" },
      { href: "/invoices/new", label: "Přidat ručně" },
      { href: "/invoices/archive", label: "Archiv faktur" },
    ],
  },
  {
    href: "/invoices/payments",
    label: "Platby",
    icon: "payment-card",
    children: [
      { href: "/invoices/payments/archive", label: "Historie a archiv" },
    ],
  },
  { href: "/reminders", label: "Upomínky", icon: "reminder" },
  { href: "/customers", label: "Zákazníci", icon: "users" },
  { href: "/reports", label: "Reporty", icon: "line-chart" },
  {
    href: "/settings",
    label: "Nastavení",
    icon: "settings",
    children: [
      { href: "/settings/email-template", label: "E-mailová šablona" },
      { href: "/predplatne", label: "Předplatné" },
    ],
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
  const smallMobile = useSmallMobile();
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const [eskoRequested, setEskoRequested] = useState(false);
  const { openAssistant, closeAssistant, open: eskoOpen } = useEskoAssistant();
  const mobileNavToggleRef = useRef<HTMLButtonElement>(null);
  const mobileNavPanelRef = useRef<HTMLDivElement>(null);
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
    const close = () => setMobileNavOpen(false);
    const mobile = window.matchMedia?.("(max-width: 767px)");
    const tablet = window.matchMedia?.("(max-width: 1023px)");
    mobile?.addEventListener("change", close);
    tablet?.addEventListener("change", close);
    return () => {
      mobile?.removeEventListener("change", close);
      tablet?.removeEventListener("change", close);
    };
  }, []);

  useEffect(() => {
    if (!mobileNavOpen) return;
    const scrollY = window.scrollY;
    const main = document.getElementById("obsah");
    const toggle =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : mobileNavToggleRef.current;
    const bar = document.querySelector<HTMLElement>(".mobile-navigation-bar");
    const bodyStyle = {
      position: document.body.style.position,
      top: document.body.style.top,
      width: document.body.style.width,
    };
    const focusableSelector = [
      "a[href]",
      "button:not([disabled])",
      "input:not([disabled])",
      "select:not([disabled])",
      "textarea:not([disabled])",
      '[tabindex]:not([tabindex="-1"])',
    ].join(",");
    const panel = mobileNavPanelRef.current;
    const focusable = () =>
      Array.from(
        panel?.querySelectorAll<HTMLElement>(focusableSelector) ?? [],
      ).filter((element) => element.getClientRects().length > 0);
    const closeOrTrapFocus = (event: KeyboardEvent) => {
      // Native confirmation dialogs own their focus and Escape while open.
      if (document.querySelector("dialog:modal")) return;
      if (event.key === "Escape") {
        event.preventDefault();
        setMobileNavOpen(false);
        return;
      }
      if (event.key !== "Tab") return;
      const controls = focusable();
      if (!controls.length) return;
      const first = controls[0];
      const last = controls[controls.length - 1];
      if (
        !panel?.contains(document.activeElement) ||
        document.activeElement === panel
      ) {
        event.preventDefault();
        first.focus({ preventScroll: true });
      } else if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    document.body.classList.add("mobile-navigation-lock");
    document.body.style.position = "fixed";
    document.body.style.top = `-${scrollY}px`;
    document.body.style.width = "100%";
    if (main) main.inert = true;
    if (bar) bar.inert = true;
    window.addEventListener("keydown", closeOrTrapFocus);
    // Let the browser apply the inert background before moving keyboard focus.
    let focusFrame = 0;
    const frame = window.requestAnimationFrame(() => {
      focusFrame = window.requestAnimationFrame(() => {
        (focusable()[0] ?? panel)?.focus({ preventScroll: true });
      });
    });
    return () => {
      document.body.classList.remove("mobile-navigation-lock");
      document.body.style.position = bodyStyle.position;
      document.body.style.top = bodyStyle.top;
      document.body.style.width = bodyStyle.width;
      if (main) main.inert = false;
      if (bar) bar.inert = false;
      window.cancelAnimationFrame(frame);
      window.cancelAnimationFrame(focusFrame);
      window.removeEventListener("keydown", closeOrTrapFocus);
      window.scrollTo(0, scrollY);
      toggle?.focus({ preventScroll: true });
    };
  }, [mobileNavOpen]);

  // Wait for the drawer's inert/scroll cleanup before opening a native modal.
  useEffect(() => {
    if (!eskoRequested || mobileNavOpen) return;
    const frame = requestAnimationFrame(() => {
      setEskoRequested(false);
      openAssistant(mobileNavToggleRef.current);
    });
    return () => cancelAnimationFrame(frame);
  }, [eskoRequested, mobileNavOpen, openAssistant]);
  const desktopEsko = <EskoNavigationButton onClick={event => openAssistant(event.currentTarget)} />;
  const mobileEsko = <EskoNavigationButton onClick={() => {
    setEskoRequested(true);
    setMobileNavOpen(false);
  }} />;

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
      window.location.replace("/");
    } catch (error) {
      setLogoutError(
        error instanceof Error ? error.message : "Odhlášení se nepodařilo.",
      );
      setSigningOut(false);
    }
  }
  const profilePanel = role && (
    <div className="mobile-navigation-profile">
      <div className="avatar">
        {profile ? profileInitials(profile.name, profile.email) : "…"}
      </div>
      <div>
        <strong>{profile?.name ?? "Uživatel"}</strong>
        <small>
          {profile?.companyName ?? ""}
          {profile && role ? (
            smallMobile ? (
              <span className="small-mobile-role">{roleNames[role]}</span>
            ) : (
              ` · ${roleNames[role]}`
            )
          ) : (
            ""
          )}
        </small>
      </div>
      <button
        type="button"
        className={workspaceStyles.logoutButton}
        title={signingOut ? "Odhlašuji…" : "Odhlásit se"}
        onClick={signOut}
        disabled={signingOut}
        aria-label={signingOut ? "Odhlašuji" : "Odhlásit se"}
      >
        <Icon name="logout" />
      </button>
    </div>
  );
  return (
    <>
      {/* Uzivatel klavesnice drive musel na KAZDE strance protabovat deset
        navigacnich odkazu a ucet, nez se dostal k obsahu. Odkaz je videt
        az pri zaostreni, takze mysi uzivatele nijak neruší. */}
      <a href="#obsah" className="skip-link">
        Přeskočit na obsah
      </a>
      <aside className="sidebar">
        <Link href={landingPageForRole(role)} className="brand">
          <RibbonMark size={30} />
          <strong>splatno</strong>
        </Link>
        <nav
          className="sidebar-nav desktop-navigation"
          data-role={role}
          aria-label="Hlavní navigace"
        >
          <span className="nav-heading">Hlavní nabídka</span>
          {visibleItems.map((item) => {
            const active = isActive(item.href);
            const selected =
              active &&
              !item.children?.some((child) => isChildActive(child.href));
            return (
              <div key={item.href} className="nav-item-group">
                <Link
                  href={item.href}
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
              <span className="small-mobile-wordmark">
                <RibbonMark size={25} />
                <strong>splatno</strong>
              </span>
              <CompanyLogo
                src={profile?.companyLogo}
                name={profile?.companyName}
                className="mobile-navigation-logo"
              />
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
            <div className="small-mobile-account-actions">
              <MobileHeaderSearch />
              <MobileNotificationSlot />
              <button
                type="button"
                className="small-mobile-avatar"
                aria-label="Otevřít účet a firmu"
                aria-expanded={mobileNavOpen}
                aria-controls="mobile-navigation-panel"
                onClick={() => { if (eskoOpen) closeAssistant(); setMobileNavOpen(true); }}
              >
                <span>
                  {profile ? profileInitials(profile.name, profile.email) : "…"}
                </span>
              </button>
            </div>
            <button
              ref={mobileNavToggleRef}
              type="button"
              className={`mobile-navigation-toggle ${mobileNavOpen ? "is-open" : ""}`}
              aria-label={
                mobileNavOpen ? "Zavřít navigaci" : "Otevřít navigaci"
              }
              aria-expanded={mobileNavOpen}
              aria-controls="mobile-navigation-panel"
              onClick={() => { if (!mobileNavOpen && eskoOpen) closeAssistant(); setMobileNavOpen(open => !open); }}
            >
              <span />
              <span />
              <span />
            </button>
          </div>
          {(smallMobile || mobileNavOpen) && (
            <div
              className="mobile-navigation-overlay"
              data-open={mobileNavOpen}
              inert={!mobileNavOpen}
            >
              <button
                type="button"
                className="mobile-navigation-backdrop"
                aria-label="Zavřít navigaci"
                onClick={() => setMobileNavOpen(false)}
              />
              <div
                ref={mobileNavPanelRef}
                id="mobile-navigation-panel"
                className="mobile-navigation-panel"
                role="dialog"
                aria-modal="true"
                tabIndex={-1}
                aria-label="Navigace aplikace"
                aria-hidden={!mobileNavOpen}
              >
                <div className="small-mobile-drawer-heading">
                  <Link
                    href={landingPageForRole(role)}
                    onClick={() => setMobileNavOpen(false)}
                  >
                    <RibbonMark size={25} />
                    <strong>splatno</strong>
                  </Link>
                  <button
                    type="button"
                    aria-label="Zavřít menu"
                    onClick={() => setMobileNavOpen(false)}
                  >
                    <CloseIcon />
                  </button>
                </div>
                <div className="mobile-navigation-panel-heading">
                  <span>Navigace</span>
                  <small>Vyberte část aplikace</small>
                </div>
                {smallMobile && profilePanel}
                <nav
                  className="mobile-navigation-links"
                  aria-label="Mobilní navigace"
                >
                  {visibleItems.map((item) => {
                    const active = isActive(item.href);
                    const selected =
                      active &&
                      !item.children?.some((child) =>
                        isChildActive(child.href),
                      );
                    return (
                      <Fragment key={item.href}>
                        <Link
                          href={item.href}
                          aria-current={
                            pathname === item.href ? "page" : undefined
                          }
                          className={
                            selected ? "active" : ""
                          }
                          data-settings={item.href === "/settings" || undefined}
                          onClick={() => setMobileNavOpen(false)}
                        >
                          <span className="nav-symbol">
                            <Icon name={item.icon} />
                          </span>
                          <span>{item.label}</span>
                          {item.href === "/invoices" && invoiceCount ? (
                            <em title={String(invoiceCount)}>
                              {smallMobile && invoiceCount > 999
                                ? "999+"
                                : invoiceCount}
                            </em>
                          ) : null}
                        </Link>
                        {active && item.children && item.children.length > 0 ? (
                          <div className="mobile-navigation-subitems">
                            {item.children.map((child) => (
                              <Link
                                key={child.href}
                                href={child.href}
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
                {!smallMobile && profilePanel}
                {logoutError && (
                  <p className="mobile-navigation-error" role="alert">
                    {logoutError}
                  </p>
                )}
                <div className={workspaceStyles.mobileEskoFooter}>{mobileEsko}</div>
              </div>
            </div>
          )}
        </div>
        <div className="sidebar-bottom">
          {logoutError && (
            <p className="sidebar-logout-error" role="alert">
              {logoutError}
            </p>
          )}
          <div className={workspaceStyles.desktopEskoFooter}>{desktopEsko}</div>
          <div className="user-card">
            <div className="avatar">
              {profile?.companyLogo ? (
                <CompanyLogo
                  src={profile.companyLogo}
                  name={profile.companyName}
                  className="dashboard-profile-logo"
                />
              ) : profile ? (
                profileInitials(profile.name, profile.email)
              ) : (
                "…"
              )}
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
              className={workspaceStyles.logoutButton}
              onClick={signOut}
              disabled={signingOut}
              aria-label={signingOut ? "Odhlašuji" : "Odhlásit se"}
              title={signingOut ? "Odhlašuji…" : "Odhlásit se"}
            >
              <Icon name="logout" />
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
  const pathname = usePathname();
  const backgroundVariant =
    pathname === "/invoices"
      ? "invoices"
      : pathname.startsWith("/invoices/payments/archive")
        ? "payment-archive"
        : pathname.startsWith("/invoices/payments")
          ? "payments"
          : pathname === "/invoices/new"
            ? "compose"
            : pathname === "/invoices/import"
              ? "import"
              : pathname === "/invoices/archive"
                ? "invoice-archive"
                : pathname.startsWith("/invoices/")
                  ? "invoice-detail"
                  : pathname.split("/")[1] || "dashboard";
  return (
    <AccessProfileProvider profile={initialProfile}>
      <EskoAssistantProvider>
      <MobileHeaderProvider>
        <InvoiceCountContext.Provider value={setInvoiceCount}>
          <div className={`app-shell ${workspaceStyles.shell}`}>
            <AppBackground variant={backgroundVariant} />
            <AppSidebar
              invoiceCount={invoiceCount}
              initialProfile={initialProfile}
            />
            {children}
            <EskoAssistant />
            <MobilePortraitGuard />
            {/* Otevírací okna (data-popup) se drží uvnitř obrazovky. */}
            <PopupFitter />
          </div>
        </InvoiceCountContext.Provider>
      </MobileHeaderProvider>
      </EskoAssistantProvider>
    </AccessProfileProvider>
  );
}

export function AppFrame({
  children,
  invoiceCount,
  className = "content section-page",
  topbar,
}: {
  children: React.ReactNode;
  invoiceCount?: number;
  className?: string;
  topbar?: React.ReactNode;
}) {
  const setInvoiceCount = useContext(InvoiceCountContext);
  useEffect(() => {
    if (invoiceCount !== undefined) setInvoiceCount?.(invoiceCount);
  }, [invoiceCount, setInvoiceCount]);
  return (
    <main id="obsah" className={className}>
      {topbar === undefined ? <WorkspaceTopbar /> : topbar}
      {children}
    </main>
  );
}
