"use client";

import { AppFrame } from "@/components/layout/app-shell";
import { InvoiceCreation } from "@/components/invoice-creation/invoice-creation";
import styles from "@/components/invoice-creation/invoice-creation.module.css";

export default function CreateInvoicePage() {
  return (
    <AppFrame className={`content section-page ${styles.page}`}>
      <InvoiceCreation />
    </AppFrame>
  );
}
