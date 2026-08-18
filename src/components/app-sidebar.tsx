"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { Icon, type IconName } from "@/components/icons";
import { CompanyLogo } from "@/components/company-logo";
import { signOutCurrentSession } from "@/lib/sign-out";
import { canAccessPage } from "@/lib/role-access";
import { useAccessRole } from "@/lib/use-access-role";

const items: { href: string; label: string; icon: IconName }[] = [
  { href: "/dashboard", label: "Přehled", icon: "dashboard" },
  { href: "/invoices", label: "Faktury", icon: "invoice" },
  { href: "/reports", label: "Reporty", icon: "chart" },
  { href: "/invoices/archive", label: "Archiv", icon: "document" },
  { href: "/reminders", label: "Upomínky", icon: "mail" },
  { href: "/settings", label: "Nastavení", icon: "settings" },
];
const viewerItems = items.filter(item => ["/dashboard", "/reports", "/invoices/archive"].includes(item.href));

export function AppSidebar({ invoiceCount }: { invoiceCount?: number }) {
  const pathname = usePathname();
  const router = useRouter();
  const role = useAccessRole();
  const [signingOut, setSigningOut] = useState(false);
  const [logoutError, setLogoutError] = useState<string | null>(null);

  useEffect(() => {
    if (role === "viewer" && !canAccessPage(role, pathname)) router.replace("/dashboard");
  }, [pathname, role, router]);

  async function signOut() {
    if (signingOut) return;
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
      <Link href="/dashboard" className="brand">
        <CompanyLogo className="sidebar-company-logo" />
      </Link>
      <nav className="sidebar-nav" aria-label="Hlavní navigace">
        <span className="nav-heading">Hlavní nabídka</span>
        {(role === "accounting" || role === "admin" ? items : viewerItems).map(item => {
          const active = pathname === item.href || (
            item.href === "/invoices"
              ? pathname.startsWith("/invoices/") && !pathname.startsWith("/invoices/archive")
              : item.href !== "/dashboard" && pathname.startsWith(`${item.href}/`)
          );
          return <Link key={item.href} href={item.href} className={active ? "active" : ""}><span className="nav-symbol"><Icon name={item.icon}/></span><span>{item.label}</span>{item.href === "/invoices" && invoiceCount ? <em>{invoiceCount}</em> : null}</Link>;
        })}
      </nav>
      <div className="sidebar-bottom">
        {logoutError && <p className="sidebar-logout-error" role="alert">{logoutError}</p>}
        <div className="user-card"><div className="avatar">ÚČ</div><div><strong>Účetní oddělení</strong><small>R. Hlavica s.r.o.</small></div><button type="button" onClick={signOut} disabled={signingOut} aria-label={signingOut ? "Odhlašuji" : "Odhlásit se"} title={signingOut ? "Odhlašuji…" : "Odhlásit se"}><Icon name="logout"/></button></div>
      </div>
    </aside>
  );
}

export function AppFrame({ children, invoiceCount }: { children: React.ReactNode; invoiceCount?: number }) {
  return <div className="app-shell"><AppSidebar invoiceCount={invoiceCount}/><main className="content section-page">{children}</main></div>;
}
