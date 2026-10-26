import { type ReactNode, type Ref } from "react";
import { Icon } from "@/components/icons";
import styles from "./ocr-review.module.css";

export function OcrReviewWorkspace({ header, picker, form, document: documentView, view, onViewChange, footerRef }: {
  header: ReactNode;
  picker?: ReactNode;
  form: ReactNode;
  document: ReactNode;
  view: "data" | "document";
  onViewChange: (view: "data" | "document") => void;
  footerRef: Ref<HTMLElement>;
}) {
  return <div className={styles.workspacePage} role="region" aria-label="Kontrola údajů z faktury">
    {header}
    {picker}
    <div className={styles.tabs} role="tablist" aria-label="Údaje nebo doklad">
      <button type="button" role="tab" aria-selected={view === "data"} onClick={() => onViewChange("data")}>Údaje</button>
      <button type="button" role="tab" aria-selected={view === "document"} onClick={() => onViewChange("document")}>Doklad</button>
    </div>
    <div className={styles.workspace} data-ocr-workspace data-view={view}>
      <section className={styles.formPanel} data-ocr-form-panel aria-label="Údaje faktury">{form}</section>
      <section className={styles.documentPanel} data-ocr-document-panel aria-label="Originální doklad">
        <button type="button" className={styles.backToData} onClick={() => onViewChange("data")}><Icon name="arrow-left"/>Zpět k údajům</button>
        {documentView}
      </section>
    </div>
    <footer className={styles.actions} ref={footerRef} aria-label="Uložení faktury"/>
  </div>;
}
