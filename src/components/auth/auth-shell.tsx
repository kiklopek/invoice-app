import Image from "next/image";
import Link from "next/link";
import type { ReactNode } from "react";
import { Inter } from "next/font/google";
import { CompanyLogo } from "@/components/company-logo";
import { RibbonMark } from "@/components/landing/landing-icons";
import styles from "./auth-shell.module.css";

const inter = Inter({ subsets: ["latin", "latin-ext"], display: "swap" });

export type AuthArt = "wave" | "laptop" | "phone";

const ART: Record<AuthArt, { src: string; width: number; height: number }> = {
  wave: { src: "/brand/mascot/wave.webp", width: 760, height: 662 },
  laptop: { src: "/brand/mascot/laptop.webp", width: 760, height: 648 },
  phone: { src: "/brand/mascot/phone.webp", width: 760, height: 658 },
};

// Společný rám přihlášení, registrace a ověření: formulář vlevo, maskot
// s claimem vpravo (na telefonu jako pruh nad formulářem). Stránky si
// nechávají vlastní logiku, rám řeší jen vzhled.
export function AuthShell({
  art,
  claim,
  claimSub,
  children,
}: {
  art: AuthArt;
  claim: ReactNode;
  claimSub?: ReactNode;
  children: ReactNode;
}) {
  const image = ART[art];
  return (
    <main className={`${styles.page} ${inter.className}`}>
      <div className={styles.card}>
        <section className={styles.formSide}>
          <div className={styles.brandRow}>
            <Link href="/" className={styles.splatno} aria-label="Splatno – zpět na úvodní stránku">
              <RibbonMark size={30} />
              <span>splatno</span>
            </Link>
            <span className={styles.company}>
              <CompanyLogo className={styles.companyLogo} />
            </span>
          </div>
          <div className={styles.body}>{children}</div>
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
