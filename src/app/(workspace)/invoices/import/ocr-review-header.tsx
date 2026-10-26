import type { ReactNode } from "react";
import { Icon } from "@/components/icons";
import styles from "./ocr-review.module.css";

export function OcrReviewHeader({ onBack, savedCount, totalCount, picker }: {
  onBack: () => void;
  picker?: ReactNode;
  savedCount: number;
  totalCount: number;
}) {
  return <header className={styles.header} data-ocr-header>
    <div className={styles.headerControls}>
      <button type="button" className={styles.back} onClick={onBack}><Icon name="arrow-left"/>Zpět na import</button>
      {picker}
    </div>
    <ol className={styles.steps} aria-label="Průběh importu">
      <li><span><Icon name="check"/></span>Nahrání</li>
      <li aria-current="step"><span>2</span>Kontrola údajů</li>
      <li><span>3</span>Uložení{totalCount > 1 && <small>{savedCount}/{totalCount}</small>}</li>
    </ol>
  </header>;
}
