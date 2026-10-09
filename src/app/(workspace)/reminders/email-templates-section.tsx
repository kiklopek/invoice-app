"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { ChevronDown } from "@/components/chevron-down";
import { Icon } from "@/components/icons";
import { invoiceSpayd } from "@/lib/czech-payment";
import { interpolateReminderTemplateValues } from "@/lib/reminder-template";
import { renderReminderEmail, type ReminderEmailCompany } from "@/lib/reminder-email-template";
import { parseReminderCcInput } from "@/lib/reminder-recipients";
import type { ReminderTemplateSettings } from "@/lib/reminder-page-data";
import type { ReminderStage } from "@/types/invoice";
import styles from "./email-templates-section.module.css";

type Template = ReminderTemplateSettings;
type Field = "subject" | "body";

const stages: { id: ReminderStage; label: string; help: string }[] = [
  { id: "before_due", label: "Před splatností", help: "Přátelské upozornění, že se blíží termín platby." },
  { id: "on_due", label: "V den splatnosti", help: "Informace, že faktura má být dnes uhrazena." },
  { id: "overdue", label: "Po splatnosti", help: "Běžná upomínka po překročení splatnosti." },
  { id: "escalation", label: "Důrazná upomínka", help: "Poslední, důraznější text při dlouhém prodlení." },
];

// Lidské názvy místo {{proměnných}}: kliknutím se údaj vloží na místo kurzoru
// a v odeslaném e-mailu se nahradí skutečnou hodnotou z faktury.
const invoiceFields: { token: string; label: string }[] = [
  { token: "{{counterparty_name}}", label: "Odběratel" },
  { token: "{{invoice_number}}", label: "Číslo faktury" },
  { token: "{{amount}}", label: "Částka" },
  { token: "{{currency}}", label: "Měna" },
  { token: "{{due_date}}", label: "Splatnost" },
  { token: "{{variable_symbol}}", label: "Variabilní symbol" },
];

const previewValues = {
  invoice_number: "TEST-2026-001",
  variable_symbol: "2026001",
  counterparty_name: "Ukázkový odběratel s.r.o.",
  amount: "12 500,00",
  currency: "CZK",
  due_date: "13. 8. 2026",
};
// Stejná ukázková faktura jako previewValues, ve tvaru pro QR platbu.
const previewInvoice = {
  invoice_number: previewValues.invoice_number,
  counterparty_name: previewValues.counterparty_name,
  variable_symbol: previewValues.variable_symbol,
  amount: 12500,
  paid_amount: 0,
  currency: "CZK",
  due_date: "2026-08-13",
};

