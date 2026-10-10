"use client";

import { useEffect, useState } from "react";
import styles from "./settings-page.module.css";
import useSWR from "swr";
import { AppFrame } from "@/components/layout/app-shell";
import { MobileDisclosure } from "@/components/mobile-disclosure";
import { ChevronDown } from "@/components/chevron-down";
import { useAccessProfile } from "@/lib/use-access-role";
import { canEditCompanySettings, roleNames } from "@/lib/role-access";
import { confirmAction } from "@/lib/confirm-action";
import { useUnsavedChanges } from "@/lib/use-unsaved-changes";
import type {
  CompanySettings,
  SettingsAccessEvent,
  SettingsMember,
  SettingsPageData,
} from "@/lib/settings-page-data";
import { apiFetch } from "@/lib/api-client";
import { validateCompanyFields } from "@/lib/company-validation";
import { BankAccountsSection } from "./bank-accounts-section";

type Company = CompanySettings;
type Role = "viewer" | "accounting" | "admin";
type Member = SettingsMember;

function memberStateLabel(member: Member, registrationEntry: boolean) {
  if (member.active) return "Aktivní";
  if (member.invitation === "pending") return "Pozván";
  if (member.invitation === "expired") return "Vypršelo";
  // U firmy s vlastní registrací (R. Hlavica) je čekající přístup normální stav.
  return registrationEntry ? "Připraven" : "Neodesláno";
}
type AccessEvent = SettingsAccessEvent;
const accessAction = (event: AccessEvent) =>
  event.event_type === "added"
    ? `přidal přístup · ${roleNames[event.new_role!]}`
    : event.event_type === "removed"
      ? `odebral přístup · ${roleNames[event.previous_role!]}`
      : `změnil roli · ${roleNames[event.previous_role!]} → ${roleNames[event.new_role!]}`;
const formatAuditDate = (value: string) =>
  new Intl.DateTimeFormat("cs-CZ", {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));

