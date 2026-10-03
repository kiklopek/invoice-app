"use client";

import Link from "next/link";
import { useState } from "react";
import { AppFrame } from "@/components/layout/app-shell";
import { Icon } from "@/components/icons";
import type { PaymentsPageData } from "@/lib/payments-page-data";
import { GpcImportPanel } from "./gpc-import-panel";
import styles from "./payments-upload.module.css";

// Tato podstránka slouží výhradně k nahrání a zpracování bankovního výpisu.
// Zaúčtované platby a archiv výpisů mají vlastní podstránku
// /invoices/payments/archive, kde je na ně podstatně víc místa.
export function PaymentsClient({ initialData }: { initialData: PaymentsPageData }) {
  const [committed, setCommitted] = useState(false);
  const gpcEnabled = initialData.gpc_enabled;

  return (
    <AppFrame className={`content section-page payments-page payments-upload-page ${styles.page}`}>
      <div className={styles.stage}>
      <header className="section-header payments-hero">
        <div className="payments-hero-copy">
          <p>BANKOVNÍ PÁROVÁNÍ</p>
          <h1>Spárujte platby s fakturami</h1>
          <span>Od bankovního výpisu k uhrazeným fakturám. Nahrajte soubor a projděte navržené shody.</span>
        </div>
        <div className="payments-hero-side">
          <Link href="/invoices/payments/archive" className="payments-switch payments-switch-archive">
            <span className="payments-switch-icon"><Icon name="statement" /></span>
            <span className="payments-switch-copy">
              <strong>Platby a archiv</strong>
              <small>Historie úhrad a uložené výpisy</small>
            </span>
            <span className="payments-switch-arrow" aria-hidden="true"><Icon name="arrow-right" /></span>
          </Link>
        </div>
      </header>

      <div id="import-vypisu" className="payments-anchor" />
      {gpcEnabled ? (
        <GpcImportPanel
          invoices={initialData.open_invoices}
          canManage={initialData.can_manage}
          onCommitted={() => setCommitted(true)}
          camtEnabled={initialData.assistance_flags?.camt ?? false}
        />
      ) : (
        <section className="page-panel payments-unavailable">
          <span className="payments-loading-icon payments-warning-icon"><Icon name="alert" /></span>
          <div>
            <h2>Import bankovního výpisu není dostupný</h2>
            <p className="form-error" role="alert">Import bankovních výpisů není pro vaši roli nebo toto prostředí povolený.</p>
            <p>Náhled ani potvrzení fakturami nepohne, dokud kontrolu výslovně nepotvrdíte.</p>
          </div>
        </section>
      )}
      {committed && (
        <p className="form-success payments-committed-note">
          Import je zpracovaný. Zaúčtované platby a nespárované položky najdete na podstránce{" "}
          <Link href="/invoices/payments/archive">Platby a archiv</Link>.
        </p>
      )}
      </div>
    </AppFrame>
  );
}
