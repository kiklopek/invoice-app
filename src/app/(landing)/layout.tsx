import type { ReactNode } from "react";
import { Caveat, Inter } from "next/font/google";

// Písma landing page (`/` a `/en`). Musí být deklarovaná tady v layoutu: Next
// přednačítá písmo jen ze souboru stránky nebo layoutu. Z komponenty se na
// předgenerovanou stránku přednačtení nedostalo a Inter se stahoval až z CSS.
const inter = Inter({
  subsets: ["latin", "latin-ext"],
  variable: "--lp-font-sans",
  display: "swap",
});
const caveat = Caveat({
  subsets: ["latin", "latin-ext"],
  weight: ["500", "600"],
  variable: "--lp-font-hand",
  display: "swap",
  // Jen pár ručně psaných poznámek: písmo se stáhne až po hlavním obsahu a
  // na mobilu nesoupeří s ním o připojení (poznámky jsou absolutně
  // umístěné, výměna písma nic neposune).
  preload: false,
});

export default function LandingLayout({ children }: { children: ReactNode }) {
  return (
    <div className={`${inter.variable} ${caveat.variable}`} style={{ display: "contents" }}>
      {children}
    </div>
  );
}
