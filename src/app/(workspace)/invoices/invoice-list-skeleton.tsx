import styles from "./invoices.module.css";
export function InvoiceListSkeleton() {
  return (
    <div className={styles.skeleton} role="status" aria-label="Načítám faktury">
      <span className={styles.srOnly}>Načítám faktury…</span>
      {Array.from({ length: 8 }, (_, index) => (
        <div key={index} aria-hidden="true">
          <i />
          <i />
          <i />
          <i />
          <i />
        </div>
      ))}
    </div>
  );
}
