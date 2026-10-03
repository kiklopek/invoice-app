"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { apiFetch } from "@/lib/api-client";
import { confirmAction } from "@/lib/confirm-action";
import type { AssistanceFlags } from "@/lib/payment-assistance-flags";
import type { AssistanceProposalRow, PayerMemoryRow, AssistanceJobRow } from "@/types/payment-assistance";
import type { PaymentsPagePayment } from "@/lib/payments-page-data";
import styles from "./payment-assistance.module.css";

type Source = { id: string; counterparty_ico: string; customer_name: string; counterparty_account: string | null; counterparty_name: string | null; note: string | null; amount: number; currency: string };
type Overview = {
  flags: AssistanceFlags; proposals: AssistanceProposalRow[]; memories: PayerMemoryRow[]; sources: Source[];
  payments: Array<{ id: string; counterparty_name: string | null; amount: number; currency: string; assistance_waiting: boolean }>;
  job: AssistanceJobRow | null; metrics: { confirmed: number; rejected: number };
};
const endpoint = "/api/payments/assistance";
const money = (amount: number, currency: string) => new Intl.NumberFormat("cs-CZ", { style:"currency",currency }).format(amount);
const labels = { unique:"Návrh k potvrzení",ambiguous:"Nejednoznačné",waiting:"Chybí přesná shoda",complex:"Nutná ruční kontrola" };

