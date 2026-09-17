"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

// Company/members (/settings) and reminder policies/templates (/reminders) are
// two separate routes/components for now (merging them risks a much larger,
// riskier refactor for little gain) — this bar just makes it visually obvious
// they're both "Nastavení", so an admin looking for reminder templates doesn't
// have to already know they live under a differently-named nav item.
const tabs = [
  { href: "/settings", label: "Firma a členové" },
  { href: "/reminders", label: "Upomínky a šablony" },
];

export function SettingsTabs() {
  const pathname = usePathname();
  return (
    <nav className="settings-tabs" aria-label="Sekce nastavení">
      {tabs.map((tab) => (
        <Link
          key={tab.href}
          href={tab.href}
          aria-current={pathname === tab.href ? "page" : undefined}
          className={pathname === tab.href ? "active" : ""}
        >
          {tab.label}
        </Link>
      ))}
    </nav>
  );
}
