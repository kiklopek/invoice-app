"use client";

import {
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type ReactNode,
  type FormEvent,
} from "react";
import useSWR from "swr";
import Link from "next/link";
import dynamic from "next/dynamic";
import { apiFetch } from "@/lib/api-client";
import { Icon } from "@/components/icons";
import { ChevronDown } from "@/components/chevron-down";
import { Modal } from "@/components/modal";
import { organizationAccounts } from "@/lib/bank-accounts";
import { exactMoney } from "@/lib/money-display";
import { todayInTimeZone } from "@/lib/reminders";
import { INVOICE_CURRENCIES } from "@/lib/invoice-currency";
import {
  readInvoiceDraft,
  saveInvoiceDraft,
  clearInvoiceDraft,
} from "@/lib/invoice-drafts";
import { useInvalidateWorkspaceData } from "@/lib/workspace-cache";
import { useUnsavedChanges } from "@/lib/use-unsaved-changes";
import {
  validateDocumentMetadata,
  hasExpectedDocumentSignature,
} from "@/lib/document-validation";
import {
  creationDocument,
  creationPreview,
  emptyCreation,
  parseCreationDraft,
  supplierProblems,
  issuedDocument,
  type CreationDraft,
  type InvoiceParty,
  type InvoiceSupplier,
} from "@/lib/invoice-creation";
import type { Invoice, InvoiceInput } from "@/types/invoice";
import { InvoiceDocument } from "./invoice-document";
import styles from "./invoice-creation.module.css";

const InvoicePdfPreview = dynamic(
  () =>
    import("@/components/document-preview").then(
      (module) => module.DocumentPreview,
    ),
  { ssr: false, loading: () => <p role="status">Načítám stránky faktury…</p> },
);

type Customer = {
  id: string;
  name: string;
  ico: string | null;
  dic: string | null;
  address?: string | null;
  email: string | null;
};
export type CreationContext = {
  supplier: InvoiceSupplier;
  customers: Customer[];
  today: string;
  suggested_number: string;
  draft_scope: string;
  can_send: boolean;
};
const party = (customer: Customer): InvoiceParty => ({
  name: customer.name,
  ico: customer.ico ?? "",
  dic: customer.dic ?? "",
  address: customer.address ?? "",
  email: customer.email ?? "",
});
const json = (body: unknown) => ({
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify(body),
});
function Field({
  label,
  children,
  wide = false,
}: {
  label: string;
  children: ReactNode;
  wide?: boolean;
}) {
  return (
    <label className={wide ? styles.wideField : styles.field}>
      <span>{label}</span>
      {children}
    </label>
  );
}
const UNIT_OPTIONS = [
  ["ks", "ks · kus"],
  ["hod", "hod · hodina"],
  ["den", "den"],
  ["měsíc", "měsíc"],
  ["rok", "rok"],
  ["m", "m · metr"],
  ["m²", "m² · metr čtvereční"],
  ["m³", "m³ · metr krychlový"],
  ["kg", "kg · kilogram"],
  ["g", "g · gram"],
  ["l", "l · litr"],
  ["km", "km · kilometr"],
  ["bal", "bal · balení"],
  ["sada", "sada"],
] as const;
const VAT_OPTIONS = [
  ["21", "21 %"],
  ["12", "12 %"],
  ["0", "0 %"],
] as const;

function ItemChoice({
  label,
  name,
  value,
  options,
  onChange,
  decimal = false,
}: {
  label: string;
  name: string;
  value: string;
  options: readonly (readonly [string, string])[];
  onChange: (value: string) => void;
  decimal?: boolean;
}) {
  const id = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const [custom, setCustom] = useState(!options.some(([key]) => key === value));
  const [text, setText] = useState(value);
  const optionElements = (
    <>
      {options.map(([key, title]) => (
        <option key={key} value={key}>
          {title}
        </option>
      ))}
      <option value="custom">
        {decimal ? "Vlastní sazba…" : "Vlastní jednotka…"}
      </option>
    </>
  );
  function choose(next: string) {
    const isCustom = next === "custom";
    setCustom(isCustom);
    if (isCustom) {
      setText(value);
      requestAnimationFrame(() => {
        inputRef.current?.focus();
        inputRef.current?.select();
      });
    } else {
      setText(next);
      onChange(next);
    }
  }
  return (
    <div className={styles.itemChoice}>
      <label htmlFor={id} className={styles.choiceLabel}>
        {label}
      </label>
      <div className={styles.choiceControl}>
        {custom ? (
          <>
            <input
              id={id}
              ref={inputRef}
              aria-label={name}
              required
              maxLength={decimal ? 6 : 20}
              inputMode={decimal ? "decimal" : "text"}
              pattern={decimal ? "[0-9]{1,3}([.,][0-9]{1,2})?" : undefined}
              placeholder={decimal ? "Např. 7,5" : "Např. licence"}
              value={text}
              onChange={(event) => {
                setText(event.target.value);
                onChange(event.target.value);
              }}
            />
            <ChevronDown className={styles.choiceArrow} />
            <select
              className={styles.choicePicker}
              aria-label={`Možnosti pro ${name.toLocaleLowerCase("cs-CZ")}`}
              value=""
              onChange={(event) => choose(event.target.value)}
            >
              <option value="" disabled>
                Vyberte možnost
              </option>
              {optionElements}
            </select>
          </>
        ) : (
          <select
            id={id}
            aria-label={name}
            value={value}
            onChange={(event) => choose(event.target.value)}
          >
            {optionElements}
          </select>
        )}
      </div>
    </div>
  );
}