export function EmailTemplatesSection({
  templates,
  ccInputs,
  activeStage,
  company,
  canEdit,
  busy,
  saving,
  sendingTest,
  onStageChange,
  onTemplateChange,
  onCcChange,
  onRecommended,
  onSendTest,
  onSave,
}: {
  templates: Record<ReminderStage, Template>;
  ccInputs: Record<ReminderStage, string>;
  activeStage: ReminderStage;
  company: ReminderEmailCompany | null;
  canEdit: boolean;
  busy: boolean;
  saving: boolean;
  sendingTest: boolean;
  onStageChange: (stage: ReminderStage) => void;
  onTemplateChange: (patch: Partial<Template>) => void;
  onCcChange: (value: string) => void;
  onRecommended: () => void;
  onSendTest: () => void;
  onSave: () => void;
}) {
  const subjectRef = useRef<HTMLInputElement>(null);
  const bodyRef = useRef<HTMLTextAreaElement>(null);
  const [insertTarget, setInsertTarget] = useState<Field>("body");
  const [mobileView, setMobileView] = useState<"edit" | "preview">("edit");
  const template = templates[activeStage];
  const stage = stages.find((item) => item.id === activeStage) ?? stages[0];
  const cc = parseReminderCcInput(ccInputs[activeStage]);
  const hasDeliveryValues = Boolean(template.reply_to) || cc.length > 0;

  // QR v náhledu se skládá stejnou funkcí jako v odeslaném e-mailu, takže
  // náhled neslibuje nic, co by upomínka nakonec neobsahovala.
  const previewSpayd = company ? invoiceSpayd(previewInvoice, company) : null;
  const [qr, setQr] = useState<{ spayd: string; src: string } | null>(null);
  useEffect(() => {
    if (!previewSpayd) return;
    let cancelled = false;
    void import("qrcode")
      .then(({ default: QRCode }) =>
        QRCode.toDataURL(previewSpayd, { errorCorrectionLevel: "M", margin: 1, width: 320 }),
      )
      .then((src) => {
        if (!cancelled) setQr({ spayd: previewSpayd, src });
      })
      .catch(() => {
        // Bez obrázku náhled prostě ukáže e-mail bez QR bloku.
      });
    return () => {
      cancelled = true;
    };
  }, [previewSpayd]);
  const previewQrSrc = previewSpayd && qr?.spayd === previewSpayd ? qr.src : null;

  const rendered = company
    ? renderReminderEmail({
        company,
        stage: activeStage,
        subject: interpolateReminderTemplateValues(template.subject, previewValues),
        message: interpolateReminderTemplateValues(template.body, previewValues),
        values: previewValues,
        logoUrl: company.logo_path ?? null,
        replyTo: template.reply_to,
        qrSrc: previewQrSrc,
      })
    : null;

  function insertField(token: string) {
    const element = insertTarget === "subject" ? subjectRef.current : bodyRef.current;
    const current = template[insertTarget];
    const start = element?.selectionStart ?? current.length;
    const end = element?.selectionEnd ?? current.length;
    onTemplateChange({ [insertTarget]: current.slice(0, start) + token + current.slice(end) });
    requestAnimationFrame(() => {
      element?.focus();
      element?.setSelectionRange(start + token.length, start + token.length);
    });
  }

  return (
    <div className={styles.section}>
      <div className={styles.stages} role="tablist" aria-label="Typ upomínky">
        {stages.map((item) => (
          <button
            key={item.id}
            type="button"
            role="tab"
            aria-selected={item.id === activeStage}
            className={item.id === activeStage ? styles.stageActive : styles.stage}
            onClick={() => onStageChange(item.id)}
          >
            {item.label}
          </button>
        ))}
      </div>
      <p className={styles.stageHelp}>{stage.help}</p>

      <div className={styles.viewSwitch} role="group" aria-label="Zobrazení">
        <button type="button" aria-pressed={mobileView === "edit"} onClick={() => setMobileView("edit")}>
          Upravit text
        </button>
        <button type="button" aria-pressed={mobileView === "preview"} onClick={() => setMobileView("preview")}>
          Náhled e-mailu
        </button>
      </div>

      <div className={styles.layout} data-view={mobileView}>
        <div className={styles.editor}>
          <label className={styles.field}>
            <span className={styles.label}>Předmět</span>
            <input
              ref={subjectRef}
              value={template.subject}
              disabled={!canEdit}
              onFocus={() => setInsertTarget("subject")}
              onChange={(event) => onTemplateChange({ subject: event.target.value })}
            />
          </label>

          <div className={styles.field}>
            <div className={styles.labelRow}>
              <label className={styles.label} htmlFor="reminder-template-body">Text zprávy</label>
              <button type="button" className={styles.linkButton} disabled={!canEdit} onClick={onRecommended}>
                Vrátit doporučený text
              </button>
            </div>
            <textarea
              id="reminder-template-body"
              ref={bodyRef}
              value={template.body}
              disabled={!canEdit}
              onFocus={() => setInsertTarget("body")}
              onChange={(event) => onTemplateChange({ body: event.target.value })}
            />
          </div>

          <div className={styles.insert}>
            <span className={styles.insertLabel}>
              Vložit údaj z faktury do {insertTarget === "subject" ? "předmětu" : "textu"}:
            </span>
            <div className={styles.chips}>
              {invoiceFields.map((field) => (
                <button
                  key={field.token}
                  type="button"
                  disabled={!canEdit}
                  title={`V textu se zobrazí jako ${field.token}`}
                  onMouseDown={(event) => event.preventDefault()}
                  onClick={() => insertField(field.token)}
                >
                  + {field.label}
                </button>
              ))}
            </div>
          </div>

          <p className={styles.note}>
            Údaje k platbě, a když má firma platný bankovní účet i QR platba, se do e-mailu doplní samy. Do textu je psát nemusíte.
          </p>

          <details className={styles.delivery} open={hasDeliveryValues || undefined}>
            <summary>
              <span>
                Odpovědi a kopie <small>nepovinné</small>
              </span>
              <ChevronDown className={styles.chevron} />
            </summary>
            <div className={styles.deliveryFields}>
              <label className={styles.field}>
                <span className={styles.label}>Kam mohou odběratelé odpovědět</span>
                <input
                  type="email"
                  placeholder="např. ucetni@firma.cz"
                  value={template.reply_to ?? ""}
                  disabled={!canEdit}
                  onChange={(event) => onTemplateChange({ reply_to: event.target.value || null })}
                />
              </label>
              <label className={styles.field}>
                <span className={styles.label}>Interní kopie (nejvýše 5 adres)</span>
                <input
                  type="text"
                  inputMode="email"
                  placeholder="Adresy oddělte čárkou"
                  value={ccInputs[activeStage]}
                  disabled={!canEdit}
                  onChange={(event) => onCcChange(event.target.value)}
                />
              </label>
            </div>
          </details>

          <div className={styles.actions}>
            <button type="button" className="btn secondary" disabled={sendingTest || !canEdit} onClick={onSendTest}>
              {sendingTest ? "Odesílám test…" : "Poslat test na můj e-mail"}
            </button>
            <button type="button" className="btn primary" disabled={!canEdit || busy} onClick={onSave}>
              {saving ? (
                "Ukládám…"
              ) : (
                <>
                  <Icon name="check" />
                  Uložit změny
                </>
              )}
            </button>
          </div>
        </div>

        <aside className={styles.preview} aria-label="Náhled výsledného e-mailu">
          <div className={styles.previewMeta}>
            <span className={styles.previewEyebrow}>Náhled na ukázkové faktuře</span>
            <strong className={styles.previewSubject}>
              {rendered?.subject || "Bez předmětu"}
            </strong>
            {template.reply_to ? <small>Odpovědi: {template.reply_to}</small> : null}
            {cc.length ? <small>Kopie: {cc.join(", ")}</small> : null}
          </div>
          {company && !previewSpayd ? (
            <p className={styles.qrWarning} role="status">
              QR platba se do upomínek nevloží: bankovní účet firmy chybí nebo neprošel kontrolou.{" "}
              <Link href="/settings">Zkontrolovat v Nastavení</Link>
            </p>
          ) : null}
          {rendered ? <EmailPreviewFrame html={rendered.html} /> : <p className="page-state">Připravuji náhled…</p>}
        </aside>
      </div>
    </div>
  );
}

// Iframe roste s obsahem e-mailu: náhled se čte jako celá stránka, bez druhého
// posuvníku uvnitř, a QR blok dole není schovaný. Sandbox bez skriptů;
// allow-same-origin je tu jen kvůli změření výšky.
function EmailPreviewFrame({ html }: { html: string }) {
  const frameRef = useRef<HTMLIFrameElement>(null);
  const [height, setHeight] = useState(640);

  useEffect(() => {
    const frame = frameRef.current;
    if (!frame) return;
    const measure = () => {
      const body = frame.contentDocument?.body;
      // + rámeček iframu, jinak by uvnitř zůstal posuvník na pár pixelů.
      const border = frame.offsetHeight - frame.clientHeight;
      if (body) setHeight(Math.max(240, Math.ceil(body.scrollHeight) + border));
    };
    measure();
    frame.addEventListener("load", measure);
    const observer = new ResizeObserver(measure);
    observer.observe(frame);
    return () => {
      frame.removeEventListener("load", measure);
      observer.disconnect();
    };
  }, []);

  return (
    <iframe
      ref={frameRef}
      className={styles.frame}
      title="Náhled výsledného e-mailu"
      sandbox="allow-same-origin"
      srcDoc={html}
      style={{ height }}
    />
  );
}
