"use client";

import Image from "next/image";
import Link from "next/link";
import type { ReactNode } from "react";
import { Inter } from "next/font/google";
import { CompanyLogo } from "@/components/company-logo";
import { useI18n } from "@/i18n/client";
import { LanguageSwitcher } from "@/i18n/language-switcher";
import { HLAVICA_ENTRY } from "@/lib/tenant-entries";
import { ArrowLeft, RibbonMark } from "@/components/landing/landing-icons";
import styles from "./auth-shell.module.css";

const inter = Inter({ subsets: ["latin", "latin-ext"], display: "swap" });

export type AuthArt = "wave" | "laptop" | "phone";

const ART: Record<AuthArt, { src: string; width: number; height: number }> = {
  wave: { src: "/brand/mascot/wave.webp", width: 760, height: 662 },
  laptop: { src: "/brand/mascot/laptop.webp", width: 760, height: 648 },
  phone: { src: "/brand/mascot/phone.webp", width: 760, height: 658 },
};

// "splatno" je obecný vzhled pro všechny firmy; "hlavica" je vstup
// splatno.cz/hlavica s logem R. Hlavica (R8: jejich logo jinde nepatří).
export type AuthBrand = "splatno" | "hlavica";

// Společný rám přihlášení, registrace a ověření: formulář vlevo, maskot
// s claimem vpravo (na telefonu jako pruh nad formulářem). Stránky si
// nechávají vlastní logiku, rám řeší jen vzhled.
export function AuthShell({
  art,
  claim,
  claimSub,
  brand = "splatno",
  children,
}: {
  art: AuthArt;
  claim: ReactNode;
  claimSub?: ReactNode;
  brand?: AuthBrand;
  children: ReactNode;
}) {
  const image = ART[art];
  const copy = useI18n().t.auth.shell;
  return (
    <main className={`${styles.page} ${inter.className}`}>
      <div className={styles.card}>
        <section className={styles.formSide}>
          <div className={styles.brandRow}>
            {brand === "hlavica" ? (
              <>
                <Link href="/" className={styles.splatno} aria-label={copy.logoAria}>
                  <RibbonMark size={30} />
                  <span>splatno</span>
                </Link>
                <span className={styles.brandEnd}>
                  <span className={styles.company}>
                    <CompanyLogo src={HLAVICA_ENTRY.logo} name={HLAVICA_ENTRY.name} className={styles.companyLogo} />
                  </span>
                  <LanguageSwitcher />
                </span>
              </>
            ) : (
              <>
                <Link href="/" className={styles.backHome}>
                  <ArrowLeft /><span>{copy.backHome}<span className={styles.backHomeLong}>{copy.backHomeLong}</span><span className={styles.backHomeShort}>{copy.backHomeShort}</span></span>
                </Link>
                <span className={styles.brandEnd}>
                  <Link href="/" className={styles.splatno} aria-label={copy.logoAria}>
                    <RibbonMark size={30} />
                    <span>splatno</span>
                  </Link>
                  <LanguageSwitcher />
                </span>
              </>
            )}
          </div>
          <div className={styles.body}>
            {/* Splatno má zpětnou šipku přímo v řádku s logem; vstup R. Hlavica
                tam má logo firmy, proto ji dostane nad formulářem. */}
            {brand === "hlavica" ? (
              <nav className={styles.backNavigation} aria-label={copy.backNavAria}>
                <Link href="/" className={styles.backHome}><ArrowLeft /><span>{copy.backHomeFull}</span></Link>
              </nav>
            ) : null}
            {children}
          </div>
        </section>
        <aside className={styles.artSide} aria-hidden="true">
          <Image
            src={image.src}
            alt=""
            width={image.width}
            height={image.height}
            className={styles.mascot}
            sizes="(max-width: 900px) 96px, 420px"
            priority
          />
          <div className={styles.claimBox}>
            <p className={styles.claim}>{claim}</p>
            {claimSub ? <p className={styles.claimSub}>{claimSub}</p> : null}
          </div>
        </aside>
      </div>
    </main>
  );
}

export { styles as authStyles };
