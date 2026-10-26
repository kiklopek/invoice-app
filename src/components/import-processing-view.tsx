import { Icon } from "@/components/icons";
import styles from "./import-processing.module.css";

export function ImportProcessingView({ kind, title, description, phase, stages, count, progressLabel, progressText, stagesLabel, totalLabel, notice, onStop, stopNote }: {
  kind: "ocr" | "statement";
  title: string;
  description: string;
  phase: number;
  stages: { title: string; detail: string }[];
  count: string;
  progressLabel: string;
  progressText: string;
  stagesLabel: string;
  totalLabel?: string;
  notice: string;
  onStop?: () => void;
  stopNote?: string;
}) {
  const titleId = `${kind}-processing-title`;
  return <section className={styles.card} aria-labelledby={titleId} aria-busy="true"
    data-ocr-processing={kind === "ocr" ? "" : undefined}
    data-statement-processing={kind === "statement" ? "" : undefined}>
    {onStop && <button type="button" className={styles.stop} onClick={onStop}>Zastavit zpracování</button>}
    <div className={styles.content}>
      <div className={styles.srOnly} role="status" aria-live="polite">
        <h2 id={titleId}>{title}</h2><p>{description}</p>
      </div>
      <div className={styles.progressRow}>
        <div className={styles.progress} role="progressbar" aria-label={progressLabel} aria-valuetext={progressText}><span/></div>
        <span className={styles.count}>{count}</span>
      </div>
      <ol className={styles.stages} aria-label={stagesLabel}>
        {stages.map((stage, index) => <li key={stage.title} className={index < phase ? styles.done : index === phase ? styles.active : undefined} aria-current={index === phase ? "step" : undefined}>
          <span className={styles.stageIcon} aria-hidden="true">{index < phase ? <Icon name="tick"/> : null}</span>
          <div><strong>{stage.title}</strong>{index >= phase && <p>{stage.detail}</p>}</div>
          {index === 0 && totalLabel && <small>{totalLabel}</small>}
        </li>)}
      </ol>
      <p className={styles.notice}><span aria-hidden="true">i</span>{notice}</p>
      {onStop && stopNote && <p className={styles.stopNote}>{stopNote}</p>}
    </div>
  </section>;
}
