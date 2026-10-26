import type { ReactNode } from "react";
import styles from "./invoice-review-form.module.css";

export function InvoiceFormSection({ number, title, description, review, badge, children, hidden = false }: {
  number: number;
  title: string;
  description: string;
  review: boolean;
  badge?: ReactNode;
  children: ReactNode;
  hidden?: boolean;
}) {
  if (review) return <section className={styles.section} data-ocr-section data-invoice-form-section={number} hidden={hidden} style={hidden ? { display:"none" } : undefined}>
    <header className={styles.sectionHeader}>
      <h2 tabIndex={-1}>{title}</h2>
      {badge}
    </header>
    <div className={styles.fields}>{children}</div>
  </section>;
  return <section className="form-section" data-invoice-form-section={number} hidden={hidden} style={hidden ? { display:"none" } : undefined}>
    <div className="form-section-title"><span>{number}</span><div><h2 tabIndex={-1}>{title}</h2><p>{description}</p></div></div>
    <div className="form-grid">{children}</div>
  </section>;
}