export function PaymentAssistancePanel({ flags, payments, onConfirmed }: { flags: AssistanceFlags; payments: PaymentsPagePayment[]; onConfirmed: () => Promise<void> }) {
  const [data,setData] = useState<Overview | null>(null);
  const [error,setError] = useState("");
  const [notice,setNotice] = useState("");
  const [working,setWorking] = useState(false);
  const [editing,setEditing] = useState<PayerMemoryRow | null>(null);
  const [sourceId,setSourceId] = useState("");
  const [account,setAccount] = useState("");
  const [payerName,setPayerName] = useState("");
  const [reference,setReference] = useState("");
  const reload = useCallback(async () => {
    try { setData(await apiFetch<Overview>(endpoint)); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "Návrhy nejsou dostupné."); }
  },[]);
  useEffect(() => { void reload(); },[reload,payments]);

  async function mutate(body: object, refresh = false) {
    setWorking(true); setError(""); setNotice("");
    try {
      await apiFetch(endpoint,{ method:"POST",headers:{ "content-type":"application/json" },body:JSON.stringify(body) });
      if (refresh) await onConfirmed();
      await reload();
      setNotice("Změna byla uložena.");
      return true;
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Změnu se nepodařilo uložit."); return false; }
    finally { setWorking(false); }
  }
  async function decide(row: AssistanceProposalRow, accept: boolean) {
    if (accept) {
      const p = row.proposal;
      const amount = p.allocations.reduce((sum,a) => sum+a.amount,0);
      if (!await confirmAction({ title:"Potvrdit navržené přiřazení?",description:`${p.payment_ids.length} plateb → ${p.invoice_ids.length} faktur, celkem ${money(amount,p.currency)}. Faktury budou označeny jako uhrazené.`,confirmLabel:"Potvrdit přiřazení" })) return;
    }
    await mutate({ action:"decide",proposal_id:row.id,accept },accept);
  }
  function editMemory(memory: PayerMemoryRow | null, source?: Source) {
    setEditing(memory); setSourceId(source?.id ?? memory?.source_payment_ids[0] ?? "");
    setAccount(memory?.account ?? source?.counterparty_account ?? "");
    setPayerName(memory?.payer_name ?? source?.counterparty_name ?? "");
    setReference(memory?.reference ?? "");
  }
  async function saveMemory(active = true) {
    const source = data?.sources.find(s => s.id === sourceId);
    if (!source && !editing) return;
    const saved = await mutate({ action:"memory",id:editing?.id ?? null,revision:editing?.revision ?? 0,
      counterparty_ico:source?.counterparty_ico ?? editing?.counterparty_ico,account:account || null,payer_name:payerName || null,reference:reference || null,
      source_payment_ids:source ? [source.id] : editing?.source_payment_ids,active });
    if (saved) editMemory(null);
  }
  if (data?.flags.mode === "off") return null;
  return <section className={`page-panel ${styles.panel}`} aria-labelledby="assistance-title">
    <header className={styles.header}><div><h2 id="assistance-title">Nové návrhy párování</h2>
      <p>{flags.mode === "shadow" ? "Probíhá porovnávání bez změny úhrad. Současné párování pokračuje." : "Tyto návrhy se zaúčtují až po vašem potvrzení. Současné párování pokračuje."}</p></div>
      <button type="button" className="btn secondary compact" disabled={working} onClick={() => mutate({ action:"reevaluate" })}>Znovu vyhodnotit</button>
    </header>
    {error && <p className="form-error" role="alert">{error}</p>}
    {notice && <p role="status">{notice}</p>}
    {data?.job?.last_error && <p role="status">Vyhodnocení se nepodařilo dokončit. Fronta zachovala požadavek pro další pokus.</p>}
    {data?.job && data.job.requested_generation > data.job.completed_generation && <p role="status">Nové vyhodnocení čeká na zpracování.</p>}
    {flags.mode === "review" && data && <>
      {!data.proposals.length && <p>Zatím nejsou nové návrhy. Použijte současné ruční přiřazení nebo spusťte nové vyhodnocení.</p>}
      <div className={styles.list}>{data.proposals.map(row => {
        const p = row.proposal;
        return <article key={row.id} className={styles.card}>
          <strong>{labels[p.kind]} · {p.payment_ids.length} plateb / {p.invoice_ids.length} faktur</strong><p>{p.reason}</p>
          {p.snapshot.payments.map(payment => <p key={payment.id}>Platba {payment.booked_on} · {payment.counterparty_name || "Neznámý plátce"} · {money(payment.amount-payment.allocated_amount,payment.currency)}</p>)}
          {p.allocations.map(a => <p key={`${a.payment_id}:${a.invoice_id}`}>
            {p.snapshot.payments.find(payment => payment.id === a.payment_id)?.booked_on} → <Link href={`/invoices/${a.invoice_id}`}>Faktura {p.snapshot.invoices.find(i => i.id === a.invoice_id)?.invoice_number}</Link> · {money(a.amount,p.currency)}
          </p>)}
          <div className={styles.actions}>{p.kind === "unique" && <button type="button" className="btn primary compact" disabled={working} onClick={() => decide(row,true)}>Potvrdit přiřazení</button>}
            <button type="button" className="btn secondary compact" disabled={working} onClick={() => decide(row,false)}>Odmítnout návrh</button></div>
        </article>;
      })}</div>
      <details><summary>Platby čekající na doplnění faktur</summary><div className={styles.list}>{data.payments.map(p => <div className={styles.card} key={p.id}>
        <span>{p.counterparty_name || "Neznámý plátce"} · {money(p.amount,p.currency)} {p.assistance_waiting && "· Čeká na fakturu"}</span>
        <button type="button" className="btn secondary compact" aria-pressed={p.assistance_waiting} disabled={working} onClick={() => mutate({ action:"waiting",payment_id:p.id,waiting:!p.assistance_waiting })}>{p.assistance_waiting ? "Zrušit čekání" : "Čeká na fakturu"}</button>
      </div>)}</div></details>
      {flags.memory && <details><summary>Paměť zákazníků · zapamatovat pro příště</summary>
        <p>Ukládejte jen osobně ověřené vazby. Reference níže znamená přesný opakující se text zprávy, například číslo objednávky.</p>
        <div className={styles.list}>{data.memories.map(m => <div className={styles.card} key={m.id}>
          <span>IČO {m.counterparty_ico} · {m.account || m.payer_name || m.reference} · {m.active ? "Aktivní" : "Neaktivní"}</span>
          <button type="button" className="btn secondary compact" disabled={working} onClick={() => editMemory(m)}>Upravit vazbu</button>
        </div>)}</div>
        <form className={styles.form} onSubmit={event => { event.preventDefault(); void saveMemory(); }}>
          <label>Zdrojová ručně potvrzená platba<select value={sourceId} onChange={event => editMemory(editing,data.sources.find(s => s.id === event.target.value))}>
            <option value="">Vyberte ověřenou platbu</option>{data.sources.map(s => <option key={s.id} value={s.id}>{s.customer_name} · {money(s.amount,s.currency)} · {s.counterparty_name}</option>)}
          </select></label>
          <label>Účet plátce<input maxLength={100} value={account} onChange={e => setAccount(e.target.value)} /></label>
          <label>Název plátce<input maxLength={200} value={payerName} onChange={e => setPayerName(e.target.value)} /></label>
          <label>Opakující se reference<input maxLength={500} value={reference} onChange={e => setReference(e.target.value)} /></label>
          <div className={styles.actions}><button type="submit" className="btn secondary compact" disabled={working || (!sourceId && !editing)}>Zapamatovat pro příště</button>
            {editing && <><button type="button" className="btn secondary compact" disabled={working} onClick={() => saveMemory(false)}>Deaktivovat</button><button type="button" className="btn secondary compact" onClick={() => editMemory(null)}>Zrušit úpravu</button></>}
          </div>
        </form>
      </details>}
      <small>Potvrzeno: {data.metrics.confirmed} · odmítnuto: {data.metrics.rejected}. Seznamy zobrazují nejvýše 100 posledních položek.</small>
    </>}
  </section>;
}