export function SettingsClient({
  initialData,
}: {
  initialData: SettingsPageData;
}) {
  const [company, setCompany] = useState<Company>(initialData.company);
  const [members, setMembers] = useState<Member[]>(initialData.members);
  const [accessEvents, setAccessEvents] = useState<AccessEvent[]>(
    initialData.access_events,
  );
  const [newEmail, setNewEmail] = useState("");
  const [newRole, setNewRole] = useState<Role>("accounting");
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);
  // Barva hlasky se drive odvozovala z toho, jestli text obsahoval slova jako
  // "ulozene" nebo "odebran". Uspesne odebrani clena konci na "byly smazany",
  // takze se zobrazovalo CERVENE jako chyba. Vysledek akce zna volajici --
  // nese se proto typem, ne hadanim z textu.
  const [message, setMessage] = useState<{ text: string; variant: "success" | "error" } | null>(null);
  // Chyba u konkretniho pole, ne jen jedna souhrnna hlaska nahore.
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const notifyOk = (text: string) => setMessage({ text, variant: "success" });
  const notifyError = (text: string) => setMessage({ text, variant: "error" });
  const profile = useAccessProfile();
  const currentRole = profile?.role ?? null;
  const canAdminister = canEditCompanySettings(currentRole);
  useUnsavedChanges(dirty && !saving);
  useEffect(() => {
    const raw = sessionStorage.getItem("splatno:company-settings-draft");
    if (!raw) return;
    try {
      const draft = JSON.parse(raw) as Company;
      if (
        draft.revision === initialData.company.revision &&
        window.confirm(
          "Byl nalezen neuložený koncept firemního nastavení. Chcete jej obnovit?",
        )
      ) {
        setCompany(draft);
        setDirty(true);
        notifyOk("Neuložený koncept byl obnoven.");
      } else sessionStorage.removeItem("splatno:company-settings-draft");
    } catch {
      sessionStorage.removeItem("splatno:company-settings-draft");
    }
  }, [initialData.company.revision]);
  useEffect(() => {
    if (dirty)
      sessionStorage.setItem(
        "splatno:company-settings-draft",
        JSON.stringify(company),
      );
  }, [company, dirty]);

  async function refreshMembers() {
    const data = await refreshSettings();
    if (!data) throw new Error("Přístupy se nepodařilo načíst.");
    setMembers(data.members ?? []);
    setAccessEvents(data.access_events ?? []);
  }

  const {
    data: refreshedData,
    error: loadError,
    mutate: refreshSettings,
  } = useSWR<SettingsPageData>("/api/settings/page-data", {
    fallbackData: initialData,
    revalidateOnMount: false,
  });
  useEffect(() => {
    if (loadError instanceof Error) notifyError(loadError.message);
  }, [loadError]);
  // Firma s vlastním vstupem (R. Hlavica): noví lidé se registrují tam,
  // e-mail s pozvánkou odchází jen na vyžádání.
  const registrationPath = (refreshedData ?? initialData).registration_path;
  useEffect(() => {
    if (!refreshedData || dirty) return;
    setCompany(refreshedData.company);
    setMembers(refreshedData.members);
    setAccessEvents(refreshedData.access_events);
    setLoading(false);
  }, [dirty, refreshedData]);

  const field = (key: keyof Company, value: string) => {
    setDirty(true);
    setCompany((current) => ({ ...current, [key]: value }));
  };
  async function save() {
    // Chyba se ukaze hned u ulozeni, ne az po kole na server. Server to
    // presto overuje znovu -- klientska validace je pohodli, ne ochrana.
    const problems = validateCompanyFields(company);
    if (problems.length) {
      setFieldErrors(Object.fromEntries(problems.map((problem) => [problem.field, problem.message])));
      notifyError(problems.map((problem) => problem.message).join(" "));
      return;
    }
    setFieldErrors({});
    setSaving(true);
    setMessage(null);
    try {
      const data = await apiFetch<{ company: Company }>(
        "/api/settings/company",
        {
          method: "PUT",
          headers: {
            "content-type": "application/json",
            "x-idempotency-key": `company-${company.revision}`,
          },
          body: JSON.stringify(company),
        },
      );
      setCompany(data.company);
      setDirty(false);
      sessionStorage.removeItem("splatno:company-settings-draft");
      notifyOk("Firemní údaje jsou uložené.");
    } catch (cause) {
      notifyError(
        cause instanceof Error ? cause.message : "Údaje se nepodařilo uložit.",
      );
    } finally {
      setSaving(false);
    }
  }
  async function addMember(event: React.FormEvent) {
    event.preventDefault();
    const email = newEmail.trim().toLowerCase();
    // R6: pozvánka je e-mail třetí straně, odchází jen po potvrzení.
    if (
      !registrationPath &&
      !(await confirmAction({
        title: `Poslat pozvánku na ${email}?`,
        description: `Odejde e-mail s odkazem do vaší firmy s rolí ${roleNames[newRole]}. Odkaz platí 7 dní a lze ho použít jen jednou.`,
        confirmLabel: "Poslat pozvánku",
        confirmVariant: "primary",
      }))
    )
      return;
    setSaving(true);
    setMessage(null);
    try {
      const result = await apiFetch<{ invitation?: { sent?: boolean; reason?: string; registrationPath?: string } }>("/api/settings/members", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-idempotency-key": `member-add-${newEmail.trim().toLowerCase()}`,
        },
        body: JSON.stringify({ email: newEmail, role: newRole }),
      });
      await refreshMembers();
      setNewEmail("");
      if (result?.invitation?.reason === "registration") {
        notifyOk(`Přístup je přidaný. Uživatel se zaregistruje na splatno.cz${result.invitation.registrationPath ?? ""}.`);
      } else if (result?.invitation?.sent) {
        notifyOk(`Pozvánka odešla na ${email}. Odkaz platí 7 dní.`);
      } else {
        notifyError(`Přístup je připravený, ale pozvánku se nepodařilo odeslat. Zkuste „Poslat znovu“.`);
      }
    } catch (cause) {
      notifyError(
        cause instanceof Error
          ? cause.message
          : "Přístup se nepodařilo přidat.",
      );
    } finally {
      setSaving(false);
    }
  }
  async function resendInvitation(member: Member) {
    if (
      !(await confirmAction({
        title: `Poslat pozvánku znovu na ${member.email}?`,
        description: "Odejde nový odkaz s platností 7 dní. Dřív poslaný odkaz tím přestane platit.",
        confirmLabel: "Poslat znovu",
        confirmVariant: "primary",
      }))
    )
      return;
    setSaving(true);
    setMessage(null);
    try {
      const result = await apiFetch<{ invitation?: { sent?: boolean } }>("/api/settings/members/invitation", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ id: member.id }),
      });
      await refreshMembers();
      if (result?.invitation?.sent) notifyOk(`Nová pozvánka odešla na ${member.email}.`);
      else notifyError("Pozvánku se nepodařilo odeslat. Zkuste to prosím za chvíli.");
    } catch (cause) {
      notifyError(cause instanceof Error ? cause.message : "Pozvánku se nepodařilo poslat.");
    } finally {
      setSaving(false);
    }
  }
  async function changeRole(member: Member, role: Role) {
    setSaving(true);
    setMessage(null);
    try {
      await apiFetch("/api/settings/members", {
        method: "PATCH",
        headers: {
          "content-type": "application/json",
          "x-idempotency-key": `member-role-${member.id}-${role}`,
        },
        body: JSON.stringify({ id: member.id, role }),
      });
      await refreshMembers();
      notifyOk("Role uživatele je změněná.");
    } catch (cause) {
      await refreshMembers().catch(() => undefined);
      notifyError(
        cause instanceof Error ? cause.message : "Roli se nepodařilo změnit.",
      );
    } finally {
      setSaving(false);
    }
  }
  async function removeMember(member: Member) {
    if (
      !(await confirmAction({
        title: `Odebrat přístup pro ${member.email}?`,
        description:
          "Přihlašovací účet bude smazán. Při opětovném přidání musí uživatel projít novou registrací a ověřit e-mail.",
        confirmLabel: "Odebrat přístup",
      }))
    )
      return;
    setSaving(true);
    setMessage(null);
    try {
      await apiFetch("/api/settings/members", {
        method: "DELETE",
        headers: {
          "content-type": "application/json",
          "x-idempotency-key": `member-remove-${member.id}`,
        },
        body: JSON.stringify({ id: member.id }),
      });
      await refreshMembers();
      notifyOk(
        "Přístup i přihlašovací účet byly smazány. Po opětovném přidání si uživatel vytvoří nový účet.",
      );
    } catch (cause) {
      await refreshMembers().catch(() => undefined);
      notifyError(
        cause instanceof Error
          ? cause.message
          : "Přístup se nepodařilo odebrat.",
      );
    } finally {
      setSaving(false);
    }
  }

  return (
    <AppFrame>
      <div className={styles.page}>
      <header className="section-header">
        <div>
          <p>SPRÁVA APLIKACE</p>
          <h1>Nastavení</h1>
          <span>
            {canAdminister
              ? "Firemní údaje a přístupy uživatelů."
              : "Firemní údaje pouze pro čtení."}
          </span>
        </div>
        {canAdminister && (
          <button
            type="submit"
            form="company-settings-form"
            className="btn primary"
            disabled={saving || loading}
          >
            {saving ? "Ukládám…" : "Uložit firemní údaje"}
          </button>
        )}
      </header>
      {message && (
        <p
          aria-live="polite"
          className={message.variant === "success" ? "success-message" : "form-error"}
        >
          {message.text}
        </p>
      )}
      <div className="settings-grid company-settings-grid">
        <section className="page-panel company-settings">
          <header>
            <div>
              <h2>Firemní údaje</h2>
              <p>Údaje použité v e-mailových šablonách a exportech.</p>
            </div>
          </header>
          {loading ? (
            <p className="page-state">Načítám…</p>
          ) : (
            /* Skutečný <form>, ne jen <div>: bez něj Enter v poli neudělal nic
               a účetní musela pokaždé trefit tlačítko myší. Tlačítko leží
               v hlavičce mimo tuhle sekci, takže je propojené atributem form. */
            <form
              id="company-settings-form"
              onSubmit={(event) => { event.preventDefault(); void save(); }}
            >
            <fieldset disabled={!canAdminister}>
              <div className={styles.formLayout}>
              <section className={`settings-form ${styles.identity}`} aria-labelledby="company-identity-title">
                <h3 id="company-identity-title" className="wide">Identifikace a adresy</h3>
                <label className="wide">
                  <span>Obchodní název</span>
                  <input
                    value={company.name}
                    aria-invalid={fieldErrors.name ? true : undefined}
                    onChange={(e) => field("name", e.target.value)}
                  />
                  {fieldErrors.name && <small className="field-error">{fieldErrors.name}</small>}
                </label>
                <label>
                  <span>IČO</span>
                  <input
                    value={company.ico}
                    aria-invalid={fieldErrors.ico ? true : undefined}
                    onChange={(e) => field("ico", e.target.value)}
                  />
                  {fieldErrors.ico && <small className="field-error">{fieldErrors.ico}</small>}
                </label>
                <label>
                  <span>DIČ</span>
                  <input
                    value={company.dic}
                    aria-invalid={fieldErrors.dic ? true : undefined}
                    onChange={(e) => field("dic", e.target.value)}
                  />
                  {fieldErrors.dic && <small className="field-error">{fieldErrors.dic}</small>}
                </label>
                <label className="wide">
                  <span>Sídlo a fakturační adresa</span>
                  <input
                    value={company.registered_address}
                    onChange={(e) =>
                      field("registered_address", e.target.value)
                    }
                  />
                </label>
                <label className="wide">
                  <span>Provozovna a doručovací adresa</span>
                  <input
                    value={company.operating_address}
                    onChange={(e) => field("operating_address", e.target.value)}
                  />
                </label>
              </section>
              <section className="settings-form" aria-labelledby="company-contact-title">
                <h3 id="company-contact-title" className="wide">Kontaktní údaje</h3>
                <label>
                  <span>Datová schránka</span>
                  <input
                    value={company.data_box_id}
                    onChange={(e) => field("data_box_id", e.target.value)}
                  />
                </label>
                <label>
                  <span>Telefon</span>
                  <input
                    value={company.phone}
                    onChange={(e) => field("phone", e.target.value)}
                  />
                </label>
                <label className="wide">
                  <span>Výchozí e-mail účetního oddělení</span>
                  <input
                    type="email"
                    value={company.email}
                    aria-invalid={fieldErrors.email ? true : undefined}
                    onChange={(e) => field("email", e.target.value)}
                  />
                  {fieldErrors.email && <small className="field-error">{fieldErrors.email}</small>}
                </label>
              </section>
              <section className="settings-form" aria-labelledby="company-payment-title">
                <h3 id="company-payment-title" className="wide">Platební údaje</h3>
                <label>
                  <span>Bankovní účet CZK</span>
                  <input
                    value={company.bank_account_czk}
                    aria-invalid={fieldErrors.bank_account_czk ? true : undefined}
                    onChange={(e) => field("bank_account_czk", e.target.value)}
                  />
                  {fieldErrors.bank_account_czk && <small className="field-error">{fieldErrors.bank_account_czk}</small>}
                </label>
                <label>
                  <span>Bankovní účet EUR</span>
                  <input
                    value={company.bank_account_eur}
                    aria-invalid={fieldErrors.bank_account_eur ? true : undefined}
                    onChange={(e) => field("bank_account_eur", e.target.value)}
                  />
                  {fieldErrors.bank_account_eur && <small className="field-error">{fieldErrors.bank_account_eur}</small>}
                </label>
              </section>
              </div>
            </fieldset>
            </form>
          )}
          <BankAccountsSection canEdit={canAdminister} onMessage={(text, variant) => (variant === "success" ? notifyOk(text) : notifyError(text))} />
        </section>
      </div>
      {canAdminister && (
        <>
          <div className="access-settings-grid">
            <section className="page-panel members-settings">
              <header>
                <div>
                  <h2>Přístupy účetního oddělení</h2>
                  <p>
                    {registrationPath
                      ? `Povolené e-maily a jejich oprávnění. Nový člověk si vytvoří účet na splatno.cz${registrationPath}.`
                      : "Lidé ve vaší firmě a jejich oprávnění. Nový člověk dostane pozvánku e-mailem a přes odkaz si nastaví heslo."}
                  </p>
                </div>
              </header>
              {loading ? (
                <p className="page-state">Načítám přístupy…</p>
              ) : (
                <>
                  <div className="members-list">
                    {members.map((member) => (
                      <article key={member.id}>
                        <span
                          className={`member-state ${member.active ? "active" : "invited"}`}
                        >
                          {memberStateLabel(member, Boolean(registrationPath))}
                        </span>
                        <div>
                          <strong>
                            {member.email}
                            {member.current ? " · váš účet" : ""}
                          </strong>
                          <small>
                            {roleNames[member.role]}
                            {member.invitation === "pending" && member.invitation_expires_at
                              ? ` · pozvánka platí do ${new Date(member.invitation_expires_at).toLocaleDateString("cs-CZ")}`
                              : ""}
                          </small>
                          {!member.active ? (
                            <button
                              type="button"
                              className="member-resend"
                              disabled={saving}
                              onClick={() => resendInvitation(member)}
                            >
                              {registrationPath && member.invitation === "not_sent"
                                ? "Poslat pozvánku e-mailem"
                                : member.invitation === "not_sent" ? "Poslat pozvánku" : "Poslat znovu"}
                            </button>
                          ) : null}
                        </div>
                        <select
                          disabled={saving}
                          value={member.role}
                          onChange={(event) =>
                            changeRole(member, event.target.value as Role)
                          }
                          aria-label={`Role uživatele ${member.email}`}
                        >
                          <option value="admin">Administrátor</option>
                          <option value="accounting">Účetní</option>
                          <option value="viewer">Čtenář</option>
                        </select>
                        <button
                          type="button"
                          disabled={saving || member.current}
                          onClick={() => removeMember(member)}
                        >
                          Odebrat
                        </button>
                      </article>
                    ))}
                  </div>
                  <form className="member-add" onSubmit={addMember}>
                    <label>
                      <span>E-mail nového uživatele</span>
                      <input
                        type="email"
                        required
                        value={newEmail}
                        onChange={(event) => setNewEmail(event.target.value)}
                        placeholder="kolega@firma.cz"
                      />
                    </label>
                    <label>
                      <span>Role</span>
                      <select
                        value={newRole}
                        onChange={(event) =>
                          setNewRole(event.target.value as Role)
                        }
                      >
                        <option value="accounting">Účetní</option>
                        <option value="viewer">Čtenář</option>
                        <option value="admin">Administrátor</option>
                      </select>
                    </label>
                    <button className="btn primary" disabled={saving}>
                      {registrationPath ? "+ Přidat přístup" : "+ Pozvat do firmy"}
                    </button>
                  </form>
                </>
              )}
            </section>
            <MobileDisclosure
              label="Význam uživatelských rolí"
              className="settings-roles-disclosure"
            >
              <aside className="settings-side">
                <section className="page-panel access-card">
                  <h2>Význam rolí</h2>
                  <p>
                    Role určují, kdo může pouze číst, pracovat s fakturami nebo
                    měnit nastavení.
                  </p>
                  <div className="role-list">
                    <span>
                      <strong>Administrátor</strong>
                      <small>Firma, uživatelé i veškerá agenda</small>
                    </span>
                    <span>
                      <strong>Účetní</strong>
                      <small>Faktury, platby, upomínky a reporty</small>
                    </span>
                    <span>
                      <strong>Čtenář</strong>
                      <small>Přehled, reporty a faktury pouze pro čtení</small>
                    </span>
                  </div>
                </section>
              </aside>
            </MobileDisclosure>
          </div>
          <details className="page-panel access-history-disclosure">
            <summary>
              <span>
                <strong>Historie změn přístupů</strong>
                <small>
                  Neměnná auditní stopa posledních administrátorských zásahů.
                </small>
              </span>
              <ChevronDown className="access-history-chevron" />
            </summary>
            <section className="access-history">
              <div className="access-history-list">
                {accessEvents.map((event) => (
                  <article key={event.id}>
                    <i className={event.event_type} />
                    <div>
                      <strong>{event.target_email}</strong>
                      <span>{accessAction(event)}</span>
                    </div>
                    <small>
                      {formatAuditDate(event.created_at)}
                      <br />
                      {event.actor_email}
                    </small>
                  </article>
                ))}
                {!accessEvents.length && (
                  <p className="page-state">
                    Zatím nebyla zaznamenána žádná změna přístupů.
                  </p>
                )}
              </div>
            </section>
          </details>
        </>
      )}
      </div>
    </AppFrame>
  );
}
