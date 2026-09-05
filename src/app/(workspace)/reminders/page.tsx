"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { AppFrame } from "@/components/layout/app-shell";
import { MobileDisclosure } from "@/components/mobile-disclosure";
import { interpolateReminderTemplateValues } from "@/lib/reminder-template";
import { Icon } from "@/components/icons";
import { isAutomationRunStale, type AutomationRun } from "@/lib/automation-run";
import { parseReminderCcInput } from "@/lib/reminder-recipients";
import { defaultReminderTemplates } from "@/lib/reminder-defaults";
import { renderReminderEmail, type ReminderEmailCompany } from "@/lib/reminder-email-template";
import type { ReminderStage } from "@/types/invoice";

type Rule = { id: string; relation: "before" | "on" | "after"; days: number };
type Template = { subject: string; body: string; reply_to: string | null; cc: string[] };
type SettingsChange = { id: string; changed_at: string; changed_by: string };
type ReminderInvoice = { invoice_number: string; counterparty_name: string };
type ReminderOperations = {
  can_run: boolean;
  upcoming: { id: string; invoice_number: string; counterparty_name: string; next_reminder_at: string; amount: number; currency: string }[];
  failed: { id: string; invoice_id: string; stage: ReminderStage; scheduled_for: string; sent_to: string; attempt_count: number; error_message: string | null; delivery_status?: "delayed" | "bounced" | "complained" | "failed" | null; updated_at: string; invoices: ReminderInvoice }[];
  recent: { id: string; invoice_id: string; stage: ReminderStage; sent_at: string; sent_to: string; attempt_count: number; delivery_status?: string | null; invoices: ReminderInvoice }[];
  automation_run: AutomationRun | null;
};
const stageNames: Record<ReminderStage, string> = { before_due: "Před splatností", on_due: "V den splatnosti", overdue: "Po splatnosti", escalation: "Poslední důrazná upomínka" };
const reminderStages = Object.keys(stageNames) as ReminderStage[];
const stageHelp: Record<ReminderStage, string> = { before_due: "Přátelské upozornění, že se blíží termín platby.", on_due: "Informace, že faktura má být dnes uhrazena.", overdue: "Běžná upomínka po překročení splatnosti.", escalation: "Důraznější text při dlouhém prodlení." };
const formatDate = (value: string | null) => value ? new Intl.DateTimeFormat("cs-CZ", { day: "numeric", month: "short", year: "numeric" }).format(new Date(value)) : "—";
const formatDateTime = (value: string | null) => value ? new Intl.DateTimeFormat("cs-CZ", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }).format(new Date(value)) : "—";
const formatMoney = (value: number, currency: string) => new Intl.NumberFormat("cs-CZ", { style: "currency", currency, maximumFractionDigits: 0 }).format(value);
const previewValues = { invoice_number: "TEST-2026-001", variable_symbol: "2026001", counterparty_name: "Ukázkový odběratel s.r.o.", amount: "12 500,00", currency: "CZK", due_date: "13. 8. 2026" };

function toRules(days: number[]): Rule[] { return days.map((day, index) => ({ id: `${day}-${index}`, relation: day < 0 ? "before" : day > 0 ? "after" : "on", days: Math.abs(day) })); }
function sentence(rule: Rule) { if (rule.relation === "on") return "V den splatnosti"; return `${rule.days} ${rule.days === 1 ? "den" : rule.days < 5 ? "dny" : "dní"} ${rule.relation === "before" ? "před splatností" : "po splatnosti"}`; }
function ccInputsFromTemplates(templates: Record<ReminderStage, Template>) { return Object.fromEntries(reminderStages.map(stage => [stage, templates[stage].cc.join(", ")])) as Record<ReminderStage, string>; }