function Card({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className={styles.card}>
      <header>
        <h2>{title}</h2>
      </header>
      <div className={styles.cardBody}>{children}</div>
    </section>
  );
}
export function InvoiceCreation() {
  const { data, error, mutate } = useSWR<CreationContext>(
    "/api/invoices/creation",
    (url) => apiFetch(url),
    { revalidateOnFocus: false },
  );
  if (error)
    return (
      <section className={styles.state} role="alert">
        <h1>Nová faktura</h1>
        <p>{error.message}</p>
        <button
          type="button"
          className="btn secondary"
          onClick={() => void mutate()}
        >
          Zkusit znovu
        </button>
      </section>
    );
  if (!data)
    return (
      <section className={styles.state} aria-busy="true">
        <h1>Nová faktura</h1>
        <p>Načítám firemní údaje a odběratele…</p>
      </section>
    );
  return <CreationEditor key={data.draft_scope} context={data} />;
}
function CreationEditor({ context }: { context: CreationContext }) {
  const key = `issued-invoice:${context.draft_scope}`;
  const invalidate = useInvalidateWorkspaceData(["/api/invoices/creation"]);
  const [draft, setDraft] = useState<CreationDraft>(() => {
    const fresh = emptyCreation(
      context.supplier,
      todayInTimeZone(),
      crypto.randomUUID(),
      context.suggested_number,
    );
    const saved = readInvoiceDraft(key);
    if (saved) {
      try {
        const restored = parseCreationDraft(saved);
        return {
          ...restored,
          issue_date: fresh.issue_date,
          tax_date:
            restored.tax_date === restored.issue_date
              ? fresh.tax_date
              : restored.tax_date,
          due_date:
            restored.due_date < fresh.issue_date
              ? fresh.due_date
              : restored.due_date,
        };
      } catch {
        /* Other draft schemas never enter this form. */
      }
    }
    return fresh;
  });
  const [dirty, setDirty] = useState(false),
    [error, setError] = useState(""),
    [notice, setNotice] = useState("");
  const [busy, setBusy] = useState<string | null>(null),
    inFlight = useRef(false),
    form = useRef<HTMLFormElement>(null);
  const [issued, setIssued] = useState<Invoice | null>(null),
    [sent, setSent] = useState(false);
  const [sendConfirmation, setSendConfirmation] = useState(false),
    [numberInfo, setNumberInfo] = useState(false);
  const [pdfUrl, setPdfUrl] = useState<string | null>(null),
    pdfObject = useRef<string | null>(null),
    pdfFrame = useRef<HTMLIFrameElement>(null);
  const [printNotice, setPrintNotice] = useState("");
  const [pdfFile, setPdfFile] = useState<File | null>(null);
  const [customerDialog, setCustomerDialog] = useState(false),
    [newCustomer, setNewCustomer] = useState<InvoiceParty>({
      name: "",
      ico: "",
      dic: "",
      address: "",
      email: "",
    });
  const [customerBusy, setCustomerBusy] = useState(false),
    [customerError, setCustomerError] = useState("");
  const [query, setQuery] = useState(""),
    [pickerOpen, setPickerOpen] = useState(false),
    [options, setOptions] = useState<Customer[]>(context.customers),
    [selected, setSelected] = useState(0),
    [searchError, setSearchError] = useState("");
  const pickerId = useId(),
    formId = useId();
  const missing = supplierProblems(context.supplier);
  const accounts = useMemo(
    () =>
      organizationAccounts(
        context.supplier,
        context.supplier.bank_accounts,
      ).filter((a) => a.currency === draft.currency),
    [context.supplier, draft.currency],
  );
  const preview = useMemo(() => {
    if (issued) return { document: issuedDocument(issued), error: "" };
    try {
      return { document: creationPreview(draft, context.supplier), error: "" };
    } catch (cause) {
      return {
        document: null,
        error: cause instanceof Error ? cause.message : "Zkontrolujte položky.",
      };
    }
  }, [draft, context.supplier, issued]);
  useUnsavedChanges(dirty && !issued);
  useEffect(() => {
    const timer = setTimeout(
      () => saveInvoiceDraft(key, draft as unknown as InvoiceInput),
      300,
    );
    return () => clearTimeout(timer);
  }, [draft, key]);
  useEffect(
    () => () => {
      if (pdfObject.current) URL.revokeObjectURL(pdfObject.current);
    },
    [],
  );
  useEffect(() => {
    if (!pickerOpen) return;
    if (!query.trim()) {
      setOptions(context.customers);
      setSearchError("");
      return;
    }
    const controller = new AbortController();
    const timer = setTimeout(() => {
      void apiFetch<{ customers: Customer[] }>(
        `/api/customers/search?q=${encodeURIComponent(query)}`,
        { signal: controller.signal },
      )
        .then((data) => {
          setOptions(data.customers);
          setSelected(0);
          setSearchError("");
        })
        .catch((cause) => {
          if (!controller.signal.aborted) setSearchError(cause.message);
        });
    }, 220);
    return () => {
      controller.abort();
      clearTimeout(timer);
    };
  }, [query, pickerOpen, context.customers]);
  function update(patch: Partial<CreationDraft>) {
    if (issued) return;
    setDraft((current) => ({ ...current, ...patch }));
    setDirty(true);
    setNotice("");
  }
  function item(index: number, patch: Partial<CreationDraft["items"][number]>) {
    update({
      items: draft.items.map((row, i) =>
        i === index ? { ...row, ...patch } : row,
      ),
    });
  }
  async function choose(customer: Customer) {
    setPickerOpen(false);
    setSearchError("");
    try {
      const detail =
        customer.address === undefined
          ? (
              await apiFetch<{ customer: Customer }>(
                `/api/invoices/creation?customer_id=${customer.id}`,
              )
            ).customer
          : customer;
      update({ customer_id: detail.id, customer: party(detail) });
      setQuery("");
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "Zákazníka se nepodařilo načíst.",
      );
    }
  }
  function saveDraft() {
    if (!saveInvoiceDraft(key, draft as unknown as InvoiceInput)) {
      setError(
        "Koncept se nepodařilo uložit do úložiště prohlížeče. Údaje zůstávají v otevřeném formuláři; před dokončením kartu nezavírejte.",
      );
      return;
    }
    setError("");
    setDirty(false);
    setNotice(
      "Koncept je uložen v tomto prohlížeči do zavření karty. Nevstupuje do úhrad ani upomínek.",
    );
  }
  function validate(send: boolean) {
    const invalid = form.current?.querySelector<HTMLInputElement>(
      "input:invalid, select:invalid, textarea:invalid",
    );
    if (invalid) {
      let parent = invalid.parentElement;
      while (parent) {
        if (parent instanceof HTMLDetailsElement) parent.open = true;
        parent = parent.parentElement;
      }
    }
    if (!form.current?.reportValidity())
      throw new Error("Doplňte zvýrazněná pole formuláře.");
    creationDocument(parseCreationDraft(draft), context.supplier);
    if (send && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(draft.customer.email))
      throw new Error("Pro odeslání doplňte platný e-mail odběratele.");
  }
  async function issue(send: boolean) {
    if (inFlight.current) return;
    setError("");
    setNotice("");
    try {
      if (!issued) validate(send);
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "Zkontrolujte údaje faktury.",
      );
      return;
    }
    inFlight.current = true;
    setBusy(send ? "send" : "issue");
    setSendConfirmation(false);
    try {
      let invoice = issued;
      if (!invoice) {
        saveInvoiceDraft(key, draft as unknown as InvoiceInput);
        const result = await apiFetch<{ invoice: Invoice }>(
          "/api/invoices",
          {
            ...json({ creation: draft }),
            headers: {
              "content-type": "application/json",
              "x-idempotency-key": draft.request_id,
            },
          },
          30000,
        );
        invoice = result.invoice;
        setIssued(invoice);
        setDirty(false);
        void invalidate().catch(() => {
          /* Issuance succeeded; subsequent views can retry their own refresh. */
        });
      }
      if (send) {
        await apiFetch(
          `/api/invoices/${invoice.id}/send`,
          json({ purpose: "issue", recipient_confirmed: true }),
          45000,
        );
        setSent(true);
        setNotice(
          `Faktura ${invoice.invoice_number} byla vystavena a e-mailová služba přijala zprávu pro ${invoice.counterparty_email}.`,
        );
      } else
        setNotice(
          `Faktura ${invoice.invoice_number} byla vystavena. Je dostupná v seznamu faktur.`,
        );
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "Operace se nepodařila. Zadané údaje zůstaly zachované.",
      );
    } finally {
      inFlight.current = false;
      setBusy(null);
    }
  }
  function requestSend() {
    try {
      if (!issued) validate(true);
      setError("");
      setSendConfirmation(true);
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "Zkontrolujte e-mail odběratele.",
      );
    }
  }
  async function pdf(download: boolean) {
    if (inFlight.current) return;
    setError("");
    try {
      if (!issued) validate(false);
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "Doplňte údaje pro PDF.",
      );
      return;
    }
    inFlight.current = true;
    setBusy("pdf");
    try {
      const response = issued
        ? await fetch(`/api/invoices/${issued.id}/pdf`)
        : await fetch(
            "/api/invoices/creation/preview",
            json({ creation: draft }),
          );
      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || "PDF se nepodařilo připravit.");
      }
      if (!response.headers.get("content-type")?.includes("application/pdf"))
        throw new Error("Server nevrátil PDF faktury.");
      if (pdfObject.current) URL.revokeObjectURL(pdfObject.current);
      const file = new File(
        [await response.blob()],
        `${issued ? "Faktura" : "Koncept"}-${draft.invoice_number.replace(/[^\w.-]/g, "")}.pdf`,
        { type: "application/pdf" },
      );
      const url = URL.createObjectURL(file);
      pdfObject.current = url;
      if (download) {
        const link = document.createElement("a");
        link.href = url;
        link.download = `${issued ? "Faktura" : "Koncept"}-${draft.invoice_number.replace(/[^\w.-]/g, "")}.pdf`;
        link.click();
      } else {
        setPdfFile(file);
        setPrintNotice("");
        setPdfUrl(url);
      }
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "PDF se nepodařilo připravit.",
      );
    } finally {
      inFlight.current = false;
      setBusy(null);
    }
  }
  function printPdf() {
    if (!pdfUrl || !pdfFrame.current?.contentWindow) return;
    try {
      pdfFrame.current.contentWindow.focus();
      pdfFrame.current.contentWindow.print();
      setPrintNotice(
        "Pokud se tisk neotevřel, otevřete PDF samostatně a vytiskněte ho z prohlížeče.",
      );
    } catch {
      setPrintNotice(
        "Prohlížeč nepovolil přímý tisk. Otevřete PDF samostatně a použijte jeho nabídku tisku.",
      );
    }
  }
  // Keep the shortcut bound to the current draft rather than printing the editor.
  useEffect(() => {
    const handle = (event: KeyboardEvent) => {
      if (!(event.ctrlKey || event.metaKey) || event.key.toLowerCase() !== "p")
        return;
      event.preventDefault();
      if (pdfUrl) printPdf();
      else void pdf(false);
    };
    window.addEventListener("keydown", handle);
    return () => window.removeEventListener("keydown", handle);
  });
  async function upload(file?: File) {
    if (!file || inFlight.current) return;
    inFlight.current = true;
    setBusy("upload");
    setError("");
    try {
      const invalid = validateDocumentMetadata(file.type, file.size);
      if (invalid) throw new Error(invalid);
      if (
        !hasExpectedDocumentSignature(
          new Uint8Array(await file.slice(0, 16).arrayBuffer()),
          file.type,
        )
      )
        throw new Error("Obsah přílohy neodpovídá typu souboru.");
      const signed = await apiFetch<{ path: string; token: string }>(
        "/api/invoices/upload",
        json({ name: file.name, mime: file.type, size: file.size }),
      );
      const { createClient } = await import("@/lib/supabase-browser");
      const { error } = await createClient()
        .storage.from("invoice-documents")
        .uploadToSignedUrl(signed.path, signed.token, file, {
          contentType: file.type,
        });
      if (error) throw new Error("Přílohu se nepodařilo nahrát.");
      await apiFetch(
        "/api/invoices/upload/verify",
        json({ path: signed.path }),
      );
      update({ attachment: { path: signed.path, name: file.name } });
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "Přílohu se nepodařilo nahrát.",
      );
    } finally {
      inFlight.current = false;
      setBusy(null);
    }
  }
  async function addCustomer(event: FormEvent) {
    event.preventDefault();
    if (customerBusy) return;
    setCustomerBusy(true);
    setCustomerError("");
    try {
      const data = await apiFetch<{ customer: Customer }>(
        "/api/customers",
        json(newCustomer),
      );
      await choose(data.customer);
      setCustomerDialog(false);
    } catch (cause) {
      setCustomerError(
        cause instanceof Error
          ? cause.message
          : "Zákazníka se nepodařilo přidat.",
      );
    } finally {
      setCustomerBusy(false);
    }
  }
  return (
    <div className={styles.creation}>
      <header className={styles.heading}>
        <Link href="/invoices" className={styles.back}>
          <Icon name="arrow-left" />
          Zpět na faktury
        </Link>
        <div>
          <h1>Nová faktura</h1>
          <p>Vytvořte fakturu a odešlete ji zákazníkovi.</p>
        </div>
      </header>
      {error && (
        <div id="creation-error" className={styles.error} role="alert">
          <Icon name="alert-circle" />
          <span>
            {error}
            {issued && !sent
              ? " Doklad už je vystavený; další pokus o odeslání nevytvoří novou fakturu."
              : ""}
          </span>
        </div>
      )}
      {notice && (
        <div className={styles.notice} role="status">
          <Icon name="check" />
          <span>{notice}</span>
          {issued && (
            <Link href={`/invoices/${issued.id}`}>
              Otevřít fakturu <Icon name="arrow-right" />
            </Link>
          )}
        </div>
      )}
      {missing.length > 0 && (
        <div className={styles.warning} role="alert">
          <Icon name="alert-circle" />
          <span>
            Pro vystavení doplňte {missing.join(", ")}. Koncept můžete uložit.
          </span>
          <Link href="/settings">
            Nastavení firmy <Icon name="arrow-right" />
          </Link>
        </div>
      )}
      <div className={styles.layout}>
        <form
          ref={form}
          id={formId}
          className={styles.form}
          aria-describedby={error ? "creation-error" : undefined}
          onSubmit={(event) => {
            event.preventDefault();
            void issue(false);
          }}
        >
          <fieldset disabled={Boolean(issued) || Boolean(busy)}>
            <Card title="Základní údaje">
              <div className={styles.supplier}>
                <Icon name="home" />
                <span>
                  Vystavuje{" "}
                  <strong>{context.supplier.name || "Vaše firma"}</strong>
                </span>
                <Link href="/settings" aria-label="Firemní údaje v nastavení">
                  <Icon name="settings" />
                </Link>
              </div>
              <div className={styles.customerRow}>
                <div
                  className={styles.customerPicker}
                  onBlur={(event) => {
                    if (!event.currentTarget.contains(event.relatedTarget))
                      setPickerOpen(false);
                  }}
                >
                  <label htmlFor={pickerId}>Odběratel</label>
                  <div className={styles.searchControl}>
                    <Icon name="search" />
                    <input
                      id={pickerId}
                      role="combobox"
                      aria-expanded={pickerOpen}
                      aria-controls={`${pickerId}-results`}
                      aria-autocomplete="list"
                      aria-activedescendant={
                        pickerOpen && options[selected]
                          ? `${pickerId}-${selected}`
                          : undefined
                      }
                      value={pickerOpen ? query : draft.customer.name}
                      placeholder="Vyberte zákazníka…"
                      onFocus={() => setPickerOpen(true)}
                      onChange={(event) => {
                        setQuery(event.target.value);
                        setPickerOpen(true);
                      }}
                      onKeyDown={(event) => {
                        if (event.key === "Escape") {
                          event.preventDefault();
                          setPickerOpen(false);
                        }
                        if (
                          event.key === "ArrowDown" ||
                          event.key === "ArrowUp"
                        ) {
                          event.preventDefault();
                          setPickerOpen(true);
                          setSelected((current) =>
                            Math.max(
                              0,
                              Math.min(
                                options.length - 1,
                                current + (event.key === "ArrowDown" ? 1 : -1),
                              ),
                            ),
                          );
                        }
                        if (event.key === "Enter" && pickerOpen) {
                          event.preventDefault();
                          if (options[selected]) void choose(options[selected]);
                        }
                      }}
                    />
                    <Icon name="chevron-down" />
                  </div>
                  {pickerOpen && (
                    <div
                      className={styles.customerResults}
                      id={`${pickerId}-results`}
                      role="listbox"
                      aria-label="Zákazníci"
                      data-popup
                    >
                      {searchError ? (
                        <p role="alert">{searchError}</p>
                      ) : options.length ? (
                        options.map((customer, i) => (
                          <button
                            type="button"
                            role="option"
                            aria-selected={i === selected}
                            id={`${pickerId}-${i}`}
                            key={customer.id}
                            tabIndex={-1}
                            onMouseDown={(event) => event.preventDefault()}
                            onClick={() => void choose(customer)}
                          >
                            <strong>{customer.name}</strong>
                            <small>
                              {[
                                customer.ico && `IČO ${customer.ico}`,
                                customer.email,
                              ]
                                .filter(Boolean)
                                .join(" · ")}
                            </small>
                          </button>
                        ))
                      ) : (
                        <p>Žádný zákazník neodpovídá. Přidejte nového.</p>
                      )}
                    </div>
                  )}
                </div>
                <button
                  type="button"
                  className={styles.textButton}
                  onClick={() => {
                    setNewCustomer({
                      name: query,
                      ico: "",
                      dic: "",
                      email: "",
                      address: "",
                    });
                    setCustomerDialog(true);
                  }}
                >
                  <Icon name="plus" />
                  Přidat zákazníka
                </button>
              </div>
              <details
                className={styles.customerDetails}
                open={!draft.customer.name || undefined}
              >
                <summary>
                  Fakturační údaje odběratele <Icon name="chevron-down" />
                </summary>
                <div className={styles.fields}>
                  <Field label="Název / jméno *">
                    <input
                      required
                      value={draft.customer.name}
                      maxLength={200}
                      onChange={(event) =>
                        update({
                          customer_id: "",
                          customer: {
                            ...draft.customer,
                            name: event.target.value,
                          },
                        })
                      }
                    />
                  </Field>
                  <Field label="E-mail pro odeslání">
                    <input
                      type="email"
                      value={draft.customer.email}
                      maxLength={254}
                      onChange={(event) =>
                        update({
                          customer: {
                            ...draft.customer,
                            email: event.target.value,
                          },
                        })
                      }
                    />
                  </Field>
                  <Field label="Fakturační adresa *" wide>
                    <input
                      required
                      value={draft.customer.address}
                      maxLength={500}
                      onChange={(event) =>
                        update({
                          customer_id: "",
                          customer: {
                            ...draft.customer,
                            address: event.target.value,
                          },
                        })
                      }
                    />
                  </Field>
                  <Field label="IČO">
                    <input
                      value={draft.customer.ico}
                      maxLength={8}
                      pattern="[0-9]{8}"
                      onChange={(event) =>
                        update({
                          customer_id: "",
                          customer: {
                            ...draft.customer,
                            ico: event.target.value,
                          },
                        })
                      }
                    />
                  </Field>
                  <Field label="DIČ">
                    <input
                      value={draft.customer.dic}
                      maxLength={24}
                      onChange={(event) =>
                        update({
                          customer_id: "",
                          customer: {
                            ...draft.customer,
                            dic: event.target.value,
                          },
                        })
                      }
                    />
                  </Field>
                </div>
              </details>
              <div className={styles.fields}>
                <Field label="Číslo faktury *">
                  <div className={styles.numberControl}>
                    <input
                      required
                      maxLength={100}
                      value={draft.invoice_number}
                      onChange={(event) =>
                        update({ invoice_number: event.target.value })
                      }
                    />
                    <button
                      type="button"
                      aria-label="Pravidla číslování"
                      onClick={() => setNumberInfo(true)}
                    >
                      <Icon name="settings" />
                    </button>
                  </div>
                </Field>
                <Field label="Variabilní symbol">
                  <input
                    inputMode="numeric"
                    maxLength={10}
                    pattern="[0-9]{0,10}"
                    value={draft.variable_symbol}
                    onChange={(event) =>
                      update({ variable_symbol: event.target.value })
                    }
                  />
                </Field>
                <Field label="Datum vystavení *">
                  <input
                    required
                    type="date"
                    value={draft.issue_date}
                    onChange={(event) =>
                      update({ issue_date: event.target.value })
                    }
                  />
                </Field>
                <Field label="Datum splatnosti *">
                  <input
                    required
                    type="date"
                    min={draft.issue_date}
                    value={draft.due_date}
                    onChange={(event) =>
                      update({ due_date: event.target.value })
                    }
                  />
                </Field>
                {context.supplier.vat_payer === true && (
                  <Field label="DUZP *">
                    <input
                      required
                      type="date"
                      value={draft.tax_date}
                      onChange={(event) =>
                        update({ tax_date: event.target.value })
                      }
                    />
                  </Field>
                )}
                <Field label="Měna">
                  <select
                    value={draft.currency}
                    onChange={(event) =>
                      update({
                        currency: event.target.value,
                        payment_account:
                          organizationAccounts(
                            context.supplier,
                            context.supplier.bank_accounts,
                          ).find((a) => a.currency === event.target.value)
                            ?.account ?? "",
                      })
                    }
                  >
                    {INVOICE_CURRENCIES.map((code) => (
                      <option
                        key={code}
                        disabled={
                          context.supplier.vat_payer === true && code !== "CZK"
                        }
                      >
                        {code}
                      </option>
                    ))}
                  </select>
                </Field>
                <Field label="Způsob úhrady">
                  <select
                    value={draft.payment_method}
                    onChange={(event) =>
                      update({
                        payment_method: event.target.value as "bank" | "cash",
                      })
                    }
                  >
                    <option value="bank">Bankovní převod</option>
                    <option value="cash">Hotově</option>
                  </select>
                </Field>
                {draft.payment_method === "bank" && (
                  <Field label="Bankovní účet *">
                    <select
                      required
                      value={draft.payment_account}
                      onChange={(event) =>
                        update({ payment_account: event.target.value })
                      }
                    >
                      <option value="">Vyberte firemní účet</option>
                      {accounts.map((account) => (
                        <option key={account.account}>{account.account}</option>
                      ))}
                    </select>
                  </Field>
                )}
              </div>
              <p className={styles.help}>
                {context.supplier.vat_payer === false
                  ? "Neplátce DPH · daň se k položkám nepřipočítává."
                  : "Sazbu DPH lze zvolit pro každou položku zvlášť. Zvláštní režimy DPH a kurzové přepočty nejsou součástí tohoto formuláře."}
              </p>
            </Card>
            <Card title="Položky faktury">
              <div className={styles.items}>
                {draft.items.map((row, index) => (
                  <div className={styles.itemRow} key={row.id}>
                    <Field label="Položka">
                      <input
                        aria-label={`Název položky ${index + 1}`}
                        required
                        placeholder="Název služby nebo zboží"
                        maxLength={500}
                        value={row.description}
                        onChange={(event) =>
                          item(index, { description: event.target.value })
                        }
                      />
                    </Field>
                    <Field label="Množství">
                      <input
                        aria-label={`Množství ${index + 1}`}
                        inputMode="decimal"
                        required
                        value={row.quantity}
                        onChange={(event) =>
                          item(index, { quantity: event.target.value })
                        }
                      />
                    </Field>
                    <ItemChoice
                      label="Jednotka"
                      name={`Jednotka ${index + 1}`}
                      value={row.unit}
                      options={UNIT_OPTIONS}
                      onChange={(unit) => item(index, { unit })}
                    />
                    <Field label="Cena/MJ bez DPH">
                      <input
                        aria-label={`Cena za jednotku ${index + 1}`}
                        inputMode="decimal"
                        required
                        value={row.unit_price}
                        onChange={(event) =>
                          item(index, { unit_price: event.target.value })
                        }
                      />
                    </Field>
                    {context.supplier.vat_payer !== false && (
                      <ItemChoice
                        label="DPH"
                        name={`Sazba DPH ${index + 1}`}
                        value={
                          row.vat_rate === null ? "" : String(row.vat_rate)
                        }
                        options={VAT_OPTIONS}
                        decimal
                        onChange={(value) =>
                          item(index, {
                            vat_rate:
                              value.trim() === ""
                                ? null
                                : Number(value.replace(",", ".")),
                          })
                        }
                      />
                    )}
                    <div className={styles.lineTotal}>
                      <span>Celkem bez DPH</span>
                      <strong>
                        {preview.document?.totals.lines[index]
                          ? exactMoney(
                              preview.document.totals.lines[index].net,
                              draft.currency,
                            )
                          : "—"}
                      </strong>
                      {Number(row.discount.replace(",", ".")) > 0 && (
                        <small>Sleva {row.discount} %</small>
                      )}
                    </div>
                    <details className={styles.itemMenu}>
                      <summary aria-label={`Akce položky ${index + 1}`}>
                        <Icon name="more" />
                      </summary>
                      <div data-popup>
                        <button
                          type="button"
                          onClick={(event) => {
                            event.currentTarget
                              .closest("details")
                              ?.removeAttribute("open");
                            update({
                              items: [
                                ...draft.items.slice(0, index + 1),
                                { ...row, id: crypto.randomUUID() },
                                ...draft.items.slice(index + 1),
                              ],
                            });
                          }}
                        >
                          <Icon name="plus" />
                          Duplikovat položku
                        </button>
                        <label>
                          Sleva (%)
                          <input
                            aria-label={`Sleva ${index + 1}`}
                            inputMode="decimal"
                            value={row.discount}
                            onChange={(event) =>
                              item(index, { discount: event.target.value })
                            }
                          />
                        </label>
                        <button
                          type="button"
                          disabled={draft.items.length === 1}
                          onClick={() =>
                            update({
                              items: draft.items.filter((_, i) => i !== index),
                            })
                          }
                        >
                          <Icon name="close" />
                          Odstranit položku
                        </button>
                      </div>
                    </details>
                  </div>
                ))}
              </div>
              <button
                type="button"
                className="btn secondary"
                disabled={draft.items.length >= 200}
                onClick={() =>
                  update({
                    items: [
                      ...draft.items,
                      {
                        id: crypto.randomUUID(),
                        description: "",
                        quantity: "1",
                        unit: "ks",
                        unit_price: "0",
                        discount: "0",
                        vat_rate:
                          context.supplier.vat_payer === false ? null : 21,
                      },
                    ],
                  })
                }
              >
                <Icon name="plus" />
                Přidat položku
              </button>
              {preview.error && (
                <p className={styles.inlineError} role="alert">
                  {preview.error}
                </p>
              )}
              {preview.document && (
                <dl className={styles.totals}>
                  <div>
                    <dt>Bez DPH</dt>
                    <dd>
                      {exactMoney(preview.document.totals.net, draft.currency)}
                    </dd>
                  </div>
                  {context.supplier.vat_payer === true &&
                    preview.document.totals.breakdown.map((row) => (
                      <div key={row.rate}>
                        <dt>DPH {row.rate} %</dt>
                        <dd>{exactMoney(row.tax, draft.currency)}</dd>
                      </div>
                    ))}
                  <div>
                    <dt>Celkem k úhradě</dt>
                    <dd>
                      {exactMoney(
                        preview.document.totals.gross,
                        draft.currency,
                      )}
                    </dd>
                  </div>
                </dl>
              )}
            </Card>
            <Card title="Poznámky">
              <div className={styles.fields}>
                <Field label="Poznámka na faktuře">
                  <textarea
                    value={draft.public_note}
                    maxLength={5000}
                    placeholder="Např. děkujeme za spolupráci."
                    onChange={(event) =>
                      update({ public_note: event.target.value })
                    }
                  />
                </Field>
                <Field label="Interní poznámka">
                  <textarea
                    value={draft.internal_note}
                    maxLength={5000}
                    placeholder="Viditelná pouze ve Splatnu…"
                    onChange={(event) =>
                      update({ internal_note: event.target.value })
                    }
                  />
                </Field>
              </div>
              <p className={styles.help}>
                Interní poznámka se nepřenáší do náhledu, PDF ani e-mailu
                zákazníkovi.
              </p>
            </Card>
            <Card title="Příloha">
              <div className={styles.attachment}>
                <Icon name="document" />
                <div>
                  <strong>
                    {draft.attachment?.name ||
                      "Přiložte podklad pro interní evidenci"}
                  </strong>
                  <small>
                    PDF, JPG, PNG nebo WEBP · nejvýše 10 MB · neodesílá se
                    zákazníkovi
                  </small>
                </div>
                {draft.attachment ? (
                  <button
                    type="button"
                    className={styles.textButton}
                    onClick={() => update({ attachment: null })}
                  >
                    Odebrat
                  </button>
                ) : (
                  <label className="btn secondary">
                    Vybrat soubor
                    <input
                      type="file"
                      accept="application/pdf,image/jpeg,image/png,image/webp"
                      className={styles.hiddenFile}
                      onChange={(event) => {
                        void upload(event.target.files?.[0]);
                        event.target.value = "";
                      }}
                    />
                  </label>
                )}
              </div>
            </Card>
          </fieldset>
        </form>
        <aside className={styles.preview}>
          <div className={styles.previewHeading}>
            <h2>Náhled faktury</h2>
            <label>
              Šablona
              <select aria-label="Šablona faktury" disabled>
                <option>Standardní</option>
              </select>
            </label>
          </div>
          {preview.document ? (
            <InvoiceDocument document={preview.document} />
          ) : (
            <div className={styles.previewEmpty}>
              <Icon name="document" />
              <p>Náhled se zobrazí po zadání platných položek.</p>
            </div>
          )}
          <div className={styles.actions}>
            <div className={styles.issueRow}>
              <button
                type="button"
                className="btn primary"
                disabled={
                  Boolean(busy) ||
                  Boolean(issued && (sent || !context.can_send))
                }
                onClick={() =>
                  context.can_send ? requestSend() : void issue(false)
                }
              >
                <Icon name={context.can_send ? "mail" : "check"} />
                {busy === "send"
                  ? "Odesílám fakturu…"
                  : busy === "issue"
                    ? "Vystavuji fakturu…"
                    : issued
                      ? sent
                        ? "Faktura odeslána"
                        : context.can_send
                          ? "Odeslat vystavenou fakturu"
                          : "Faktura vystavena"
                      : context.can_send
                        ? "Vystavit a odeslat fakturu"
                        : "Vystavit fakturu"}
              </button>
              <details className={styles.actionMenu}>
                <summary aria-label="Další možnosti vystavení">
                  <Icon name="chevron-down" />
                </summary>
                <div data-popup>
                  <button
                    type="button"
                    disabled={Boolean(busy) || Boolean(issued)}
                    onClick={() => void issue(false)}
                  >
                    Vystavit bez odeslání
                  </button>
                  <button
                    type="button"
                    disabled={Boolean(busy) || Boolean(issued)}
                    onClick={saveDraft}
                  >
                    Uložit koncept
                  </button>
                </div>
              </details>
            </div>
            <div className={styles.secondaryActions}>
              <button
                type="button"
                className="btn secondary"
                disabled={Boolean(busy)}
                onClick={() => void pdf(true)}
              >
                <Icon name="download" />
                Stáhnout PDF
              </button>
              <button
                type="button"
                className="btn secondary"
                disabled={Boolean(busy)}
                onClick={() => void pdf(false)}
              >
                <Icon name="search" />
                Zobrazit PDF
              </button>
            </div>
            {!issued && (
              <button
                type="button"
                className={styles.saveDraft}
                disabled={Boolean(busy)}
                onClick={saveDraft}
              >
                Uložit koncept
              </button>
            )}
            {issued && (
              <>
                <Link
                  className={styles.savedLink}
                  href={`/invoices/${issued.id}`}
                >
                  Otevřít vystavenou fakturu <Icon name="arrow-right" />
                </Link>
                <button
                  type="button"
                  className={styles.textButton}
                  disabled={Boolean(busy)}
                  onClick={() => {
                    clearInvoiceDraft(key);
                    const next = draft.invoice_number.replace(
                      /(\d+)$/,
                      (number) =>
                        String(Number(number) + 1).padStart(number.length, "0"),
                    );
                    setDraft(
                      emptyCreation(
                        context.supplier,
                        todayInTimeZone(),
                        crypto.randomUUID(),
                        next,
                      ),
                    );
                    setIssued(null);
                    setSent(false);
                    setNotice("");
                    setError("");
                  }}
                >
                  Vystavit další fakturu
                </button>
              </>
            )}
            {!context.can_send && (
              <p className={styles.help}>
                E-mailová služba není nakonfigurovaná. Fakturu můžete vystavit a
                stáhnout.
              </p>
            )}
          </div>
        </aside>
      </div>
      <Modal
        open={customerDialog}
        onClose={() => setCustomerDialog(false)}
        labelledBy="creation-customer-title"
        closeDisabled={customerBusy}
        className={`${styles.dialog} ${styles.customerDialog}`}
      >
        <form
          className={styles.customerForm}
          onSubmit={(event) => void addCustomer(event)}
        >
          <header>
            <div className={styles.customerHeading}>
              <span className={styles.customerBadge}>
                <Icon name="users" />
              </span>
              <div>
                <h2 id="creation-customer-title">Přidat zákazníka</h2>
                <p>Uložte odběratele a rovnou ho použijte ve faktuře.</p>
              </div>
            </div>
            <button
              type="button"
              className={styles.iconButton}
              aria-label="Zavřít zákazníka"
              onClick={() => setCustomerDialog(false)}
              disabled={customerBusy}
            >
              <Icon name="close" />
            </button>
          </header>
          <div className={styles.customerBody}>
            <div className={styles.fields}>
              {(
                [
                  ["name", "Název / jméno *"],
                  ["email", "E-mail"],
                  ["address", "Fakturační adresa *"],
                  ["ico", "IČO"],
                  ["dic", "DIČ"],
                ] as const
              ).map(([name, label]) => (
                <Field key={name} label={label} wide={name === "address"}>
                  <input
                    type={name === "email" ? "email" : "text"}
                    required={name === "name" || name === "address"}
                    placeholder={
                      {
                        name: "Např. WOOD & PAPER a.s.",
                        email: "fakturace@firma.cz",
                        address: "Ulice a číslo, město, PSČ",
                        ico: "12345678",
                        dic: "CZ12345678",
                      }[name]
                    }
                    value={newCustomer[name]}
                    maxLength={
                      name === "ico"
                        ? 8
                        : name === "dic"
                          ? 24
                          : name === "email"
                            ? 254
                            : 500
                    }
                    onChange={(event) =>
                      setNewCustomer((current) => ({
                        ...current,
                        [name]: event.target.value,
                      }))
                    }
                  />
                </Field>
              ))}
            </div>
            <p className={styles.customerHint}>Povinná pole jsou označena *.</p>
            {customerError && (
              <p role="alert" className={styles.inlineError}>
                {customerError}
              </p>
            )}
          </div>
          <footer className={styles.customerActions}>
            <button
              type="button"
              className="btn secondary"
              disabled={customerBusy}
              onClick={() => setCustomerDialog(false)}
            >
              Zrušit
            </button>
            <button
              type="submit"
              className="btn primary"
              disabled={customerBusy}
            >
              {customerBusy ? "Ukládám…" : "Přidat a vybrat zákazníka"}
            </button>
          </footer>
        </form>
      </Modal>
      <Modal
        open={sendConfirmation}
        onClose={() => setSendConfirmation(false)}
        labelledBy="creation-send-title"
        className={styles.dialog}
      >
        <h2 id="creation-send-title">
          {issued ? "Odeslat fakturu" : "Vystavit a odeslat fakturu"}
        </h2>
        <p>
          PDF faktury odešleme na adresu{" "}
          <strong>{issued?.counterparty_email || draft.customer.email}</strong>.
        </p>
        <p>Interní poznámka ani podklad pro evidenci se neodesílají.</p>
        <div className={styles.secondaryActions}>
          <button
            type="button"
            className="btn secondary"
            onClick={() => setSendConfirmation(false)}
          >
            Zpět
          </button>
          <button
            type="button"
            className="btn primary"
            onClick={() => void issue(true)}
          >
            Potvrdit odeslání
          </button>
        </div>
      </Modal>
      <Modal
        open={numberInfo}
        onClose={() => setNumberInfo(false)}
        labelledBy="creation-number-title"
        className={styles.dialog}
      >
        <h2 id="creation-number-title">Číslo a variabilní symbol</h2>
        <p>
          Předvyplněné číslo je návrh, nikoli rezervace. Při vystavení ověřujeme
          jeho jedinečnost v rámci firmy. Číslo lze upravit podle vaší řady.
        </p>
        <p>
          Variabilní symbol je samostatný údaj a smí obsahovat nejvýše 10
          číslic.
        </p>
        <button
          type="button"
          className="btn secondary"
          onClick={() => setNumberInfo(false)}
        >
          Rozumím
        </button>
      </Modal>
      <Modal
        open={Boolean(pdfUrl)}
        onClose={() => setPdfUrl(null)}
        labelledBy="creation-pdf-title"
        className={styles.pdfDialog}
      >
        <header>
          <h2 id="creation-pdf-title">
            {issued ? "Faktura" : "Koncept faktury"} · PDF
          </h2>
          <button
            type="button"
            className={styles.iconButton}
            aria-label="Zavřít náhled PDF"
            onClick={() => setPdfUrl(null)}
          >
            <Icon name="close" />
          </button>
        </header>
        <p className={styles.printHint}>
          A4 na výšku · měřítko 100 % · okraje jsou součástí PDF.
        </p>
        {pdfFile && (
          <div className={styles.pdfPages}>
            <InvoicePdfPreview file={pdfFile} kind="invoice" />
          </div>
        )}
        {pdfUrl && (
          <iframe
            ref={pdfFrame}
            title="PDF faktury"
            src={pdfUrl}
            className={styles.printFrame}
            aria-hidden="true"
            tabIndex={-1}
          />
        )}
        <div className={styles.printActions}>
          {pdfUrl && (
            <a href={pdfUrl} target="_blank" rel="noopener noreferrer">
              Otevřít PDF samostatně
            </a>
          )}
          <button
            type="button"
            className="btn primary"
            disabled={!pdfUrl}
            onClick={printPdf}
          >
            <Icon name="print" /> Vytisknout fakturu
          </button>
        </div>
        {printNotice && (
          <p className={styles.printHint} role="status">
            {printNotice}
          </p>
        )}
      </Modal>
    </div>
  );
}
