"use client";

import { useEffect, useState } from "react";
import type { InputHTMLAttributes } from "react";
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
import { Icon } from "@/components/icons";
import { companySettingsDraftKey } from "@/lib/company-settings-draft";

type Company = CompanySettings;
type Role = "viewer" | "accounting" | "admin";
type Member = SettingsMember;

function CompanyField({
  label,
  field,
  error,
  wide = false,
  ...inputProps
}: InputHTMLAttributes<HTMLInputElement> & {
  label: string;
  field: keyof Company;
  error?: string;
  wide?: boolean;
}) {
  const id = `company-${field}`;
  return (
    <label
      className={`${styles.field}${wide ? ` ${styles.wide}` : ""}`}
      htmlFor={id}
    >
      <span>
        {label}
        {inputProps.required && (
          <span className={styles.required} aria-hidden="true">
            {" "}
            *
          </span>
        )}
      </span>
      <input
        {...inputProps}
        id={id}
        name={field}
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? `${id}-error` : undefined}
      />
      {error && (
        <small id={`${id}-error`} className="field-error">
          {error}
        </small>
      )}
    </label>
  );
}

function memberStateLabel(member: Member, registrationEntry: boolean) {
  if (member.support_until) return "Podpora Splatna";
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
  const draftKey = companySettingsDraftKey(initialData.draft_scope);
  useUnsavedChanges(dirty && !saving);
  useEffect(() => {
    if (!draftKey) return;
    const raw = sessionStorage.getItem(draftKey);
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
      } else sessionStorage.removeItem(draftKey);
    } catch {
      sessionStorage.removeItem(draftKey);
    }
  }, [draftKey, initialData.company.revision]);
  useEffect(() => {
    if (dirty && draftKey)
      sessionStorage.setItem(
        draftKey,
        JSON.stringify(company),
      );
  }, [company, dirty, draftKey]);

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
      await refreshSettings(
        (current) => ({ ...(current ?? initialData), company: data.company }),
        { revalidate: false },
      );
      setCompany(data.company);
      setDirty(false);
      if (draftKey) sessionStorage.removeItem(draftKey);
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
      !(await confirmAction(member.support_until
        ? {
            title: "Ukončit přístup podpory Splatna?",
            description: `Podpora (${member.email}) okamžitě ztratí přístup do vaší firmy.`,
            confirmLabel: "Ukončit přístup",
          }
        : {
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
            className={
              message.variant === "success" ? "success-message" : "form-error"
            }
          >
            {message.text}
          </p>
        )}
        <section
          className={`page-panel company-settings ${styles.companyPanel}`}
          aria-labelledby="company-settings-title"
        >
          <header className={styles.companyHeader}>
            <span className={styles.headerIcon}>
              <Icon name="bank" />
            </span>
            <div>
              <h2 id="company-settings-title">Firemní údaje</h2>
              <p>Vaše údaje pro faktury, e-maily a exporty.</p>
            </div>
            <span className={styles.headerNote}>
              {canAdminister ? "* Povinné údaje" : "Pouze pro čtení"}
            </span>
          </header>
          {loading ? (
            <p className="page-state">Načítám…</p>
          ) : (
            <form
              id="company-settings-form"
              noValidate
              onSubmit={(event) => {
                event.preventDefault();
                if (canAdminister && !saving) void save();
              }}
            >
              <fieldset
                disabled={!canAdminister || saving}
                className={styles.companyFields}
              >
                <section
                  className={styles.formSection}
                  aria-labelledby="company-identity-title"
                >
                  <div className={styles.sectionIntro}>
                    <h3 id="company-identity-title">Údaje firmy</h3>
                    <p>Identifikace a fakturační adresa.</p>
                  </div>
                  <div className={styles.fieldsGrid}>
                    <CompanyField
                      label="Obchodní název"
                      field="name"
                      wide
                      required
                      autoComplete="organization"
                      value={company.name}
                      error={fieldErrors.name}
                      onChange={(e) => field("name", e.target.value)}
                    />
                    <CompanyField
                      label="IČO"
                      field="ico"
                      required
                      inputMode="numeric"
                      value={company.ico}
                      error={fieldErrors.ico}
                      onChange={(e) => field("ico", e.target.value)}
                    />
                    <CompanyField
                      label="DIČ"
                      field="dic"
                      value={company.dic}
                      error={fieldErrors.dic}
                      onChange={(e) => field("dic", e.target.value)}
                    />
                    <CompanyField
                      label="Sídlo a fakturační adresa"
                      field="registered_address"
                      wide
                      autoComplete="street-address"
                      value={company.registered_address}
                      onChange={(e) =>
                        field("registered_address", e.target.value)
                      }
                    />
                  </div>
                </section>
                <section
                  className={styles.formSection}
                  aria-labelledby="company-contact-title"
                >
                  <div className={styles.sectionIntro}>
                    <h3 id="company-contact-title">Kontaktní údaje</h3>
                    <p>Kontakt na účetní oddělení.</p>
                  </div>
                  <div className={styles.fieldsGrid}>
                    <CompanyField
                      label="Kontaktní e-mail"
                      field="email"
                      type="email"
                      required
                      autoComplete="email"
                      value={company.email}
                      error={fieldErrors.email}
                      onChange={(e) => field("email", e.target.value)}
                    />
                    <CompanyField
                      label="Telefon"
                      field="phone"
                      type="tel"
                      autoComplete="tel"
                      value={company.phone}
                      onChange={(e) => field("phone", e.target.value)}
                    />
                  </div>
                </section>
                <section
                  className={styles.formSection}
                  aria-labelledby="company-payment-title"
                >
                  <div className={styles.sectionIntro}>
                    <h3 id="company-payment-title">Platební údaje</h3>
                    <p>Hlavní účty a nastavení DPH.</p>
                  </div>
                  <div className={styles.fieldsGrid}>
                    <CompanyField
                      label="Bankovní účet CZK"
                      field="bank_account_czk"
                      value={company.bank_account_czk}
                      error={fieldErrors.bank_account_czk}
                      onChange={(e) =>
                        field("bank_account_czk", e.target.value)
                      }
                    />
                    <CompanyField
                      label="Bankovní účet EUR"
                      field="bank_account_eur"
                      value={company.bank_account_eur}
                      error={fieldErrors.bank_account_eur}
                      onChange={(e) =>
                        field("bank_account_eur", e.target.value)
                      }
                    />
                    <label className={styles.vatOption}>
                      <input
                        type="checkbox"
                        name="vat_payer"
                        checked={company.vat_payer !== false}
                        aria-describedby="company-vat-hint"
                        onChange={(e) => {
                          setDirty(true);
                          setCompany((current) => ({
                            ...current,
                            vat_payer: e.target.checked,
                          }));
                        }}
                      />
                      <span>
                        <strong>Firma je plátcem DPH</strong>
                        <small id="company-vat-hint">
                          {company.vat_payer !== false
                            ? "Nové faktury budou vystaveny s DPH."
                            : "Nové faktury budou bez DPH s označením „Nejsem plátce DPH“."}
                        </small>
                      </span>
                    </label>
                  </div>
                </section>
                <details className={styles.additionalDetails}>
                  <summary>
                    <span>
                      Doplňující údaje{" "}
                      <small>Provozovna a datová schránka</small>
                    </span>
                    <ChevronDown />
                  </summary>
                  <div className={styles.additionalFields}>
                    <CompanyField
                      label="Provozovna a doručovací adresa"
                      field="operating_address"
                      value={company.operating_address}
                      onChange={(e) =>
                        field("operating_address", e.target.value)
                      }
                    />
                    <CompanyField
                      label="Datová schránka"
                      field="data_box_id"
                      value={company.data_box_id}
                      onChange={(e) => field("data_box_id", e.target.value)}
                    />
                  </div>
                </details>
              </fieldset>
            </form>
          )}
          <BankAccountsSection
            initialAccounts={(refreshedData ?? initialData).bank_accounts}
            canEdit={canAdminister}
            onMessage={(text, variant) =>
              variant === "success" ? notifyOk(text) : notifyError(text)
            }
          />
          {canAdminister && !loading && (
            <footer className={styles.companyFooter}>
              <p role="status">
                {saving
                  ? "Ukládám firemní údaje…"
                  : dirty
                    ? "Máte neuložené změny."
                    : "Všechny změny jsou uložené."}
              </p>
              <button
                type="submit"
                form="company-settings-form"
                className="btn primary"
                disabled={saving}
              >
                {saving ? "Ukládám…" : "Uložit firemní údaje"}
              </button>
            </footer>
          )}
        </section>
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
                            {member.support_until
                              ? `Dočasný přístup podpory do ${formatAuditDate(member.support_until)}`
                              : roleNames[member.role]}
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
                          disabled={saving || Boolean(member.support_until)}
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
                {initialData.support_sessions.map((session) => (
                  <article key={session.id}>
                    <i className="added" />
                    <div>
                      <strong>Podpora Splatna · {session.operator_email}</strong>
                      <span>{session.reason}</span>
                    </div>
                    <small>
                      {formatAuditDate(session.started_at)}
                      <br />
                      {session.ended_at ? `ukončeno ${formatAuditDate(session.ended_at)}` : `do ${formatAuditDate(session.expires_at)}`}
                    </small>
                  </article>
                ))}
              </div>
            </section>
          </details>
        </>
      )}
      </div>
    </AppFrame>
  );
}
