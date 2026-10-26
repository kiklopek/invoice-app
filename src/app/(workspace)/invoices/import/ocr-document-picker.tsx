import { useEffect, useRef } from "react";
import { ChevronDown } from "@/components/chevron-down";
import { Icon } from "@/components/icons";
import styles from "./ocr-review.module.css";

type DocumentChoice = { name: string; label?: string; status: "pending" | "processing" | "ready" | "saved" | "error" };
const labels: Record<DocumentChoice["status"], string> = { pending: "Čeká", processing: "Zpracovávám…", ready: "Ke kontrole", saved: "Uloženo", error: "Chyba" };

export function OcrDocumentPicker({ documents, activeIndex, onSelect, onStop }: {
  documents: DocumentChoice[];
  activeIndex: number;
  onSelect: (index: number) => void;
  onStop?: () => void;
}) {
  const menu = useRef<HTMLDetailsElement>(null);
  useEffect(() => {
    const close = (event: Event) => {
      if (!menu.current?.open) return;
      if (event instanceof KeyboardEvent && event.key === "Escape") {
        menu.current.open = false;
        menu.current.querySelector("summary")?.focus();
      } else if (!(event instanceof KeyboardEvent) && event.target instanceof Node && !menu.current.contains(event.target)) menu.current.open = false;
    };
    document.addEventListener("pointerdown", close);
    document.addEventListener("keydown", close);
    return () => { document.removeEventListener("pointerdown", close); document.removeEventListener("keydown", close); };
  }, []);
  if (documents.length < 2) return null;
  return <div className={styles.batch} data-ocr-batch>
    <details className={styles.picker} ref={menu}>
      <summary aria-label="Vybrat fakturu">
        <Icon name="invoice"/>
        <span><strong>Faktura {activeIndex + 1} z {documents.length}</strong><small>{documents[activeIndex]?.label || documents[activeIndex]?.name}</small></span>
        <ChevronDown className={styles.pickerArrow} />
      </summary>
      <div className={styles.pickerPanel} data-popup role="group" aria-label="Výběr faktury">
        {documents.map((item, index) => <button key={`${index}-${item.name}`} type="button"
          aria-current={activeIndex === index ? "true" : undefined}
          disabled={item.status === "pending" || item.status === "processing"}
          onClick={() => { onSelect(index); if (menu.current) { menu.current.open = false; menu.current.querySelector("summary")?.focus(); } }}>
          <Icon name={item.status === "saved" ? "check" : item.status === "error" ? "alert" : "invoice"}/>
          <span><strong title={item.label || item.name}>{item.label || item.name}</strong><small>{item.label ? `${item.name} · ` : ""}{labels[item.status]}</small></span>
          {item.status === "processing" ? <svg className={styles.pickerSpinner} viewBox="0 0 24 24" aria-hidden="true" data-ocr-processing-spinner><circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" strokeWidth="2.5" strokeDasharray="42 15" strokeLinecap="round"/></svg> : activeIndex === index && <Icon name="check"/>}
        </button>)}
        {onStop && <button type="button" className={styles.stopProcessing} onClick={onStop}>Zastavit zpracování</button>}
      </div>
    </details>
  </div>;
}
