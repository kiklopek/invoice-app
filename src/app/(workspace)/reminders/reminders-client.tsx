"use client";

import { useEffect, useMemo, useState } from "react";
import useSWR from "swr";
import Link from "next/link";
import { AppFrame } from "@/components/layout/app-shell";
import { MobileDisclosure } from "@/components/mobile-disclosure";
import { EmailSuppressionsPanel } from "./email-suppressions-panel";
import { interpolateReminderTemplateValues } from "@/lib/reminder-template";
import { Icon } from "@/components/icons";
import { isAutomationRunStale } from "@/lib/automation-run";
import { parseReminderCcInput } from "@/lib/reminder-recipients";
import { defaultReminderTemplates } from "@/lib/reminder-defaults";
import {
  renderReminderEmail,
  type ReminderEmailCompany,
} from "@/lib/reminder-email-template";
import type { ReminderStage } from "@/types/invoice";
import { type ReminderPolicySummary } from "@/lib/reminder-policies";
import { confirmAction } from "@/lib/confirm-action";
import { apiFetch } from "@/lib/api-client";
import { useToast } from "@/components/toast";
import { useUnsavedChanges } from "@/lib/use-unsaved-changes";
import type {
  ReminderPageData,
  ReminderTemplateSettings,
  SettingsChange,
  ReminderOperations,
} from "@/lib/reminder-page-data";

type Rule = { id: string; relation: "before" | "on" | "after"; days: number };
type Template = ReminderTemplateSettings;
const stageNames: Record<ReminderStage, string> = {
  before_due: "Před splatností",
  on_due: "V den splatnosti",
  overdue: "Po splatnosti",
  escalation: "Poslední důrazná upomínka",
};
const reminderStages = Object.keys(stageNames) as ReminderStage[];
const stageHelp: Record<ReminderStage, string> = {
  before_due: "Přátelské upozornění, že se blíží termín platby.",
  on_due: "Informace, že faktura má být dnes uhrazena.",
  overdue: "Běžná upomínka po překročení splatnosti.",
  escalation: "Důraznější text při dlouhém prodlení.",
};
const formatDate = (value: string | null) =>
  value
    ? new Intl.DateTimeFormat("cs-CZ", {
        day: "numeric",
        month: "short",
        year: "numeric",
      }).format(new Date(value))
    : "—";
const formatDateTime = (value: string | null) =>
  value
    ? new Intl.DateTimeFormat("cs-CZ", {
        day: "numeric",
        month: "short",
        hour: "2-digit",
        minute: "2-digit",
      }).format(new Date(value))
    : "—";
const formatMoney = (value: number, currency: string) =>
  new Intl.NumberFormat("cs-CZ", {
    style: "currency",
    currency,
    maximumFractionDigits: 0,
  }).format(value);
const previewValues = {
  invoice_number: "TEST-2026-001",
  variable_symbol: "2026001",
  counterparty_name: "Ukázkový odběratel s.r.o.",
  amount: "12 500,00",
  currency: "CZK",
  due_date: "13. 8. 2026",
};

function toRules(days: number[]): Rule[] {
  return days.map((day, index) => ({
    id: `${day}-${index}`,
    relation: day < 0 ? "before" : day > 0 ? "after" : "on",
    days: Math.abs(day),
  }));
}
function sentence(rule: Rule) {
  if (rule.relation === "on") return "V den splatnosti";
  return `${rule.days} ${rule.days === 1 ? "den" : rule.days < 5 ? "dny" : "dní"} ${rule.relation === "before" ? "před splatností" : "po splatnosti"}`;
}
function ccInputsFromTemplates(templates: Record<ReminderStage, Template>) {
  return Object.fromEntries(
    reminderStages.map((stage) => [stage, templates[stage].cc.join(", ")]),
  ) as Record<ReminderStage, string>;
}

