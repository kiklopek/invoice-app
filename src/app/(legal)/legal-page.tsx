import Link from "next/link";
import type { ReactNode } from "react";
import { RibbonMark } from "@/components/landing/landing-icons";
import styles from "./legal.module.css";

// Společný rám právních textů. Texty jsou NÁVRH: před otevřením registrace
// veřejnosti je musí zkontrolovat právník a doplnit údaje provozovatele.
export function LegalPage({ title, updated, children }: { title: string; updated: string; children: ReactNode }) {
  return (
    <main className={styles.page}>
      <article className={styles.article}>
        <Link href="/" className={styles.logo}><RibbonMark size={28} /><span>splatno</span></Link>
        <p className={styles.draft}>Pracovní návrh – před spuštěním projde právní kontrolou. Údaje provozovatele budou doplněny.</p>
        <h1>{title}</h1>
        <p className={styles.muted}>Poslední změna: {updated}</p>
        {children}
      </article>
    </main>
  );
}
