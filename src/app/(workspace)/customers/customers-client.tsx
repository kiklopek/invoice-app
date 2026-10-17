"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import useSWR from "swr";
import { useRevalidateOnRevisit } from "@/lib/revalidate-on-revisit";
import { AppFrame } from "@/components/layout/app-shell";
import { Icon } from "@/components/icons";
import { apiFetch } from "@/lib/api-client";
import type { CustomerSummary, CustomersPageData } from "@/lib/customers-page-data";
import { createTextMatcher, searchFields } from "@/lib/text-search";

const moneyFormatter = new Intl.NumberFormat("cs-CZ", { style: "currency", currency: "CZK", maximumFractionDigits: 0 });
function CustomerAmount({ value }: { value: number }) {
  const parts = moneyFormatter.formatToParts(value);
  const number = parts.filter((part) => part.type !== "currency").map((part) => part.value).join("").trim();
  const currency = parts.find((part) => part.type === "currency")?.value;
  return <span className="customer-amount"><span className="customer-amount-number">{number}</span>{" "}<span>{currency}</span></span>;
}
const date = (value: string | null) =>
  value ? new Intl.DateTimeFormat("cs-CZ").format(new Date(`${value}T12:00:00`)) : "—";

async function fetchCustomers(): Promise<CustomersPageData> {
  return apiFetch<CustomersPageData>("/api/customers");
}

type SortKey = "name" | "total_invoiced" | "outstanding" | "reminder_policy_name" | "last_invoice_date";
const SORT_LABELS: Record<SortKey, string> = {
  name: "Název",
  total_invoiced: "Fakturace",
  outstanding: "Neuhrazeno",
  reminder_policy_name: "Upomínky",
  last_invoice_date: "Poslední faktura",
};