export default function RemindersPage() {
  const [rules, setRules] = useState<Rule[]>([]);
  const [templates, setTemplates] = useState<Record<ReminderStage, Template> | null>(null);
  const [ccInputs, setCcInputs] = useState<Record<ReminderStage, string>>({ before_due: "", on_due: "", overdue: "", escalation: "" });
  const [activeStage, setActiveStage] = useState<ReminderStage>("before_due");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  const [operations, setOperations] = useState<ReminderOperations>({ can_run: false, upcoming: [], failed: [], recent: [], automation_run: null });
  const [automationActive, setAutomationActive] = useState(true);
  const [lastChange, setLastChange] = useState<SettingsChange | null>(null);
  const [company, setCompany] = useState<ReminderEmailCompany | null>(null);
  const [sendingTest, setSendingTest] = useState(false);
  const [runningNow, setRunningNow] = useState(false);
  const automationRunStale = operations.automation_run ? isAutomationRunStale(operations.automation_run) : false;
  const automationRunProblem = automationRunStale || operations.automation_run?.status === "failed" || operations.automation_run?.status === "partial";
  const automationRunOrigin = operations.automation_run?.trigger_source === "manual" ? `ručně · ${operations.automation_run.triggered_by_email ?? "uživatel"}` : "denní automat";
  const automationRunDetail = !operations.automation_run ? "zatím bez zaznamenaného běhu"
    : automationRunStale ? `${automationRunOrigin} · běh se nedokončil a vyžaduje kontrolu`
    : operations.automation_run.status === "running" ? `${automationRunOrigin} právě zpracovává faktury`
    : operations.automation_run.status === "failed" ? `${automationRunOrigin} · ${operations.automation_run.error_message || "běh skončil chybou"}`
    : operations.automation_run.status === "partial" ? `${automationRunOrigin} · ${operations.automation_run.failed} chyb · ${operations.automation_run.sent} odesláno`
    : `${automationRunOrigin} · ${operations.automation_run.checked} zkontrolováno · ${operations.automation_run.sent} odesláno`;

  useEffect(() => { Promise.all(["/api/settings/reminders", "/api/reminders", "/api/settings/company"].map(url => fetch(url).then(async response => { const data = await response.json(); if (!response.ok) throw new Error(data.error); return data; }))).then(([settings, overview, companyData]) => { setAutomationActive(settings.active); setRules(toRules(settings.days)); setTemplates(settings.templates); setCcInputs(ccInputsFromTemplates(settings.templates)); setLastChange(settings.last_change ?? null); setOperations(overview); setCompany(companyData.company ?? null); }).catch(cause => setMessage(cause instanceof Error ? cause.message : "Upomínky se nepodařilo načíst.")).finally(() => setLoading(false)); }, []);
  const sorted = useMemo(() => [...rules].sort((a, b) => (a.relation === "before" ? -a.days : a.relation === "on" ? 0 : a.days) - (b.relation === "before" ? -b.days : b.relation === "on" ? 0 : b.days)), [rules]);
  const renderedPreview = templates && company ? renderReminderEmail({
    company,
    stage: activeStage,
    subject: interpolateReminderTemplateValues(templates[activeStage].subject, previewValues),
    message: interpolateReminderTemplateValues(templates[activeStage].body, previewValues),
    values: previewValues,
    logoUrl: "/brand/drevohlavica.png",
    replyTo: templates[activeStage].reply_to,
  }) : null;
  function update(id: string, patch: Partial<Rule>) { setRules(current => current.map(rule => rule.id === id ? { ...rule, ...patch } : rule)); }
  function add() { setRules(current => current.length >= 10 ? current : [...current, { id: crypto.randomUUID(), relation: "after", days: 7 }]); }
  async function save() { if (!templates) return; if (!rules.length) { setMessage("Přidejte alespoň jednu upomínku."); return; } if (rules.some(rule => !Number.isInteger(rule.days) || (rule.relation !== "on" && (rule.days < 1 || rule.days > (rule.relation === "before" ? 90 : 365))))) { setMessage("Zkontrolujte počet dní: před splatností nejvýše 90, po splatnosti nejvýše 365."); return; } setSaving(true); setMessage(""); const days = rules.map(rule => rule.relation === "before" ? -Math.abs(rule.days) : rule.relation === "after" ? Math.abs(rule.days) : 0); const templatesToSave = Object.fromEntries(reminderStages.map(stage => [stage, { ...templates[stage], cc: parseReminderCcInput(ccInputs[stage]) }])); try { const response = await fetch("/api/settings/reminders", { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ active: automationActive, days, templates: templatesToSave }) }); const data = await response.json(); if (!response.ok) throw new Error(data.error); setAutomationActive(data.active); setRules(toRules(data.days)); setTemplates(data.templates); setCcInputs(ccInputsFromTemplates(data.templates)); setLastChange(data.last_change ?? lastChange); if (!data.active) setOperations(current => ({ ...current, upcoming: [] })); else { const overviewResponse = await fetch("/api/reminders"); const overview = await overviewResponse.json(); if (overviewResponse.ok) setOperations(overview); } setMessage(data.active ? "Pravidla a šablony jsou uložené." : "Automatické odesílání je bezpečně pozastavené."); } catch (cause) { setMessage(cause instanceof Error ? cause.message : "Nastavení se nepodařilo uložit."); } finally { setSaving(false); } }
  async function sendTest() { if (!templates) return; setSendingTest(true); setMessage(""); try { const response = await fetch("/api/settings/reminders/test", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ stage: activeStage, ...templates[activeStage] }) }); const data = await response.json(); if (!response.ok) throw new Error(data.error); setMessage(`Testovací e-mail byl odeslán na ${data.recipient}.`); } catch (cause) { setMessage(cause instanceof Error ? cause.message : "Testovací e-mail se nepodařilo odeslat."); } finally { setSendingTest(false); } }
  function useRecommendedTemplate() { if (!templates) return; setTemplates(current => current && ({ ...current, [activeStage]: { ...current[activeStage], ...defaultReminderTemplates[activeStage] } })); }
  async function runNow() { setRunningNow(true); setMessage(""); try { const response = await fetch("/api/cron/check-due", { method: "POST" }); const result = await response.json(); if (!response.ok) throw new Error(result.error); const overviewResponse = await fetch("/api/reminders"); const overview = await overviewResponse.json(); if (!overviewResponse.ok) throw new Error(overview.error); setOperations(overview); setMessage(`Kontrola je hotová: ${result.checked} faktur, ${result.sent} odeslaných upomínek${result.failed ? `, ${result.failed} chyb` : ""}.`); } catch (cause) { setMessage(cause instanceof Error ? cause.message : "Kontrolu se nepodařilo spustit."); } finally { setRunningNow(false); } }

  return <AppFrame><header className="section-header"><div><p>AUTOMATIZACE</p><h1>Upomínky</h1><span>Nastavte srozumitelný postup, podle kterého aplikace kontaktuje odběratele.</span></div>{operations.can_run && <div className="section-actions"><button className="btn secondary" disabled={runningNow || loading || saving} onClick={runNow}>{runningNow ? "Kontroluji…" : <><Icon name="clock"/>Spustit kontrolu</>}</button></div>}</header>
    {!loading && !operations.can_run && <p className="read-only-note">Máte přístup pouze pro čtení. Pravidla může změnit nebo kontrolu spustit účetní či administrátor.</p>}
    {message && <p className={message.includes("uložené") || message.includes("pozastavené") || message.includes("byl odeslán") || message.startsWith("Kontrola je hotová") ? "success-message" : "form-error"}>{message}</p>}
    <section className={`page-panel automation-switch ${automationActive ? "active" : "paused"}`}><div><i>{automationActive ? "✓" : "Ⅱ"}</i><span><strong>{automationActive ? "Automatické odesílání je zapnuté" : "Automatické odesílání je pozastavené"}</strong><small>{automationActive ? "Faktury se kontrolují podle níže nastaveného plánu." : "Po uložení se žádné další upomínky neodešlou, dokud automat znovu nezapnete."}</small>{lastChange && <em className="settings-audit">Poslední změna {formatDateTime(lastChange.changed_at)} · {lastChange.changed_by}</em>}</span></div><button type="button" role="switch" aria-checked={automationActive} disabled={!operations.can_run} onClick={() => setAutomationActive(value => !value)}><b/><span>{automationActive ? "Zapnuto" : "Pozastaveno"}</span></button></section>
    <section className="reminder-operations"><article className="page-panel"><span>Naplánováno</span><strong>{operations.upcoming.length}</strong><small>nejbližších automatických akcí</small></article><article className={`page-panel ${operations.failed.length ? "has-failures" : ""}`}><span>Vyžaduje kontrolu</span><strong>{operations.failed.length}</strong><small>problémů s odesláním nebo doručením</small></article><article className="page-panel"><span>Naposledy odesláno</span><strong>{operations.recent.length ? formatDate(operations.recent[0].sent_at) : "—"}</strong><small>{operations.recent.length ? operations.recent[0].invoices.invoice_number : "zatím bez zpráv"}</small></article><article className={`page-panel ${automationRunProblem ? "has-failures" : ""}`}><span>Poslední běh automatu</span><strong>{operations.automation_run ? formatDateTime(operations.automation_run.started_at) : "—"}</strong><small>{automationRunDetail}</small></article></section>
    <div className="reminder-monitor-grid"><section className="page-panel reminder-monitor"><header><div><h2>Nejbližší upomínky</h2><p>Co automat odešle podle aktuálního plánu.</p></div></header><div>{operations.upcoming.slice(0, 6).map(item => <Link href={`/invoices/${item.id}`} key={item.id} className="monitor-row"><span><strong>{item.invoice_number}</strong><small>{item.counterparty_name}</small></span><span><strong>{formatDate(item.next_reminder_at)}</strong><small>{formatMoney(item.amount, item.currency)}</small></span></Link>)}{!operations.upcoming.length && <p className="page-state">Žádné upomínky nejsou naplánované.</p>}</div></section><section className="page-panel reminder-monitor"><header><div><h2>Vyžaduje kontrolu</h2><p>Chyby odeslání i problémy s následným doručením.</p></div></header><div>{operations.failed.slice(0, 6).map(item => <Link href={`/invoices/${item.invoice_id}`} key={item.id} className="monitor-row failed"><span><strong>{item.invoices.invoice_number}</strong><small>{item.invoices.counterparty_name} · {item.sent_to}</small></span><span><strong>{item.delivery_status ? item.delivery_status === "delayed" ? "Odložené doručení" : "Nedoručeno" : `${item.attempt_count}. pokus`}</strong><small>{item.error_message || "E-mail se nepodařilo odeslat"}</small></span></Link>)}{!operations.failed.length && <p className="page-state success-state">Všechna odeslání i doručení jsou v pořádku.</p>}</div></section></div>
    <div className="reminders-layout"><section className="page-panel rules-panel"><header><div><h2>Kdy se mají upomínky posílat?</h2><p>Každá faktura používá tento postup, dokud není označena jako zaplacená.</p></div><button className="btn secondary" disabled={!operations.can_run || rules.length >= 10} onClick={add}>+ Přidat další upomínku</button></header>{loading ? <p className="page-state">Načítám pravidla…</p> : <div className="human-rules">{sorted.map((rule, index) => <article key={rule.id}><div className="rule-order">{index + 1}</div><div className="rule-main"><strong>{sentence(rule)}</strong><div className="rule-controls"><span>Odeslat</span>{rule.relation !== "on" && <input type="number" min="1" max={rule.relation === "before" ? 90 : 365} value={rule.days} disabled={!operations.can_run} onChange={e => update(rule.id, { days: Number(e.target.value) })}/>}<select value={rule.relation} disabled={!operations.can_run} onChange={e => update(rule.id, { relation: e.target.value as Rule["relation"], days: e.target.value === "on" ? 0 : rule.days || 1 })}><option value="before">dní před splatností</option><option value="on">v den splatnosti</option><option value="after">dní po splatnosti</option></select></div></div><button className="remove-rule" disabled={!operations.can_run} onClick={() => setRules(current => current.filter(item => item.id !== rule.id))} aria-label="Odstranit pravidlo">×</button></article>)}</div>}</section>
      <MobileDisclosure label="Jak bude proces probíhat" className="reminder-process-disclosure"><aside className="page-panel process-preview"><h2>Jak bude proces probíhat</h2><p>Ukázka pro fakturu splatnou 20. srpna:</p><div className="process-line">{sorted.map((rule, index) => { const date = new Date("2026-08-20T00:00:00"); const offset = rule.relation === "before" ? -rule.days : rule.relation === "after" ? rule.days : 0; date.setDate(date.getDate() + offset); return <div key={rule.id}><i>{index + 1}</i><span><strong>{sentence(rule)}</strong><small>{new Intl.DateTimeFormat("cs-CZ", { day: "numeric", month: "long" }).format(date)}</small></span></div>; })}</div><div className="stop-rule"><strong>Jakmile je faktura zaplacená</strong><span>Všechny další upomínky se automaticky zastaví.</span></div></aside></MobileDisclosure>
    </div>
    {templates && <section className="page-panel templates-page">
      <header><div><h2>Texty e-mailů</h2><p>Vyberte fázi, použijte připravený profesionální text a případně si jej upravte.</p></div><div className="template-header-actions"><button type="button" className="btn secondary" disabled={!operations.can_run} onClick={useRecommendedTemplate}>Použít doporučený text</button><button type="button" className="btn secondary" disabled={sendingTest || !operations.can_run} onClick={sendTest}>{sendingTest ? "Odesílám test…" : "Poslat test na můj e-mail"}</button></div></header>
      <div className="friendly-tabs">{reminderStages.map(stage => <button key={stage} className={activeStage === stage ? "active" : ""} onClick={() => setActiveStage(stage)}><strong>{stageNames[stage]}</strong><span>{stageHelp[stage]}</span></button>)}</div>
      <div className="template-compose"><div className="friendly-template">
        <label><span>Předmět zprávy</span><input value={templates[activeStage].subject} disabled={!operations.can_run} onChange={e => setTemplates(current => current && ({ ...current, [activeStage]: { ...current[activeStage], subject: e.target.value } }))}/></label>
        <label><span>Text zprávy</span><textarea value={templates[activeStage].body} disabled={!operations.can_run} onChange={e => setTemplates(current => current && ({ ...current, [activeStage]: { ...current[activeStage], body: e.target.value } }))}/></label>
        <div className="template-delivery">
          <label><span>Kam mohou odběratelé odpovědět <small>nepovinné</small></span><input type="email" placeholder="např. ucetni@hlavica.cz" value={templates[activeStage].reply_to ?? ""} disabled={!operations.can_run} onChange={e => setTemplates(current => current && ({ ...current, [activeStage]: { ...current[activeStage], reply_to: e.target.value || null } }))}/></label>
          <label><span>Poslat interní kopii <small>nepovinné, nejvýše 5 adres</small></span><input type="text" inputMode="email" placeholder="Adresy oddělte čárkou" value={ccInputs[activeStage]} disabled={!operations.can_run} onChange={e => setCcInputs(current => ({ ...current, [activeStage]: e.target.value }))}/></label>
        </div>
        <div className="variables"><span>Můžete použít:</span>{["{{invoice_number}}", "{{counterparty_name}}", "{{amount}}", "{{currency}}", "{{due_date}}", "{{variable_symbol}}"].map(item => <code key={item}>{item}</code>)}</div>
        <div className="template-save-actions"><button type="button" className="btn primary" disabled={!operations.can_run || saving || loading || runningNow} onClick={save}>{saving ? "Ukládám…" : <><Icon name="check"/>Uložit změny</>}</button></div>
      </div><MobileDisclosure label="Náhled výsledného e-mailu" className="email-preview-disclosure"><aside className="email-preview"><span>NÁHLED E-MAILU</span>{templates[activeStage].reply_to && <small className="preview-meta">Odpovědi: {templates[activeStage].reply_to}</small>}{parseReminderCcInput(ccInputs[activeStage]).length > 0 && <small className="preview-meta">Kopie: {parseReminderCcInput(ccInputs[activeStage]).join(", ")}</small>}{renderedPreview ? <iframe className="email-preview-frame" title="Náhled výsledného e-mailu" sandbox="" srcDoc={renderedPreview.html}/> : <p className="page-state">Připravuji náhled…</p>}<small>Ukázková data se nikam neukládají.</small></aside></MobileDisclosure></div>
    </section>}
  </AppFrame>;
}
