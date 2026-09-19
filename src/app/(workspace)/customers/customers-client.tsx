"use client";

import { useMemo, useState } from "react";
import useSWR from "swr";
import { AppFrame } from "@/components/layout/app-shell";
import { Icon } from "@/components/icons";
import { apiFetch } from "@/lib/api-client";
import type { CustomerSummary, CustomersPageData } from "@/lib/customers-page-data";

const money = (value: number, currency = "CZK") =>
  new Intl.NumberFormat("cs-CZ", { style: "currency", currency, maximumFractionDigits: 0 }).format(value);
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
  const { data, mutate } = useSWR<CustomersPageData>("/api/customers", fetchCustomers, {
    fallbackData: initialData,
    revalidateOnFocus: false,
  });
  const customers = data?.customers ?? initialData.customers;
  const canManage = data?.can_manage ?? initialData.can_manage;
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<{ key: SortKey; dir: "asc" | "desc" }>({ key: "outstanding", dir: "desc" });
  const [editingPhoneId, setEditingPhoneId] = useState<string | null>(null);
  const [phoneDraft, setPhoneDraft] = useState("");
  const [savingPhone, setSavingPhone] = useState(false);
  const [phoneError, setPhoneError] = useState<string | null>(null);
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

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    const base = needle
      ? customers.filter((customer) =>
          customer.name.toLowerCase().includes(needle)
          || (customer.ico ?? "").includes(needle)
          || (customer.email ?? "").toLowerCase().includes(needle)
          || (customer.phone ?? "").toLowerCase().includes(needle))
      : customers;
    const factor = sort.dir === "asc" ? 1 : -1;
    return [...base].sort((a, b) => {
      const left = a[sort.key];
      const right = b[sort.key];
      if (typeof left === "number" && typeof right === "number") return factor * (left - right);
      return factor * String(left ?? "").localeCompare(String(right ?? ""), "cs");
    });
  }, [customers, query, sort]);
  function startEditingPhone(customer: CustomerSummary) {
    setEditingPhoneId(customer.id);
    setPhoneDraft(customer.phone ?? "");
    setPhoneError(null);
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
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Název, IČO, e-mail nebo telefon"
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
                  <tr key={customer.id}>
                    <td data-label="Zákazník" className="customer-identity-cell">
                      <div className="customer-identity">
                        <span className="customer-avatar" aria-hidden="true">{customer.name.trim().charAt(0).toUpperCase() || "?"}</span>
                        <span>
                          <strong>{customer.name}</strong>
                          <small>{customer.ico ? `IČO ${customer.ico}` : "IČO neuvedeno"}{customer.dic ? ` · DIČ ${customer.dic}` : ""}</small>
                        </span>
                      </div>
                    </td>
                    <td data-label="Kontakt" className="customer-contact-cell">
                      {customer.email && <small>{customer.email}</small>}
                      {editingPhoneId === customer.id ? (
                        <span className="customer-phone-edit">
                          <input
                            autoFocus
                            value={phoneDraft}
                            onChange={(e) => setPhoneDraft(e.target.value)}
                            onKeyDown={(e) => { if (e.key === "Enter") savePhone(customer.id); if (e.key === "Escape") setEditingPhoneId(null); }}
                            placeholder="Telefon"
                            disabled={savingPhone}
                          />
                          <button type="button" onClick={() => savePhone(customer.id)} disabled={savingPhone} aria-label="Uložit telefon"><Icon name="check" /></button>
                        </span>
                      ) : (
                        <button type="button" className="customer-phone-display" onClick={() => canManage && startEditingPhone(customer)} disabled={!canManage}>
                          {customer.phone || (canManage ? "+ Přidat telefon" : "Telefon neuveden")}
                        </button>
                      )}
                      {phoneError && editingPhoneId === customer.id && <small className="red-text">{phoneError}</small>}
                    </td>
                    <td data-label="Fakturace" className="customer-billing-cell">
                      <strong>{money(customer.total_invoiced)}</strong>
                      <small>{customer.invoice_count} {customer.invoice_count === 1 ? "faktura" : customer.invoice_count > 1 && customer.invoice_count < 5 ? "faktury" : "faktur"}</small>
                    </td>
                    <td data-label="Neuhrazeno">
                      {customer.outstanding > 0 ? (
                        <span className={`outstanding-badge ${customer.overdue_amount > 0 ? "overdue" : ""}`}>
                          {money(customer.outstanding)}
                        </span>
                      ) : (
                        <span className="customer-paid-state"><Icon name="check" /> Uhrazeno</span>
                      )}
                    </td>
                    <td data-label="Upomínky">
                      {customer.reminder_policy_name
                        ? <span className="reminder-policy-badge">{customer.reminder_policy_name}</span>
                        : <span className="muted-text">Nepřiřazeno</span>}
                    </td>
                    <td data-label="Poslední faktura">{date(customer.last_invoice_date)}</td>
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