export function RemindersClient({
  initialData,
}: {
  initialData: ReminderPageData;
}) {
  const initialPolicy =
    initialData.policies.find(
      (policy) => policy.is_default && !policy.archived_at,
    ) ?? initialData.policies.find((policy) => !policy.archived_at);
  const [rules, setRules] = useState<Rule[]>(() =>
    toRules(initialPolicy?.days_from_due ?? initialData.settings.days),
  );
  const [policies, setPolicies] = useState<ReminderPolicySummary[]>(
    initialData.policies,
  );
  const [selectedPolicyId, setSelectedPolicyId] = useState(
    initialPolicy?.id ?? "",
  );
  const [policyName, setPolicyName] = useState(
    initialPolicy?.name ?? "Standardní",
  );
  const [creatingPolicy, setCreatingPolicy] = useState(false);
  const [policyDirty, setPolicyDirty] = useState(false);
  const [globalDirty, setGlobalDirty] = useState(false);
  const [templates, setTemplates] = useState<Record<
    ReminderStage,
    Template
  > | null>(initialData.settings.templates);
  const [ccInputs, setCcInputs] = useState<Record<ReminderStage, string>>(() =>
    ccInputsFromTemplates(initialData.settings.templates),
  );
  const [activeStage, setActiveStage] = useState<ReminderStage>("before_due");
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  const [operations, setOperations] = useState<ReminderOperations>(
    initialData.operations,
  );
  const [automationActive, setAutomationActive] = useState(
    initialData.settings.active,
  );
  const [lastChange, setLastChange] = useState<SettingsChange | null>(
    initialData.settings.last_change,
  );
  const [company, setCompany] = useState<ReminderEmailCompany | null>(
    initialData.company,
  );
  const { showToast } = useToast();
  const [sendingTest, setSendingTest] = useState(false);
  const [runningNow, setRunningNow] = useState(false);
  const automationRunStale = operations.automation_run
    ? isAutomationRunStale(operations.automation_run)
    : false;
  const automationRunProblem =
    automationRunStale ||
    operations.automation_run?.status === "failed" ||
    operations.automation_run?.status === "partial";
  const automationRunOrigin =
    operations.automation_run?.trigger_source === "manual"
      ? `ručně · ${operations.automation_run.triggered_by_email ?? "uživatel"}`
      : "denní automat";
  const automationQueueDetail =
    operations.automation_run && operations.automation_run.status !== "running"
      ? ` · fronta ${operations.automation_run.queued}/${operations.automation_run.processed}/${operations.automation_run.remaining} · plánovač ${operations.automation_run.planner_duration_ms} ms · worker ${operations.automation_run.worker_duration_ms} ms`
      : "";
  const automationRunDetail = !operations.automation_run
    ? "zatím bez zaznamenaného běhu"
    : automationRunStale
      ? `${automationRunOrigin} · běh se nedokončil a vyžaduje kontrolu`
      : operations.automation_run.status === "running"
        ? `${automationRunOrigin} právě zpracovává faktury`
        : operations.automation_run.status === "failed"
          ? `${automationRunOrigin} · ${operations.automation_run.error_message || "běh skončil chybou"}`
          : operations.automation_run.status === "partial"
            ? `${automationRunOrigin} · ${operations.automation_run.failed} chyb · ${operations.automation_run.sent} odesláno${automationQueueDetail}`
            : `${automationRunOrigin} · ${operations.automation_run.checked} zkontrolováno · ${operations.automation_run.sent} odesláno${automationQueueDetail}`;
  const selectedPolicy =
    policies.find((policy) => policy.id === selectedPolicyId) ?? null;
  useUnsavedChanges(policyDirty || globalDirty);
  useEffect(() => {
    const raw = sessionStorage.getItem("splatno:reminders-draft");
    if (!raw) return;
    try {
      const draft = JSON.parse(raw) as {
        baseRevision: string | null;
        rules: Rule[];
        policyName: string;
        selectedPolicyId: string;
        templates: Record<ReminderStage, Template>;
        ccInputs: Record<ReminderStage, string>;
        automationActive: boolean;
      };
      if (draft.baseRevision !== (initialData.settings.last_change?.id ?? null)) {
        sessionStorage.removeItem("splatno:reminders-draft");
        setMessage("Starší koncept upomínek nebyl obnoven, protože nastavení mezitím změnil jiný uživatel.");
        return;
      }
      if (
        window.confirm(
          "Byl nalezen neuložený koncept upomínek. Chcete jej obnovit?",
        )
      ) {
        setRules(draft.rules);
        setPolicyName(draft.policyName);
        setSelectedPolicyId(draft.selectedPolicyId);
        setTemplates(draft.templates);
        setCcInputs(draft.ccInputs);
        setAutomationActive(draft.automationActive);
        setPolicyDirty(true);
        setGlobalDirty(true);
        setMessage("Neuložený koncept upomínek byl obnoven.");
      } else sessionStorage.removeItem("splatno:reminders-draft");
    } catch {
      sessionStorage.removeItem("splatno:reminders-draft");
    }
  }, [initialData.settings.last_change?.id]);
  useEffect(() => {
    if (policyDirty || globalDirty)
      sessionStorage.setItem(
        "splatno:reminders-draft",
        JSON.stringify({
          baseRevision: lastChange?.id ?? null,
          rules,
          policyName,
          selectedPolicyId,
          templates,
          ccInputs,
          automationActive,
        }),
      );
    else sessionStorage.removeItem("splatno:reminders-draft");
  }, [
    automationActive,
    ccInputs,
    globalDirty,
    lastChange?.id,
    policyDirty,
    policyName,
    rules,
    selectedPolicyId,
    templates,
  ]);

  const {
    data: refreshedData,
    error: loadError,
    mutate: refreshPage,
  } = useSWR<ReminderPageData>("/api/reminders/page-data", {
    fallbackData: initialData,
    revalidateOnMount: false,
  });
  useEffect(() => {
    if (!(loadError instanceof Error)) return;
    // Viz detail faktury: přechodný výpadek nemá zůstat viset jako hláška
    // stránky. Výsledky akcí se dál zobrazují u nich.
    showToast({ variant: "error", message: loadError.message });
  }, [loadError, showToast]);
  useEffect(() => {
    if (!refreshedData || policyDirty || globalDirty || creatingPolicy) return;
    const refreshedPolicy =
      refreshedData.policies.find((policy) => policy.id === selectedPolicyId) ??
      refreshedData.policies.find(
        (policy) => policy.is_default && !policy.archived_at,
      ) ??
      refreshedData.policies.find((policy) => !policy.archived_at);
    setPolicies(refreshedData.policies);
    setOperations(refreshedData.operations);
    setAutomationActive(refreshedData.settings.active);
    setTemplates(refreshedData.settings.templates);
    setCcInputs(ccInputsFromTemplates(refreshedData.settings.templates));
    setLastChange(refreshedData.settings.last_change);
    setCompany(refreshedData.company);
    if (refreshedPolicy) {
      setSelectedPolicyId(refreshedPolicy.id);
      setPolicyName(refreshedPolicy.name);
      setRules(toRules(refreshedPolicy.days_from_due));
    }
    setLoading(false);
  }, [
    creatingPolicy,
    globalDirty,
    policyDirty,
    refreshedData,
    selectedPolicyId,
  ]);
  const sorted = useMemo(
    () =>
      [...rules].sort(
        (a, b) =>
          (a.relation === "before"
            ? -a.days
            : a.relation === "on"
              ? 0
              : a.days) -
          (b.relation === "before"
            ? -b.days
            : b.relation === "on"
              ? 0
              : b.days),
      ),
    [rules],
  );
  const renderedPreview =
    templates && company
      ? renderReminderEmail({
          company,
          stage: activeStage,
          subject: interpolateReminderTemplateValues(
            templates[activeStage].subject,
            previewValues,
          ),
          message: interpolateReminderTemplateValues(
            templates[activeStage].body,
            previewValues,
          ),
          values: previewValues,
          logoUrl: "/brand/drevohlavica.png",
          replyTo: templates[activeStage].reply_to,
        })
      : null;
  function update(id: string, patch: Partial<Rule>) {
    setPolicyDirty(true);
    setRules((current) =>
      current.map((rule) => (rule.id === id ? { ...rule, ...patch } : rule)),
    );
  }
  function add() {
    setPolicyDirty(true);
    setRules((current) =>
      current.length >= 10
        ? current
        : [...current, { id: crypto.randomUUID(), relation: "after", days: 7 }],
    );
  }
  async function selectPolicy(id: string) {
    if (id === selectedPolicyId) return;
    if (
      policyDirty &&
      !(await confirmAction({
        title: "Zahodit neuložené změny?",
        description: "Úpravy této kategorie ještě nejsou uložené.",
        confirmLabel: "Zahodit změny",
      }))
    )
      return;
    const policy = policies.find((item) => item.id === id);
    if (!policy) return;
    setCreatingPolicy(false);
    setSelectedPolicyId(id);
    setPolicyName(policy.name);
    setRules(toRules(policy.days_from_due));
    setPolicyDirty(false);
    setMessage("");
  }
  function startCreatingPolicy() {
    const source =
      policies.find((policy) => policy.is_default && !policy.archived_at) ??
      selectedPolicy;
    setCreatingPolicy(true);
    setSelectedPolicyId("");
    setPolicyName("");
    setRules(toRules(source?.days_from_due ?? [-3, 0, 7, 14]));
    setPolicyDirty(true);
    setMessage("");
  }
  function categoryDays() {
    return rules.map((rule) =>
      rule.relation === "before"
        ? -Math.abs(rule.days)
        : rule.relation === "after"
          ? Math.abs(rule.days)
          : 0,
    );
  }
  function validateCategory() {
    if (!policyName.trim()) return "Zadejte název kategorie.";
    if (!rules.length) return "Přidejte alespoň jednu upomínku.";
    if (
      rules.some(
        (rule) =>
          !Number.isInteger(rule.days) ||
          (rule.relation !== "on" &&
            (rule.days < 1 ||
              rule.days > (rule.relation === "before" ? 90 : 365))),
      )
    )
      return "Zkontrolujte počet dní: před splatností nejvýše 90, po splatnosti nejvýše 365.";
    if (new Set(categoryDays()).size !== rules.length)
      return "Každý termín může být v kategorii jen jednou.";
    return null;
  }
  async function saveCategory(makeDefault = false) {
    const validation = validateCategory();
    if (validation) {
      setMessage(validation);
      return;
    }
    setSaving(true);
    setMessage("");
    try {
      const data = await apiFetch<{ policy: ReminderPolicySummary }>(
        "/api/settings/reminder-policies",
        {
        method: creatingPolicy ? "POST" : "PATCH",
        headers: {
          "content-type": "application/json",
          "x-idempotency-key": `policy-${selectedPolicyId || "new"}-${policyName}-${categoryDays().join(",")}`,
        },
        body: JSON.stringify({
          ...(!creatingPolicy && { id: selectedPolicyId }),
          name: policyName,
          days: categoryDays(),
          make_default: makeDefault || selectedPolicy?.is_default,
        }),
      });
      const saved = data.policy as ReminderPolicySummary;
      setPolicies((current) =>
        creatingPolicy
          ? [...current, saved]
          : current.map((policy) =>
              saved.is_default
                ? {
                    ...policy,
                    is_default: policy.id === saved.id,
                    ...(policy.id === saved.id ? saved : {}),
                  }
                : policy.id === saved.id
                  ? saved
                  : policy,
            ),
      );
      setSelectedPolicyId(saved.id);
      setPolicyName(saved.name);
      setRules(toRules(saved.days_from_due));
      setCreatingPolicy(false);
      setPolicyDirty(false);
      setMessage("Kategorie upomínek je uložená.");
      void refreshPage();
    } catch (cause) {
      setMessage(
        cause instanceof Error
          ? cause.message
          : "Kategorii se nepodařilo uložit.",
      );
    } finally {
      setSaving(false);
    }
  }
  async function deleteCategory() {
    if (
      !selectedPolicy ||
      selectedPolicy.is_default ||
      !(await confirmAction({
        title: "Smazat kategorii?",
        description:
          "Kategorie zmizí z nových voleb. Uložené faktury si kvůli historii ponechají její název a plán.",
        confirmLabel: "Smazat kategorii",
      }))
    )
      return;
    setSaving(true);
    try {
      await apiFetch(
        `/api/settings/reminder-policies?id=${encodeURIComponent(selectedPolicy.id)}`,
        {
          method: "DELETE",
          headers: { "x-idempotency-key": `policy-delete-${selectedPolicy.id}` },
        },
      );
      const remaining = policies.filter(
        (policy) => policy.id !== selectedPolicy.id,
      );
      const next =
        remaining.find((policy) => policy.is_default) ?? remaining[0];
      setPolicies(remaining);
      setSelectedPolicyId(next?.id ?? "");
      setPolicyName(next?.name ?? "");
      setRules(toRules(next?.days_from_due ?? [-3, 0, 7, 14]));
      setPolicyDirty(false);
      setMessage("Kategorie byla smazána.");
      void refreshPage();
    } catch (cause) {
      setMessage(
        cause instanceof Error
          ? cause.message
          : "Kategorii se nepodařilo smazat.",
      );
    } finally {
      setSaving(false);
    }
  }
  async function save() {
    if (!templates) return;
    setSaving(true);
    setMessage("");
    const defaultDays = policies.find((policy) => policy.is_default)
      ?.days_from_due ?? [-3, 0, 7, 14];
    const templatesToSave = Object.fromEntries(
      reminderStages.map((stage) => [
        stage,
        { ...templates[stage], cc: parseReminderCcInput(ccInputs[stage]) },
      ]),
    );
    try {
      const data = await apiFetch<{
        active: boolean;
        templates: Record<ReminderStage, Template>;
        last_change?: SettingsChange | null;
      }>("/api/settings/reminders", {
        method: "PUT",
        headers: {
          "content-type": "application/json",
          "x-idempotency-key": `reminders-${lastChange?.id ?? "initial"}`,
        },
        body: JSON.stringify({
          active: automationActive,
          days: defaultDays,
          templates: templatesToSave,
          revision: lastChange?.id ?? null,
        }),
      });
      setAutomationActive(data.active);
      setTemplates(data.templates);
      setCcInputs(ccInputsFromTemplates(data.templates));
      setLastChange(data.last_change ?? lastChange);
      setGlobalDirty(false);
      if (!policyDirty) sessionStorage.removeItem("splatno:reminders-draft");
      if (!data.active)
        setOperations((current) => ({ ...current, upcoming: [] }));
      else {
        const overview = await apiFetch<ReminderOperations>("/api/reminders");
        setOperations(overview);
      }
      setMessage(
        data.active
          ? "Společné nastavení a šablony jsou uložené."
          : "Automatické odesílání je bezpečně pozastavené.",
      );
    } catch (cause) {
      setMessage(
        cause instanceof Error
          ? cause.message
          : "Nastavení se nepodařilo uložit.",
      );
    } finally {
      setSaving(false);
    }
  }
  async function sendTest() {
    if (!templates) return;
    setSendingTest(true);
    setMessage("");
    try {
      const data = await apiFetch<{ recipient: string }>(
        "/api/settings/reminders/test",
        {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-idempotency-key": `reminder-test-${activeStage}-${crypto.randomUUID()}`,
        },
        body: JSON.stringify({ stage: activeStage, ...templates[activeStage] }),
      });
      setMessage(`Testovací e-mail byl odeslán na ${data.recipient}.`);
    } catch (cause) {
      setMessage(
        cause instanceof Error
          ? cause.message
          : "Testovací e-mail se nepodařilo odeslat.",
      );
    } finally {
      setSendingTest(false);
    }
  }
  function useRecommendedTemplate() {
    if (!templates) return;
    setGlobalDirty(true);
    setTemplates(
      (current) =>
        current && {
          ...current,
          [activeStage]: {
            ...current[activeStage],
            ...defaultReminderTemplates[activeStage],
          },
        },
    );
  }
  async function runNow() {
    // Tohle rozešle skutečné e-maily zákazníkům a vzít zpět to nejde.
    // Dřív stačilo jedno kliknutí bez jakéhokoli potvrzení -- na stránce,
    // kde jsou vedle toho jen neškodné akce jako úprava šablony.
    const waiting = operations.upcoming.length;
    if (!(await confirmAction({
      title: "Spustit kontrolu upomínek?",
      description: waiting
        ? `Naplánovaným fakturám se rozešlou upomínky e-mailem (aktuálně čeká ${waiting}). Odeslané e-maily nelze vzít zpět.`
        : "Splatným fakturám se rozešlou upomínky e-mailem. Odeslané e-maily nelze vzít zpět.",
      confirmLabel: "Spustit a odeslat",
    }))) return;
    setRunningNow(true);
    setMessage("");
    try {
      const result = await apiFetch<{
        checked: number;
        sent: number;
        failed: number;
      }>("/api/cron/check-due", {
        method: "POST",
        headers: { "x-idempotency-key": `reminder-run-${crypto.randomUUID()}` },
      });
      const overview = await apiFetch<ReminderOperations>("/api/reminders");
      setOperations(overview);
      setMessage(
        `Kontrola je hotová: ${result.checked} faktur, ${result.sent} odeslaných upomínek${result.failed ? `, ${result.failed} chyb` : ""}.`,
      );
    } catch (cause) {
      setMessage(
        cause instanceof Error
          ? cause.message
          : "Kontrolu se nepodařilo spustit.",
      );
    } finally {
      setRunningNow(false);
    }
  }

  return (
    <AppFrame>
      <header className="section-header reminders-hero">
        <div className="reminders-hero-copy">
          <p>AUTOMATIZACE</p>
          <h1>Upomínky</h1>
          <span>
            Nastavte srozumitelný postup, podle kterého aplikace kontaktuje
            odběratele.
          </span>
        </div>
        <div className="section-actions reminders-hero-side">
          <span className={`reminders-hero-status ${automationActive ? "is-active" : "is-paused"}`}>
            <i aria-hidden="true" />
            {automationActive ? "Automat je aktivní" : "Automat je pozastavený"}
          </span>
          {operations.can_run && (
            <button
              className="btn secondary reminders-hero-run"
              disabled={runningNow || loading || saving}
              onClick={runNow}
            >
              {runningNow ? (
                "Kontroluji…"
              ) : (
                <>
                  <Icon name="clock" />
                  Spustit kontrolu
                </>
              )}
            </button>
          )}
        </div>
      </header>
      {!loading && !operations.can_run && (
        <p className="read-only-note">
          Máte přístup pouze pro čtení. Pravidla může změnit nebo kontrolu
          spustit účetní či administrátor.
        </p>
      )}
      {message && (
        <p
          className={
            message.includes("uložené") ||
            message.includes("pozastavené") ||
            message.includes("byl odeslán") ||
            message.startsWith("Kontrola je hotová")
              ? "success-message"
              : "form-error"
          }
        >
          {message}
        </p>
      )}
      <section
        className={`page-panel automation-switch reminders-automation-card ${automationActive ? "active" : "paused"}`}
      >
        <div>
          <i>{automationActive ? "✓" : "Ⅱ"}</i>
          <span>
            <strong>
              {automationActive
                ? "Automatické odesílání je zapnuté"
                : "Automatické odesílání je pozastavené"}
            </strong>
            <small>
              {automationActive
                ? "Faktury se kontrolují podle níže nastaveného plánu."
                : "Po uložení se žádné další upomínky neodešlou, dokud automat znovu nezapnete."}
            </small>
            {lastChange && (
              <em className="settings-audit">
                Poslední změna {formatDateTime(lastChange.changed_at)} ·{" "}
                {lastChange.changed_by}
              </em>
            )}
          </span>
        </div>
        <button
          type="button"
          role="switch"
          aria-checked={automationActive}
          disabled={!operations.can_run || saving}
          onClick={() => {
            setGlobalDirty(true);
            setAutomationActive((value) => !value);
          }}
        >
          <b />
          <span>{automationActive ? "Zapnuto" : "Pozastaveno"}</span>
        </button>
        {/* Přepínač se dřív dal uložit JEN tlačítkem schovaným uvnitř sbalené
            sekce „Texty e-mailů“ někde jinde na stránce. Uživatel tedy
            automat vypnul, odešel — a upomínky dál odcházely. Uložení je teď
            přímo u přepínače, který se změnil. */}
        {globalDirty && operations.can_run && (
          <div className="reminders-switch-save" role="status">
            <span>{automationActive ? "Automat bude zapnutý." : "Automat bude pozastavený."} Změna zatím není uložená.</span>
            <button type="button" className="btn primary compact" disabled={saving || loading || runningNow} onClick={save}>
              {saving ? "Ukládám…" : "Uložit změnu"}
            </button>
          </div>
        )}
      </section>
      <section className="reminder-operations reminder-quick-stats">
        <article className="page-panel reminder-stat-card is-scheduled">
          <span className="reminder-stat-icon"><Icon name="clock" /></span>
          <div>
            <span>Naplánováno</span>
            <strong>{operations.upcoming.length}</strong>
            <small>nejbližších automatických akcí</small>
          </div>
        </article>
        <article
          className={`page-panel reminder-stat-card is-attention ${operations.failed.length || automationRunProblem ? "has-failures" : ""}`}
        >
          <span className="reminder-stat-icon"><Icon name={operations.failed.length || automationRunProblem ? "alert" : "check"} /></span>
          <div>
            <span>Vyžaduje kontrolu</span>
            <strong>{operations.failed.length}</strong>
            <small>
              {automationRunProblem && !operations.failed.length
                ? "poslední běh automatu vyžaduje kontrolu"
                : "problémů s odesláním nebo doručením"}
            </small>
          </div>
        </article>
      </section>
      <section className="page-panel policy-toolbar reminders-policy-toolbar">
        <div>
          <h2 id="reminder-policy-heading">Kategorie upomínek</h2>
          <div className="policy-select-wrap">
            <select
              id="reminder-policy-select"
              aria-labelledby="reminder-policy-heading"
              value={selectedPolicyId}
              disabled={loading || creatingPolicy}
              onChange={(event) => void selectPolicy(event.target.value)}
            >
              {policies
                .filter((policy) => !policy.archived_at)
                .map((policy) => (
                  <option key={policy.id} value={policy.id}>
                    {policy.name}
                    {policy.is_default ? " · Výchozí" : ""}
                  </option>
                ))}
            </select>
          </div>
        </div>
        <button
          type="button"
          className="btn primary"
          disabled={!operations.can_run || creatingPolicy || policyDirty}
          onClick={startCreatingPolicy}
        >
          + Přidat kategorii
        </button>
      </section>
      <div className="reminders-layout">
        <section className="page-panel rules-panel reminders-rules-card">
          <header>
            <div>
              <h2>
                {creatingPolicy
                  ? "Nová kategorie"
                  : "Kdy se mají upomínky posílat?"}
              </h2>
              <p>
                Změny se použijí pro nové faktury. Uložené faktury si ponechají
                svůj plán.
              </p>
            </div>
            <button
              className="btn secondary"
              disabled={!operations.can_run || rules.length >= 10}
              onClick={add}
            >
              + Přidat další upomínku
            </button>
          </header>
          {loading ? (
            <p className="page-state">Načítám pravidla…</p>
          ) : (
            <>
              <div className="policy-name-row">
                <label>
                  <span>Název kategorie</span>
                  <input
                    maxLength={100}
                    value={policyName}
                    disabled={!operations.can_run}
                    placeholder="např. Klíčoví zákazníci"
                    onChange={(event) => {
                      setPolicyName(event.target.value);
                      setPolicyDirty(true);
                    }}
                  />
                </label>
                {selectedPolicy?.is_default && (
                  <span className="policy-default-badge">Výchozí</span>
                )}
              </div>
              <div className="human-rules">
                {sorted.map((rule, index) => (
                  <article key={rule.id}>
                    <div className="rule-order">{index + 1}</div>
                    <div className="rule-main">
                      <strong>{sentence(rule)}</strong>
                      <div className="rule-controls">
                        <span>Odeslat</span>
                        {rule.relation !== "on" && (
                          <input
                            aria-label="Počet dní"
                            type="number"
                            min="1"
                            max={rule.relation === "before" ? 90 : 365}
                            value={rule.days}
                            disabled={!operations.can_run}
                            onChange={(e) =>
                              update(rule.id, { days: Number(e.target.value) })
                            }
                          />
                        )}
                        <select
                          aria-label="Vztah ke splatnosti"
                          value={rule.relation}
                          disabled={!operations.can_run}
                          onChange={(e) =>
                            update(rule.id, {
                              relation: e.target.value as Rule["relation"],
                              days:
                                e.target.value === "on" ? 0 : rule.days || 1,
                            })
                          }
                        >
                          <option value="before">dní před splatností</option>
                          <option value="on">v den splatnosti</option>
                          <option value="after">dní po splatnosti</option>
                        </select>
                      </div>
                    </div>
                    <button
                      type="button"
                      className="remove-rule"
                      disabled={!operations.can_run || rules.length === 1}
                      onClick={() => {
                        setPolicyDirty(true);
                        setRules((current) =>
                          current.filter((item) => item.id !== rule.id),
                        );
                      }}
                      aria-label="Odstranit pravidlo"
                    >
                      ×
                    </button>
                  </article>
                ))}
              </div>
              <div className="policy-actions">
                {creatingPolicy && (
                  <button
                    type="button"
                    className="btn secondary"
                    onClick={() => {
                      const fallback =
                        policies.find((policy) => policy.is_default) ??
                        policies[0];
                      if (fallback) void selectPolicy(fallback.id);
                    }}
                  >
                    Zrušit
                  </button>
                )}
                {selectedPolicy && !selectedPolicy.is_default && (
                  <button
                    type="button"
                    className="btn secondary"
                    disabled={saving || policyDirty}
                    onClick={() => void saveCategory(true)}
                  >
                    Nastavit jako výchozí
                  </button>
                )}
                {selectedPolicy && !selectedPolicy.is_default && (
                  <button
                    type="button"
                    className="btn secondary danger-button"
                    disabled={saving || policyDirty}
                    onClick={() => void deleteCategory()}
                  >
                    Smazat kategorii
                  </button>
                )}
                <button
                  type="button"
                  className="btn primary"
                  disabled={!operations.can_run || saving || !policyDirty}
                  onClick={() => void saveCategory()}
                >
                  {saving ? "Ukládám…" : "Uložit kategorii"}
                </button>
              </div>
            </>
          )}
        </section>
        <MobileDisclosure
          label="Jak bude proces probíhat"
          className="reminder-process-disclosure"
        >
          <aside className="page-panel process-preview reminders-process-card">
            <h2>Jak bude proces probíhat</h2>
            <p>Ukázka pro fakturu splatnou 20. srpna:</p>
            <div className="process-line">
              {sorted.map((rule, index) => {
                const date = new Date("2026-08-20T00:00:00");
                const offset =
                  rule.relation === "before"
                    ? -rule.days
                    : rule.relation === "after"
                      ? rule.days
                      : 0;
                date.setDate(date.getDate() + offset);
                return (
                  <div key={rule.id}>
                    <i>{index + 1}</i>
                    <span>
                      <strong>{sentence(rule)}</strong>
                      <small>
                        {new Intl.DateTimeFormat("cs-CZ", {
                          day: "numeric",
                          month: "long",
                        }).format(date)}
                      </small>
                    </span>
                  </div>
                );
              })}
            </div>
            <div className="stop-rule">
              <strong>Jakmile je faktura zaplacená</strong>
              <span>Všechny další upomínky se automaticky zastaví.</span>
            </div>
          </aside>
        </MobileDisclosure>
      </div>
      <details className={`page-panel reminder-section-disclosure ${operations.failed.length || automationRunProblem ? "has-alert" : ""}`}>
        <summary>
          <span>
            <strong>Provozní přehled a historie</strong>
            <small>
              Poslední běh automatu, naplánované upomínky a položky ke kontrole.
            </small>
          </span>
          <span className="reminder-disclosure-meta">
            {operations.failed.length > 0 ? (
              <em>
                {operations.failed.length}{" "}
                {operations.failed.length === 1
                  ? "problém"
                  : operations.failed.length < 5
                    ? "problémy"
                    : "problémů"}
              </em>
            ) : automationRunProblem ? (
              <em>Vyžaduje kontrolu</em>
            ) : null}
            <i aria-hidden="true" />
          </span>
        </summary>
        <div className="reminder-disclosure-body">
          <section className="reminder-operations reminder-detail-stats">
            <article>
              <span>Naposledy odesláno</span>
              <strong>
                {operations.recent.length
                  ? formatDate(operations.recent[0].sent_at)
                  : "—"}
              </strong>
              <small>
                {operations.recent.length
                  ? operations.recent[0].invoices.invoice_number
                  : "zatím bez zpráv"}
              </small>
            </article>
            <article className={automationRunProblem ? "has-failures" : ""}>
              <span>Poslední běh automatu</span>
              <strong>
                {operations.automation_run
                  ? formatDateTime(operations.automation_run.started_at)
                  : "—"}
              </strong>
              <small>{automationRunDetail}</small>
            </article>
          </section>
          <div className="reminder-monitor-grid">
            <section className="reminder-monitor">
              <header>
                <div>
                  <h2>Nejbližší upomínky</h2>
                  <p>Co automat odešle podle aktuálního plánu.</p>
                </div>
              </header>
              <div>
                {operations.upcoming.slice(0, 6).map((item) => (
                  <Link
                    href={`/invoices/${item.id}`}
                    key={item.id}
                    className="monitor-row"
                  >
                    <span>
                      <strong>{item.invoice_number}</strong>
                      <small>{item.counterparty_name}</small>
                    </span>
                    <span>
                      <strong>{formatDate(item.next_reminder_at)}</strong>
                      <small>{formatMoney(item.amount, item.currency)}</small>
                    </span>
                  </Link>
                ))}
                {!operations.upcoming.length && (
                  <p className="page-state">
                    Žádné upomínky nejsou naplánované.
                  </p>
                )}
              </div>
            </section>
            <section className="reminder-monitor">
              <header>
                <div>
                  <h2>Vyžaduje kontrolu</h2>
                  <p>Chyby odeslání i problémy s následným doručením.</p>
                </div>
              </header>
              <div>
                {operations.failed.slice(0, 6).map((item) => (
                  <Link
                    href={`/invoices/${item.invoice_id}`}
                    key={item.id}
                    className="monitor-row failed"
                  >
                    <span>
                      <strong>{item.invoices.invoice_number}</strong>
                      <small>
                        {item.invoices.counterparty_name} · {item.sent_to}
                      </small>
                    </span>
                    <span>
                      <strong>
                        {item.delivery_status
                          ? item.delivery_status === "delayed"
                            ? "Odložené doručení"
                            : "Nedoručeno"
                          : `${item.attempt_count}. pokus`}
                      </strong>
                      <small>
                        {item.error_message || "E-mail se nepodařilo odeslat"}
                      </small>
                    </span>
                  </Link>
                ))}
                {!operations.failed.length && (
                  <p className="page-state success-state">
                    Všechna odeslání i doručení jsou v pořádku.
                  </p>
                )}
              </div>
            </section>
          </div>
        </div>
      </details>
      {templates && (
        <details className="page-panel reminder-section-disclosure reminder-email-settings">
          <summary>
            <span>
              <strong>Texty e-mailů pro všechny kategorie</strong>
              <small>
                Společné texty, předměty a adresy používané u všech kategorií.
              </small>
            </span>
            <span className="reminder-disclosure-meta">
              <i aria-hidden="true" />
            </span>
          </summary>
          <section className="templates-page reminder-disclosure-body">
            <div className="template-header-actions reminder-template-actions">
              <button
                type="button"
                className="btn secondary"
                disabled={!operations.can_run}
                onClick={useRecommendedTemplate}
              >
                Použít doporučený text
              </button>
              <button
                type="button"
                className="btn secondary"
                disabled={sendingTest || !operations.can_run}
                onClick={sendTest}
              >
                {sendingTest ? "Odesílám test…" : "Poslat test na můj e-mail"}
              </button>
            </div>
            <div className="friendly-tabs">
              {reminderStages.map((stage) => (
                <button
                  key={stage}
                  className={activeStage === stage ? "active" : ""}
                  onClick={() => setActiveStage(stage)}
                >
                  <strong>{stageNames[stage]}</strong>
                  <span>{stageHelp[stage]}</span>
                </button>
              ))}
            </div>
            <div className="template-compose">
              <div className="friendly-template">
                <label>
                  <span>Předmět zprávy</span>
                  <input
                    value={templates[activeStage].subject}
                    disabled={!operations.can_run}
                    onChange={(e) => {
                      setGlobalDirty(true);
                      setTemplates(
                        (current) =>
                          current && {
                            ...current,
                            [activeStage]: {
                              ...current[activeStage],
                              subject: e.target.value,
                            },
                          },
                      );
                    }}
                  />
                </label>
                <label>
                  <span>Text zprávy</span>
                  <textarea
                    value={templates[activeStage].body}
                    disabled={!operations.can_run}
                    onChange={(e) => {
                      setGlobalDirty(true);
                      setTemplates(
                        (current) =>
                          current && {
                            ...current,
                            [activeStage]: {
                              ...current[activeStage],
                              body: e.target.value,
                            },
                          },
                      );
                    }}
                  />
                </label>
                <div className="template-delivery">
                  <label>
                    <span>
                      Kam mohou odběratelé odpovědět <small>nepovinné</small>
                    </span>
                    <input
                      type="email"
                      placeholder="např. ucetni@hlavica.cz"
                      value={templates[activeStage].reply_to ?? ""}
                      disabled={!operations.can_run}
                      onChange={(e) => {
                        setGlobalDirty(true);
                        setTemplates(
                          (current) =>
                            current && {
                              ...current,
                              [activeStage]: {
                                ...current[activeStage],
                                reply_to: e.target.value || null,
                              },
                            },
                        );
                      }}
                    />
                  </label>
                  <label>
                    <span>
                      Poslat interní kopii{" "}
                      <small>nepovinné, nejvýše 5 adres</small>
                    </span>
                    <input
                      type="text"
                      inputMode="email"
                      placeholder="Adresy oddělte čárkou"
                      value={ccInputs[activeStage]}
                      disabled={!operations.can_run}
                      onChange={(e) => {
                        setGlobalDirty(true);
                        setCcInputs((current) => ({
                          ...current,
                          [activeStage]: e.target.value,
                        }));
                      }}
                    />
                  </label>
                </div>
                <div className="variables">
                  <span>Můžete použít:</span>
                  {[
                    "{{invoice_number}}",
                    "{{counterparty_name}}",
                    "{{amount}}",
                    "{{currency}}",
                    "{{due_date}}",
                    "{{variable_symbol}}",
                  ].map((item) => (
                    <code key={item}>{item}</code>
                  ))}
                </div>
                <div className="template-save-actions">
                  <button
                    type="button"
                    className="btn primary"
                    disabled={
                      !operations.can_run || saving || loading || runningNow
                    }
                    onClick={save}
                  >
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
              <MobileDisclosure
                label="Náhled výsledného e-mailu"
                className="email-preview-disclosure"
              >
                <aside className="email-preview">
                  <span>NÁHLED E-MAILU</span>
                  {templates[activeStage].reply_to && (
                    <small className="preview-meta">
                      Odpovědi: {templates[activeStage].reply_to}
                    </small>
                  )}
                  {parseReminderCcInput(ccInputs[activeStage]).length > 0 && (
                    <small className="preview-meta">
                      Kopie:{" "}
                      {parseReminderCcInput(ccInputs[activeStage]).join(", ")}
                    </small>
                  )}
                  {renderedPreview ? (
                    <iframe
                      className="email-preview-frame"
                      title="Náhled výsledného e-mailu"
                      sandbox=""
                      srcDoc={renderedPreview.html}
                    />
                  ) : (
                    <p className="page-state">Připravuji náhled…</p>
                  )}
                  <small>Ukázková data se nikam neukládají.</small>
                </aside>
              </MobileDisclosure>
            </div>
          </section>
        </details>
      )}
      <EmailSuppressionsPanel />
    </AppFrame>
  );
}
