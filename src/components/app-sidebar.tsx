"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Icon, type IconName } from "@/components/icons";
import { CompanyLogo } from "@/components/company-logo";

const items: { href: string; label: string; icon: IconName }[] = [
  { href: "/dashboard", label: "Přehled", icon: "dashboard" },
  { href: "/invoices", label: "Faktury", icon: "invoice" },
  { href: "/reports", label: "Reporty", icon: "chart" },
  { href: "/invoices/archive", label: "Archiv", icon: "document" },
  { href: "/reminders", label: "Upomínky", icon: "mail" },
  { href: "/settings", label: "Nastavení", icon: "settings" },
];

export function AppSidebar({ invoiceCount }: { invoiceCount?: number }) {
  const pathname = usePathname();
  async function signOut() {
    await fetch("/api/auth/logout", { method: "POST" });
    window.location.assign("/login");
  }
  return (
    <aside className="sidebar">
      <Link href="/dashboard" className="brand">
        <CompanyLogo className="sidebar-company-logo" />
      </Link>
      <nav className="sidebar-nav" aria-label="Hlavní navigace">
        <span className="nav-heading">Hlavní nabídka</span>
        {items.map(item => {
          const active = pathname === item.href || (
            item.href === "/invoices"
              ? pathname.startsWith("/invoices/") && !pathname.startsWith("/invoices/archive")
              : item.href !== "/dashboard" && pathname.startsWith(`${item.href}/`)
          );
          return <Link key={item.href} href={item.href} className={active ? "active" : ""}><span className="nav-symbol"><Icon name={item.icon}/></span><span>{item.label}</span>{item.href === "/invoices" && invoiceCount ? <em>{invoiceCount}</em> : null}</Link>;
        })}
      </nav>
      <div className="sidebar-bottom">
        <div className="user-card"><div className="avatar">ÚČ</div><div><strong>Účetní oddělení</strong><small>R. Hlavica s.r.o.</small></div><button type="button" onClick={signOut} aria-label="Odhlásit se" title="Odhlásit se"><Icon name="logout"/></button></div>
      </div>
    </aside>
  );
}

export function AppFrame({ children, invoiceCount }: { children: React.ReactNode; invoiceCount?: number }) {
  return <div className="app-shell"><AppSidebar invoiceCount={invoiceCount}/><main className="content section-page">{children}</main></div>;
}
