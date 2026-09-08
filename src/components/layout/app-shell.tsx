"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { createContext, useContext, useEffect, useState } from "react";
import { Icon, type IconName } from "@/components/icons";
import { CompanyLogo } from "@/components/company-logo";
import { confirmAction } from "@/lib/confirm-action";
import { signOutCurrentSession } from "@/lib/sign-out";
import { canAccessPage, landingPageForRole } from "@/lib/role-access";
import { AccessProfileProvider, useAccessProfile, type AccessProfile } from "@/lib/use-access-role";
import { profileInitials } from "@/lib/user-display";
import "./mobile-navigation.css";

const items: { href: string; label: string; icon: IconName }[] = [
  { href: "/dashboard", label: "Přehled", icon: "dashboard" },
  { href: "/invoices", label: "Faktury", icon: "invoice" },
  { href: "/reports", label: "Reporty", icon: "chart" },
  { href: "/invoices/archive", label: "Archiv", icon: "archive" },
  { href: "/reminders", label: "Upomínky", icon: "mail" },
  { href: "/settings", label: "Nastavení", icon: "settings" },
];
const viewerItems = items.filter(item => ["/dashboard", "/invoices", "/reports"].includes(item.href));

export function AppSidebar({ invoiceCount, initialProfile }: { invoiceCount?: number; initialProfile: AccessProfile | null }) {
  const pathname = usePathname();
  const router = useRouter();
  const profile = useAccessProfile(initialProfile);
  const role = profile?.role ?? null;
  const [signingOut, setSigningOut] = useState(false);
  const [logoutError, setLogoutError] = useState<string | null>(null);

  useEffect(() => {
    if (role && !canAccessPage(role, pathname)) router.replace(landingPageForRole(role));
  }, [pathname, role, router]);

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
      setLogoutError(error instanceof Error ? error.message : "Odhlášení se nepodařilo.");
      setSigningOut(false);
    }
  }
  return (
    <aside className="sidebar">
      <Link href={landingPageForRole(role)} className="brand">
        <CompanyLogo className="sidebar-company-logo" />
      </Link>
      <nav className="sidebar-nav mobile-navigation" data-role={role} aria-label="Hlavní navigace">
        <span className="nav-heading">Hlavní nabídka</span>
        {(role === "viewer" ? viewerItems : role ? items : []).map(item => {
          const active = pathname === item.href || (
            item.href === "/invoices"
              ? pathname.startsWith("/invoices/") && !pathname.startsWith("/invoices/archive")
              : item.href !== "/dashboard" && pathname.startsWith(`${item.href}/`)
          );
          return <Link key={item.href} href={item.href} prefetch={true} aria-current={active ? "page" : undefined} className={[active ? "active" : "", item.href === "/dashboard" ? "nav-primary" : ""].filter(Boolean).join(" ")}><span className="nav-symbol"><Icon name={item.icon}/></span><span>{item.label}</span>{item.href === "/invoices" && invoiceCount ? <em>{invoiceCount}</em> : null}</Link>;
        })}
        {role && <button type="button" className="nav-logout" onClick={signOut} disabled={signingOut} aria-label={signingOut ? "Odhlašuji" : "Odhlásit se"} title={signingOut ? "Odhlašuji…" : "Odhlásit se"}><span className="nav-symbol"><Icon name="logout"/></span><span>{signingOut ? "Odhlašuji…" : "Odhlásit"}</span></button>}
      </nav>
      <div className="sidebar-bottom">
        {logoutError && <p className="sidebar-logout-error" role="alert">{logoutError}</p>}
        <div className="user-card">
          <div className="avatar">{profile ? profileInitials(profile.name, profile.email) : "…"}</div>
          <div className="user-card-details" title={profile ? `${profile.name}\n${profile.companyName}` : undefined}>
            <strong>{profile?.name ?? "Načítám uživatele…"}</strong>
            <small>{profile?.companyName ?? ""}</small>
          </div>
          <button type="button" onClick={signOut} disabled={signingOut} aria-label={signingOut ? "Odhlašuji" : "Odhlásit se"} title={signingOut ? "Odhlašuji…" : "Odhlásit se"}>
            <Icon name="logout"/><span>{signingOut ? "Odhlašuji…" : "Odhlásit"}</span>
          </button>
        </div>
      </div>
    </aside>
  );
}

const InvoiceCountContext = createContext<((count: number) => void) | null>(null);

export function AppShell({ children, initialProfile }: { children: React.ReactNode; initialProfile: AccessProfile | null }) {
  const [invoiceCount, setInvoiceCount] = useState<number>();
  return <AccessProfileProvider profile={initialProfile}><InvoiceCountContext.Provider value={setInvoiceCount}><div className="app-shell"><AppSidebar invoiceCount={invoiceCount} initialProfile={initialProfile}/>{children}</div></InvoiceCountContext.Provider></AccessProfileProvider>;
}

export function AppFrame({ children, invoiceCount, className = "content section-page" }: { children: React.ReactNode; invoiceCount?: number; className?: string }) {
  const setInvoiceCount = useContext(InvoiceCountContext);
  useEffect(() => {
    if (invoiceCount !== undefined) setInvoiceCount?.(invoiceCount);
  }, [invoiceCount, setInvoiceCount]);
  return <main className={className}>{children}</main>;
}
