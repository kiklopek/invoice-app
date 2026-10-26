"use client";

import { issuedDocument } from "@/lib/invoice-creation";
import Link from "next/link";
import { useEffect, useLayoutEffect, useRef, useState, useId, type ReactNode, type CSSProperties } from "react";
import { useSmallMobile } from "@/components/layout/mobile-header-slot";
import { ChevronDown } from "@/components/chevron-down";
import { Icon } from "@/components/icons";
import { exactMoney } from "@/lib/money-display";
import { ExactMoney } from "@/components/money-amount";
import type { Invoice } from "@/types/invoice";
import type { BankPayment, EmailSuppression } from "@/lib/invoice-detail-page-data";
import { invoiceDetailView } from "./invoice-detail-view";
import { InvoiceDocumentCard } from "./invoice-document-card";
import styles from "./invoice-detail.module.css";

export const detailDate = (value: string | null) => value ? new Intl.DateTimeFormat("cs-CZ", { dateStyle: "medium", timeZone: "Europe/Prague" }).format(new Date(value)) : "—";
export function InvoiceDetailHeading({ invoice, actions, onBack }: { invoice: Invoice; actions: ReactNode; onBack?: () => void }) {
  const view = invoiceDetailView(invoice);
  const mobile = useSmallMobile();
  const titleLine = useRef<HTMLDivElement>(null);
  const [compactPaid, setCompactPaid] = useState(false);
  useLayoutEffect(() => {
    const line = titleLine.current;
    if (!mobile || invoice.status !== "paid" || !line) return;
    const context = document.createElement("canvas").getContext("2d");
    if (!context) return;
    const measure = () => {
      const heading = line.querySelector("h1");
      const label = line.querySelector<HTMLElement>("[data-status-label]");
      const icon = line.querySelector("i");
      if (!heading || !label || !icon) return;
      const font = getComputedStyle(heading);
      context.font = `${font.fontWeight} ${font.fontSize} ${font.fontFamily}`;
      const text = heading.textContent ?? "";
      const titleWidth = context.measureText(text).width + Math.max(0, text.length - 1) * (parseFloat(font.letterSpacing) || 0);
      const badgeWidth = label.getBoundingClientRect().width + icon.getBoundingClientRect().width + 7 + 16;
      setCompactPaid(titleWidth + badgeWidth + 8 > line.clientWidth);
    };
    const observer = new ResizeObserver(measure);
    observer.observe(line);
    measure();
    let active = true;
    void document.fonts?.ready.then(() => { if (active) measure(); });
    return () => { active = false; observer.disconnect(); };
  }, [mobile, invoice.status, invoice.invoice_number]);
  return <><nav className={styles.breadcrumb} aria-label="Drobečková navigace"><Link href="/invoices">Faktury</Link><span aria-hidden="true">›</span><span>Faktura č. {invoice.invoice_number}</span></nav>
    <header className={styles.heading}>
      {onBack ? <button type="button" className={styles.back} onClick={onBack} aria-label="Zpět na detail faktury"><Icon name="arrow-left" /></button> : <Link href="/invoices" className={styles.back} aria-label="Zpět na faktury"><Icon name="arrow-left" /></Link>}
      <div className={styles.identity}><div ref={titleLine} className={styles.titleLine} data-paid={invoice.status === "paid" || undefined}><h1>Faktura č. {invoice.invoice_number}</h1><span className={styles.badge} data-tone={view.tone} data-compact={invoice.status === "paid" && compactPaid || undefined} role={invoice.status === "paid" && compactPaid ? "img" : undefined} aria-label={view.label} title={view.label}>{invoice.status === "paid" && <i aria-hidden="true"><Icon name="check" /></i>}<span className={styles.badgeLabel} data-status-label>{view.label}</span></span></div>
        <p>{invoice.counterparty_name}</p>
      </div><div className={styles.mobileHero} style={{ "--amount-length": exactMoney(Number(invoice.amount),invoice.currency).length } as CSSProperties}><strong data-status={view.partial ? "partial" : invoice.status}><ExactMoney value={Number(invoice.amount)} currency={invoice.currency}/></strong><div className={styles.mobileHeroDetails}><p>{invoice.counterparty_name}</p><span>Splatnost <time dateTime={invoice.due_date} data-overdue={invoice.status === "overdue" || undefined}>{detailDate(invoice.due_date)}</time></span></div></div>{actions}
    </header></>;
}

