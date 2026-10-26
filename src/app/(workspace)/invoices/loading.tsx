import { AppFrame } from "@/components/layout/app-shell";
import { InvoiceListSkeleton } from "./invoice-list-skeleton";
import styles from "./invoices.module.css";
export default function InvoicesLoading() {
  return (
    <AppFrame className={`content section-page ${styles.page}`}>
      <header className={styles.pageHeader}>
        <div>
          <p>FAKTURY</p>
          <h1>Všechny faktury</h1>
          <span className={styles.subtitle}>
            Přehled všech vydaných faktur, jejich stav a platby.
          </span>
        </div>
      </header>
      <section className={styles.panel}>
        <InvoiceListSkeleton />
      </section>
    </AppFrame>
  );
}