export function CustomersClient({ initialData }: { initialData: CustomersPageData }) {
  // Znovu načíst jen při návratu na stránku (v cache jsou starší data);
  // při první návštěvě stačí data ze serveru. Dřív se načítalo vždy znovu
  // (výchozí revalidateIfStale) -- celý seznam zákazníků s fakturami dvakrát.
  const revalidateOnRevisit = useRevalidateOnRevisit("/api/customers");
  const { data, mutate } = useSWR<CustomersPageData>("/api/customers", fetchCustomers, {
    fallbackData: initialData,
    revalidateOnFocus: false,
    revalidateOnMount: revalidateOnRevisit,
  });
  const customers = data?.customers ?? initialData.customers;
  const canManage = data?.can_manage ?? initialData.can_manage;
  // Arriving here from an invoice's "Karta zákazníka" link (?highlight=<id>)
  // -- scroll the matching row into view and mark it, since with sorting and
  // no default filter the row could be anywhere in a long list. Read via
  // window.location rather than useSearchParams, which would force a
  // Suspense boundary this page (a plain server component) does not have.
  const [highlightId, setHighlightId] = useState<string | null>(null);
  useEffect(() => {
    setHighlightId(new URLSearchParams(window.location.search).get("highlight"));
  }, []);
  const highlightRef = useRef<HTMLTableRowElement>(null);
  useEffect(() => {
    if (highlightId) highlightRef.current?.scrollIntoView({ block: "center", behavior: "smooth" });
  }, [highlightId]);
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<{ key: SortKey; dir: "asc" | "desc" }>({ key: "outstanding", dir: "desc" });
  const [editingPhoneId, setEditingPhoneId] = useState<string | null>(null);
  const [phoneDraft, setPhoneDraft] = useState("");
  const [savingPhone, setSavingPhone] = useState(false);
  const [phoneError, setPhoneError] = useState<string | null>(null);
  const [editingEmailId, setEditingEmailId] = useState<string | null>(null);
  const [emailDraft, setEmailDraft] = useState("");
  const [savingEmail, setSavingEmail] = useState(false);
  const [emailError, setEmailError] = useState<string | null>(null);
  const [emailNotice, setEmailNotice] = useState<{ id: string; text: string } | null>(null);
  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState("");

  async function exportExcel() {
    setExporting(true);
    setExportError("");
    try {
      const response = await fetch("/api/customers?format=xlsx");
      if (!response.ok) {
        const body = await response.json().catch(() => null);
        throw new Error(body?.error || "Export se nepodařilo připravit.");
      }
      const url = URL.createObjectURL(await response.blob());
      const link = document.createElement("a");
      link.href = url;
      link.download = "zakaznici.xlsx";
      link.click();
      URL.revokeObjectURL(url);
    } catch (cause) {
      setExportError(cause instanceof Error ? cause.message : "Export se nepodařilo připravit.");
    } finally {
      setExporting(false);
    }
  }

  function toggleSort(key: SortKey) {
    setSort((current) => (current.key === key
      ? { key, dir: current.dir === "asc" ? "desc" : "asc" }
      : { key, dir: key === "name" ? "asc" : "desc" }));
  }

  const customerSearchIndex = useMemo(() => customers.map((customer) => ({
    customer,
    fields: searchFields([customer.name, customer.ico, customer.dic, customer.email, customer.phone, customer.address, customer.notes, customer.reminder_policy_name]),
  })), [customers]);
  const filtered = useMemo(() => {
    const matches = createTextMatcher(query);
    const base = customerSearchIndex.filter(({ fields }) => matches(fields)).map(({ customer }) => customer);
    const factor = sort.dir === "asc" ? 1 : -1;
    return [...base].sort((a, b) => {
      const left = a[sort.key];
      const right = b[sort.key];
      if (typeof left === "number" && typeof right === "number") return factor * (left - right);
      return factor * String(left ?? "").localeCompare(String(right ?? ""), "cs");
    });
  }, [customerSearchIndex, query, sort]);
  function startEditingPhone(customer: CustomerSummary) {
    setEditingEmailId(null);
    setEditingPhoneId(customer.id);
    setPhoneDraft(customer.phone ?? "");
    setPhoneError(null);
  }

  function startEditingEmail(customer: CustomerSummary) {
    setEditingPhoneId(null);
    setEditingEmailId(customer.id);
    setEmailDraft(customer.email ?? "");
    setEmailError(null);
    setEmailNotice(null);
  }

  async function saveEmail(id: string) {
    if (savingEmail) return;
    setSavingEmail(true);
    setEmailError(null);
    try {
      const result = await apiFetch<{ updated_invoice_count: number }>(`/api/customers/${id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email: emailDraft.trim() }),
      });
      await mutate();
      setEditingEmailId(null);
      setEmailNotice({ id, text: `E-mail uložen. Aktualizované neuhrazené faktury: ${result.updated_invoice_count}.` });
    } catch (cause) {
      setEmailError(cause instanceof Error ? cause.message : "E-mail se nepodařilo uložit.");
    } finally {
      setSavingEmail(false);
    }
  }

  async function savePhone(id: string) {
    setSavingPhone(true);
    setPhoneError(null);
    try {
      await apiFetch(`/api/customers/${id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ phone: phoneDraft.trim() || null }),
      });
      await mutate();
      setEditingPhoneId(null);
    } catch {
      setPhoneError("Telefon se nepodařilo uložit.");
    } finally {
      setSavingPhone(false);
    }
  }

  return (
    <AppFrame className="content section-page customers-page">
      <header className="section-header customers-hero">
        <div className="customers-hero-copy">
          <p>REGISTR ZÁKAZNÍKŮ</p>
          <h1>Zákazníci</h1>
          <span>Kontakty, fakturace a stav pohledávek na jednom místě.</span>
        </div>
        <div className="section-actions">
          <button type="button" className="btn secondary" onClick={exportExcel} disabled={exporting}>
            <Icon name="download" /> {exporting ? "Exportuji…" : "Export do Excelu"}
          </button>
        </div>
      </header>

      {exportError && <p className="form-error">{exportError}</p>}

      <section className="page-panel customers-toolbar" aria-label="Vyhledávání zákazníků">
        <label>
          <span>Vyhledat zákazníka</span>
          <span className="customers-search-field">
            <input
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Název, IČO, DIČ, kontakt, adresa nebo poznámka"
              enterKeyHint="search"
            />
            {query && (
              <button type="button" onClick={() => setQuery("")} aria-label="Vymazat hledání">
                ×
              </button>
            )}
          </span>
        </label>
        <div className="customers-toolbar-meta">
          <strong>{filtered.length}</strong>
          <span>{filtered.length === 1 ? "nalezený zákazník" : filtered.length > 1 && filtered.length < 5 ? "nalezení zákazníci" : "nalezených zákazníků"}</span>
        </div>
      </section>

      <section className="page-panel data-panel customers-table">
        <header className="panel-head customers-table-head">
          <div>
            <small>ADRESÁŘ ODBĚRATELŮ</small>
            <h2>Přehled zákazníků</h2>
            <p>Řazení změníte kliknutím na název sloupce.</p>
          </div>
        </header>
        {filtered.length ? (
          <div className="large-table customers-list-table">
            <table>
              <thead>
                <tr>
                  <th>
                    <button type="button" className={`sort-header ${sort.key === "name" ? `active ${sort.dir}` : ""}`} onClick={() => toggleSort("name")}>
                      {SORT_LABELS.name}
                    </button>
                  </th>
                  <th>Kontakt</th>
                  {(["total_invoiced", "outstanding", "reminder_policy_name", "last_invoice_date"] as SortKey[]).map((key) => (
                    <th key={key}>
                      <button type="button" className={`sort-header ${sort.key === key ? `active ${sort.dir}` : ""}`} onClick={() => toggleSort(key)}>
                        {SORT_LABELS[key]}
                      </button>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {filtered.map((customer: CustomerSummary) => (
                  <tr
                    key={customer.id}
                    ref={customer.id === highlightId ? highlightRef : null}
                    className={customer.id === highlightId ? "customer-row-highlight" : ""}
                  >
                    <td data-label="Zákazník" className="customer-identity-cell">
                      <div className="customer-identity">
                        <span className="customer-avatar" aria-hidden="true">{customer.name.trim().charAt(0).toUpperCase() || "?"}</span>
                        <span>
                          <strong>{customer.name}</strong>
                          <small className="customer-tax-ids">
                            <span><span className="customer-tax-label">IČO</span> {customer.ico || "neuvedeno"}</span>
                            {customer.dic ? <span><span className="customer-tax-label">DIČ</span> {customer.dic}</span> : null}
                          </small>
                          {customer.address && <small className="customer-address">{customer.address}</small>}
                        </span>
                      </div>
                    </td>
                    <td data-label="Kontakt" className="customer-contact-cell">
                      <div className="customer-contact-details">
                        {editingEmailId === customer.id ? (
                          <form className="customer-email-form" onSubmit={(event) => { event.preventDefault(); void saveEmail(customer.id); }}>
                            <span className="customer-email-edit">
                              <input
                                autoFocus
                                type="email"
                                required
                                maxLength={254}
                                autoComplete="email"
                                aria-label={`E-mail zákazníka ${customer.name}`}
                                value={emailDraft}
                                onChange={(event) => setEmailDraft(event.target.value)}
                                onKeyDown={(event) => { if (event.key === "Escape" && !savingEmail) setEditingEmailId(null); }}
                                placeholder="E-mail"
                                disabled={savingEmail}
                              />
                              <button type="submit" disabled={savingEmail} aria-label="Uložit e-mail"><Icon name="check" /></button>
                              <button type="button" onClick={() => setEditingEmailId(null)} disabled={savingEmail} aria-label="Zrušit úpravu e-mailu">×</button>
                            </span>
                            <small>Změní se i příjemce upomínek u neuhrazených faktur.</small>
                            {emailError && <small className="red-text" role="alert">{emailError}</small>}
                          </form>
                        ) : customer.email ? (
                          <div className="customer-contact-line">
                            <span className="customer-contact-value">{customer.email}</span>
                            {canManage ? <button type="button" className="customer-contact-edit" onClick={() => startEditingEmail(customer)} disabled={savingEmail || savingPhone} aria-label={`Upravit e-mail zákazníka ${customer.name}`}><Icon name="edit" /></button> : null}
                          </div>
                        ) : (
                          <button type="button" className="customer-email-display" onClick={() => startEditingEmail(customer)} disabled={!canManage || savingEmail || savingPhone} aria-label={`Upravit e-mail zákazníka ${customer.name}`}>
                            <span className="customer-contact-value">{customer.email || (canManage ? "+ Přidat e-mail" : "E-mail neuveden")}</span>
                            {canManage && <Icon name="edit" />}
                          </button>
                        )}
                        {emailNotice?.id === customer.id && <small role="status">{emailNotice.text}</small>}
                        {editingPhoneId === customer.id ? (
                          <span className="customer-phone-edit">
                            <input
                              autoFocus
                              type="tel"
                              inputMode="tel"
                              autoComplete="tel"
                              value={phoneDraft}
                              onChange={(e) => setPhoneDraft(e.target.value)}
                              onKeyDown={(e) => { if (e.key === "Enter") savePhone(customer.id); if (e.key === "Escape") setEditingPhoneId(null); }}
                              placeholder="Telefon"
                              disabled={savingPhone}
                            />
                            <button type="button" onClick={() => savePhone(customer.id)} disabled={savingPhone} aria-label="Uložit telefon"><Icon name="check" /></button>
                          </span>
                        ) : customer.phone ? (
                          <div className="customer-contact-line">
                            <span className="customer-contact-value">{customer.phone}</span>
                            {canManage ? <button type="button" className="customer-contact-edit" onClick={() => startEditingPhone(customer)} disabled={savingEmail || savingPhone} aria-label={`Upravit telefon zákazníka ${customer.name}`}><Icon name="edit" /></button> : null}
                          </div>
                        ) : (
                          <button type="button" className={`customer-phone-display${!customer.phone ? " is-empty" : ""}`} onClick={() => canManage && startEditingPhone(customer)} disabled={!canManage || savingEmail || savingPhone}>
                            {customer.phone || (canManage ? "+ Přidat telefon" : "Telefon neuveden")}
                          </button>
                        )}
                        {phoneError && editingPhoneId === customer.id && <small className="red-text">{phoneError}</small>}
                      </div>
                    </td>
                    <td data-label="Fakturace" className="customer-billing-cell">
                      <Link href={`/invoices?q=${encodeURIComponent(customer.name)}`} className="customer-invoices-link" aria-label={`Zobrazit faktury zákazníka ${customer.name}`}>
                        <strong><CustomerAmount value={customer.total_invoiced} /></strong>
                        <small>{customer.invoice_count} {customer.invoice_count === 1 ? "faktura" : customer.invoice_count > 1 && customer.invoice_count < 5 ? "faktury" : "faktur"} →</small>
                      </Link>
                    </td>
                    <td data-label="Neuhrazeno" className="customer-outstanding-cell">
                      {customer.outstanding > 0 ? (
                        <span className={`outstanding-badge ${customer.overdue_amount > 0 ? "overdue" : ""}`}>
                          <CustomerAmount value={customer.outstanding} />
                        </span>
                      ) : (
                        <span className="customer-paid-state"><Icon name="check" /> Uhrazeno</span>
                      )}
                    </td>
                    <td data-label="Upomínky" className="customer-reminders-cell">
                      {customer.reminder_policy_name
                        ? <span className="reminder-policy-badge">{customer.reminder_policy_name}</span>
                        : <span className="muted-text">Nepřiřazeno</span>}
                    </td>
                    <td data-label="Poslední faktura" className="customer-last-invoice-cell">{date(customer.last_invoice_date)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="payments-empty-state customers-empty-state">
            <span><Icon name={query ? "users" : "document"} /></span>
            <strong>{query ? "Žádný odpovídající zákazník" : "Zatím žádní zákazníci"}</strong>
            <p>{query ? "Zkuste upravit hledaný výraz nebo vyhledávání vymažte." : "Zákazníci se doplní automaticky při uložení faktury s platným IČO odběratele."}</p>
            {query && <button type="button" className="btn secondary" onClick={() => setQuery("")}>Vymazat hledání</button>}
          </div>
        )}
      </section>
    </AppFrame>
  );
}