type Props = {
  invoice: Invoice; payments: BankPayment[]; canManage: boolean; updating: boolean; suppression: EmailSuppression | null;
  history: ReactNode; historyCount: number; reminderHistory: ReactNode;
  onPause: (paused: boolean) => void; onUnassign: (payment: BankPayment) => void;
};
export function InvoiceDetailWorkspace({ invoice, payments, canManage, updating, suppression, history, historyCount, reminderHistory, onPause, onUnassign }: Props) {
  const mobile = useSmallMobile();
  const [mobileTab,setMobileTab] = useState("overview");
  const tabId = useId();
  useEffect(() => {
    const fromHash=()=>{if(location.hash==="#invoice-payments")setMobileTab("payments");else if(location.hash==="#invoice-reminders")setMobileTab("reminders");};
    fromHash();window.addEventListener("hashchange",fromHash);return()=>window.removeEventListener("hashchange",fromHash);
  },[]);
  const view = invoiceDetailView(invoice);
  const document = issuedDocument(invoice);
  const policy = invoice.reminder_policy?.name || "Standardní";
  const grid = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const node = grid.current;
    if (!node) return;
    const measure = () => {
      // Use the grid's document position, not its height: expanding the other
      // column must never change the left column's baseline height.
      const available = Math.max(0, window.innerHeight - node.getBoundingClientRect().top - window.scrollY - 16);
      const value = `${available}px`;
      if (node.style.getPropertyValue("--detail-column-height") !== value) node.style.setProperty("--detail-column-height", value);
    };
    measure();
    let frame = 0;
    const schedule = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(measure);
    };
    const observer = new ResizeObserver(schedule);
    if (node.parentElement) observer.observe(node.parentElement);
    window.addEventListener("resize", schedule);
    return () => { observer.disconnect(); cancelAnimationFrame(frame); window.removeEventListener("resize", schedule); };
  }, []);
  return <>{mobile && <div className={styles.mobileTabs} role="tablist" aria-label="Části detailu faktury">{[["overview","Přehled"],["document","Doklad"],["payments","Platby"],["reminders","Upomínky"]].map(([key,title])=><button key={key} id={`${tabId}-${key}`} type="button" role="tab" aria-selected={mobileTab===key} aria-controls={`${tabId}-panel`} tabIndex={mobileTab===key?0:-1} onClick={()=>setMobileTab(key)} onKeyDown={event=>{if(event.key==="ArrowRight"||event.key==="ArrowLeft"){event.preventDefault();const buttons=Array.from(event.currentTarget.parentElement!.querySelectorAll<HTMLButtonElement>("button"));const index=buttons.indexOf(event.currentTarget);buttons[(index+(event.key==="ArrowRight"?1:-1)+buttons.length)%buttons.length].click();buttons[(index+(event.key==="ArrowRight"?1:-1)+buttons.length)%buttons.length].focus();}}}>{title}</button>)}</div>}<div ref={grid} className={styles.grid} data-mobile-tab={mobile ? mobileTab : undefined} id={mobile ? `${tabId}-panel` : undefined} role={mobile ? "tabpanel" : undefined} aria-labelledby={mobile ? `${tabId}-${mobileTab}` : undefined}>
    <div className={styles.mainColumn}>
    <section className={`${styles.card} ${styles.summary}`} aria-label="Údaje faktury">
      <div className={styles.amount} style={{ "--amount-length": exactMoney(Number(invoice.amount), invoice.currency).length } as CSSProperties}><span>{document?.supplier.vat_payer === false ? "Částka celkem" : "Částka celkem s DPH"}</span><strong data-status={invoice.status}><ExactMoney value={Number(invoice.amount)} currency={invoice.currency} /></strong>
        <p>{document?.supplier.vat_payer === false ? "Dodavatel není plátcem DPH" : invoice.money_evidence?.multi_rate ? "Více sazeb DPH · souhrnný rozdíl" : `DPH ${Number(invoice.vat_rate).toLocaleString("cs-CZ")} %`}{document?.supplier.vat_payer !== false && <> (<ExactMoney value={view.vatAmount} currency={invoice.currency} />)</>}</p>
        {document?.supplier.vat_payer !== false && <small>Základ bez DPH: <ExactMoney value={Number(invoice.amount_without_vat)} currency={invoice.currency} /></small>}
        {view.partial && <div className={styles.partialBalance}><span>Uhrazeno <ExactMoney value={Number(invoice.paid_amount)} currency={invoice.currency} /></span><strong>Zbývá <ExactMoney value={view.remaining} currency={invoice.currency} /></strong></div>}
        {invoice.status === "paid" && invoice.paid_at && <small>Plně uhrazeno {detailDate(invoice.paid_at)}</small>}
      </div>
      <dl className={styles.metadata}>
        <div><dt>Číslo faktury</dt><dd>{invoice.invoice_number}</dd></div><div><dt>Variabilní symbol</dt><dd>{invoice.variable_symbol || "—"}</dd></div>
        <div><dt>Datum vystavení</dt><dd>{detailDate(invoice.issue_date)}</dd></div><div><dt>Datum splatnosti</dt><dd data-danger={invoice.status === "overdue" || undefined}>{detailDate(invoice.due_date)}</dd></div>
        <div><dt>Způsob zadání</dt><dd>{{ manual: "Ručně", ocr: "Z dokumentu (OCR)", email: "E-mailem", accounting_api: "Účetní integrace" }[invoice.source]}</dd></div>
        <div><dt>Kategorie upomínek</dt><dd>{policy}{invoice.reminder_policy?.archived_at ? " (archivovaná)" : ""}</dd></div>
      </dl>
    </section>

    <section className={`${styles.card} ${styles.customer}`} aria-label="Odběratel a kontakt"><header><h2>Odběratel a kontakt</h2>{invoice.customer_id && <Link href={`/customers?highlight=${invoice.customer_id}`} className={styles.textButton}>Zobrazit zákazníka <Icon name="arrow-right" /></Link>}</header>
      <div className={styles.customerBody}>
        <div className={styles.customerIdentity}><span className={styles.customerIcon}><Icon name="invoice" /></span><div><strong>{invoice.counterparty_name}</strong><small title={!invoice.customer_id ? "Toto IČO nemá platný záznam v adresáři Zákazníků" : undefined}>IČO {invoice.counterparty_ico || "—"} {invoice.counterparty_dic && ` / ${invoice.counterparty_dic}`}</small></div></div>
        <div className={styles.contact}><span className={styles.contactLabel}>E-mail pro upomínky</span>{invoice.counterparty_email ? <a href={`mailto:${invoice.counterparty_email}`}><Icon name="mail" /><span>{invoice.counterparty_email}</span></a> : <span>Kontaktní e-mail není uveden.</span>}</div>
      </div>
    </section>
    <section className={`${styles.card} ${styles.history}`} id="invoice-history" aria-label="Historie faktury">
      <details className={styles.historyDisclosure} open>
        <summary><h2>Historie faktury</h2><span>{historyCount} {historyCount === 1 ? "událost" : historyCount > 1 && historyCount < 5 ? "události" : "událostí"}</span><ChevronDown /></summary>
        <div className={styles.historyContent}>{history}</div>
      </details>
    </section>
    {invoice.notes && <section className={`${styles.card} ${styles.notes}`}><details className={styles.disclosure}><summary>{document ? "Poznámka na faktuře" : "Interní poznámka"}<ChevronDown /></summary><p>{invoice.notes}</p></details></section>}
    {document?.internal_note && <section className={`${styles.card} ${styles.notes}`}><details className={styles.disclosure}><summary>Interní poznámka<ChevronDown /></summary><p>{document.internal_note}</p></details></section>}    </div>
    <div className={styles.sideColumn}>
    <InvoiceDocumentCard id={invoice.id} path={invoice.file_url} invoiceNumber={invoice.invoice_number} />
    {payments.length > 0 && <section className={`${styles.card} ${styles.payments}`} id="invoice-payments" aria-label="Párování plateb"><header><h2>Párování plateb</h2><span className={styles.count}>{payments.length}</span></header>
      <div className={styles.paymentList}>{payments.map(payment => <article key={payment.id}><div className={styles.paymentMain}><Icon name={payment.source === "manual" ? "check" : "bank"} /><span>{detailDate(payment.booked_on)}</span><strong><ExactMoney value={Number(payment.allocation_amount)} currency={payment.currency} /></strong>{canManage && <Link className={styles.iconButton} href={`/invoices/payments/archive?highlight=${payment.id}#payment-${payment.id}`} aria-label={`Otevřít platbu ${payment.external_id}`}><Icon name="arrow-right" /></Link>}</div>
        <details className={styles.paymentDetails}><summary>Podrobnosti a správa platby<ChevronDown /></summary><dl><div><dt>Zdroj</dt><dd>{payment.source === "manual" ? "Ručně potvrzeno" : payment.counterparty_name || "Bankovní výpis"}</dd></div><div><dt>VS</dt><dd>{payment.variable_symbol || "—"}</dd></div><div><dt>ID platby</dt><dd>{payment.external_id}</dd></div>{payment.counterparty_account && <div><dt>Účet</dt><dd>{payment.counterparty_account}</dd></div>}</dl>
          {payment.match_status === "split" && <p>Platba je rozdělená mezi více faktur. Zde je částka přiřazená této faktuře.</p>}{payment.match_reason && <p>Spárováno automaticky: {payment.match_reason}</p>}
          {canManage && <button type="button" className={styles.secondaryButton} disabled={updating} onClick={() => onUnassign(payment)}>Uvolnit platbu</button>}
        </details>
      </article>)}</div>
    </section>}
    {payments.length === 0 && mobile && mobileTab === "payments" && <section className={`${styles.card} ${styles.payments}`} aria-label="Párování plateb"><h2>Platby</h2><p className={styles.description}>K této faktuře zatím nejsou přiřazené žádné platby.</p></section>}
    <section className={`${styles.card} ${styles.reminders}`} id="invoice-reminders" aria-label="Automatické upomínky">
      <header><h2>Automatické upomínky</h2><button type="button" role="switch" aria-label="Automatické upomínky pro tuto fakturu" aria-checked={view.remindersActive} disabled={!canManage || !view.open || updating} className={styles.toggle} onClick={() => onPause(!invoice.reminders_paused)}><span /></button></header>
      <p className={styles.description}>{!view.open ? invoice.status === "paid" ? "Faktura je plně uhrazená." : "Faktura je stornovaná." : invoice.reminders_paused ? "Automatické upomínky jsou pro tuto fakturu pozastavené." : suppression ? "Odesílání čeká na opravu e-mailové adresy." : "Pro tuto fakturu jsou zapnuté automatické upomínky."}</p>
      {suppression && <div className={styles.warning}><strong>Kontaktní e-mail je zablokovaný</strong><p>{suppression.reason === "complained" ? "Příjemce označil zprávu jako spam." : "Přijímající server zprávu trvale odmítl."} Upravte kontaktní e-mail odběratele.</p></div>}
      {view.open ? <div className={styles.nextReminder}><Icon name="calendar" /><div><small>Další plánovaná upomínka</small><strong>{view.remindersActive && !suppression && invoice.next_reminder_at ? detailDate(invoice.next_reminder_at) : "Žádná další upomínka není naplánovaná."}</strong></div></div> : <p className={styles.closedReminder}>Žádná další upomínka není naplánovaná.</p>}
      <details className={styles.disclosure}><summary>Historie a plán upomínek <span>{invoice.reminders_sent} odesláno</span><ChevronDown /></summary>{reminderHistory}</details>
    </section>

    </div>
  </div></>;
}
