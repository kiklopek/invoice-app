import type { DashboardData } from "./dashboard-summary";
import { canAccessPage, type AccessRole } from "./role-access";
import type { Invoice } from "@/types/invoice";

// Esko odpovídá z aktuálních firemních dat. Volný text rozpoznává lokálně;
// účetní údaje neposílá externímu jazykovému modelu a nic sám nezapisuje.

export type EskoQuestionId = "today" | "overdue" | "open" | "paid" | "payments" | "imports" | "reminders" | "next_reminder";
export type EskoIntent = { kind: "question"; id: EskoQuestionId } | { kind: "invoice_search" | "customer_debt"; query: string } | { kind: "help" };

export const ESKO_QUESTIONS: { id: EskoQuestionId; label: string }[] = [
  { id: "today", label: "Co mám dnes řešit?" },
  { id: "overdue", label: "Kolik je po splatnosti?" },
  { id: "open", label: "Kolik čeká na úhradu?" },
  { id: "paid", label: "Kolik už přišlo?" },
  { id: "payments", label: "Platby ke kontrole" },
  { id: "imports", label: "Faktury z OCR" },
  { id: "reminders", label: "Stav upomínek" },
  { id: "next_reminder", label: "Další upomínka" },
];

export type EskoLine = { text: string; href?: string };
export type EskoAnswer = { text: string; lines: EskoLine[] };

const SYMBOL: Record<string, string> = { CZK: "Kč", EUR: "€", USD: "$" };

function amount(value: number, currency: string) {
  const number = new Intl.NumberFormat("cs-CZ", { maximumFractionDigits: 0 })
    .format(Math.round(value))
    .replace(/\s/g, "\u00a0");
  // Pevné mezery, aby se částka v bublině nezalomila uprostřed čísla.
  return `${number}\u00a0${SYMBOL[currency] ?? currency}`;
}

// Každá měna zvlášť: sečíst korun a eur by dalo nesmyslné číslo.
function totals(map: Record<string, number>) {
  const rows = Object.entries(map).filter(([, value]) => value > 0).sort(([a], [b]) => a.localeCompare(b));
  return rows.length ? rows.map(([currency, value]) => amount(value, currency)).join(" a ") : amount(0, "CZK");
}

function plural(count: number, one: string, few: string, many: string) {
  if (count === 1) return one;
  return count >= 2 && count <= 4 ? few : many;
}

function link(href: string, role: AccessRole | null) {
  return canAccessPage(role, href.split("?")[0]) ? href : undefined;
}

function normalizeQuestion(value: string) {
  return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/\s+/g, " ").trim();
}

export function eskoIntent(text: string): EskoIntent {
  const query = normalizeQuestion(text);
  const invoiceNumber = query.match(/\b\d[\d/-]{4,}\b/)?.[0];
  if (invoiceNumber && /\b(faktur|doklad|cislo|vs|variabilni|najdi|hledej|vyhledej|stav)\w*/.test(query)) {
    return { kind: "invoice_search", query: invoiceNumber };
  }
  const namedSearch = query.match(/^(?:najdi|hledej|vyhledej|ukaz)\s+(?:faktur\w*|doklad\w*)\s+(?:(?:od|pro)\s+)?(.+)$/);
  if (namedSearch?.[1] && namedSearch[1].length >= 2) return { kind: "invoice_search", query: namedSearch[1].slice(0, 100) };
  const companyDebt = query.match(/^kolik dluzi (?:firma|odberatel)\s+(.+)$/);
  if (companyDebt?.[1] && companyDebt[1].length >= 2) return { kind: "customer_debt", query: companyDebt[1].slice(0, 100) };
  if (/parovan|nesparovan|platb|bankovn/.test(query)) return { kind: "question", id: "payments" };
  if (/\bocr\b|vyt[eě]z|import|dokument/.test(query)) return { kind: "question", id: "imports" };
  if (/upomink|pripomink/.test(query)) {
    return { kind: "question", id: /dalsi|nejblizsi|kdy|naplan/.test(query) ? "next_reminder" : "reminders" };
  }
  if (/po splatnosti|prosl|dluzn/.test(query)) return { kind: "question", id: "overdue" };
  if (/prijato|prislo|uhrazen|zaplacen|trzb/.test(query)) return { kind: "question", id: "paid" };
  if (/ceka.*uhrad|neuhrazen|otevren|pohledav|kolik dluz/.test(query)) return { kind: "question", id: "open" };
  if (/dnes|priorit|resit|prehled|co mam/.test(query)) return { kind: "question", id: "today" };
  return { kind: "help" };
}

export function eskoHelpAnswer(): EskoAnswer {
  return {
    text: "Můžete se zeptat na dnešní priority, pohledávky, platby, OCR nebo upomínky. Umím také najít fakturu podle čísla či názvu odběratele, například „najdi fakturu 2026001“.",
    lines: [],
  };
}

type FoundInvoice = Pick<Invoice, "id" | "invoice_number" | "counterparty_name" | "amount" | "paid_amount" | "currency" | "status" | "due_date">;
const STATUS_LABEL: Record<Invoice["status"], string> = {
  pending: "čeká na úhradu", overdue: "po splatnosti", paid: "zaplaceno", cancelled: "stornováno",
};

export function eskoInvoiceSearchAnswer(query: string, invoices: FoundInvoice[], total: number, role: AccessRole | null): EskoAnswer {
  const searchHref = link(`/invoices?q=${encodeURIComponent(query)}`, role);
  if (!total) return {
    text: `Fakturu odpovídající „${query}“ jsem v této firmě nenašel. Zkuste kratší číslo nebo název odběratele.`,
    lines: searchHref ? [{ text: "Otevřít hledání faktur", href: searchHref }] : [],
  };
  const lines = invoices.slice(0, 3).map((invoice) => ({
    text: `${invoice.invoice_number} · ${invoice.counterparty_name} · ${STATUS_LABEL[invoice.status]} · splatnost ${new Intl.DateTimeFormat("cs-CZ", { day: "numeric", month: "numeric", year: "numeric", timeZone: "Europe/Prague" }).format(new Date(`${invoice.due_date}T12:00:00Z`))} · zbývá ${amount(Math.max(0, Number(invoice.amount) - Number(invoice.paid_amount)), invoice.currency)}`,
    href: link(`/invoices/${invoice.id}`, role),
  }));
  if (total > 3 && searchHref) lines.push({ text: "Zobrazit všechny výsledky", href: searchHref });
  return { text: `Našel jsem ${total} ${plural(total, "fakturu", "faktury", "faktur")}:`, lines };
}

export function eskoCustomerDebtAnswer(query: string, found: number, openTotals: Record<string, number>, role: AccessRole | null): EskoAnswer {
  if (!found) return eskoInvoiceSearchAnswer(query, [], 0, role);
  return {
    text: `Ve ${found} ${plural(found, "nalezené faktuře", "nalezených fakturách", "nalezených fakturách")} pro „${query}“ zbývá k úhradě ${totals(openTotals)}. Ověřte, že výsledky patří zamýšlenému odběrateli.`,
    lines: [{ text: "Zkontrolovat nalezené faktury", href: link(`/invoices?q=${encodeURIComponent(query)}`, role) }].filter(line => line.href),
  };
}

// Firma bez jediné faktury a platby (typicky hned po onboardingu).
export function isNewCompany(data: DashboardData) {
  return data.active_count === 0
    && data.overdue_count === 0
    && data.recent.length === 0
    && Object.keys(data.paid_totals).length === 0
    && data.payments_needing_review === 0
    && data.ocr_pending_confirmation === 0;
}

const FIRST_STEPS: EskoLine[] = [
  { text: "Vystavit první fakturu", href: "/invoices/new" },
  { text: "Nahrát faktury z PDF", href: "/invoices/import" },
  { text: "Pozvat kolegy do firmy", href: "/settings" },
  { text: "Nastavit upomínky (zatím jsou vypnuté)", href: "/reminders" },
];

export function eskoAnswer(
  id: EskoQuestionId,
  data: DashboardData,
  role: AccessRole | null,
  { newCompany = isNewCompany(data) }: { newCompany?: boolean } = {},
): EskoAnswer {
  if (id === "today" && newCompany) {
    // Jen kroky, které role opravdu smí udělat; odkaz na zákaz nepomůže.
    const lines = FIRST_STEPS.filter((step) => step.href && canAccessPage(role, step.href));
    return lines.length
      ? { text: "Firma je připravená. Začněte tady:", lines }
      : { text: "Firma je připravená. Jakmile kolegové přidají první faktury, uvidíte je tady.", lines: [] };
  }
  if (id === "today") {
    const lines: EskoLine[] = [];
    if (data.overdue_count > 0) {
      lines.push({
        text: `${data.overdue_count} ${plural(data.overdue_count, "faktura", "faktury", "faktur")} po splatnosti za ${totals(data.overdue_totals)}`,
        href: link("/invoices", role),
      });
    }
    if (data.payments_needing_review > 0) {
      lines.push({
        text: `${data.payments_needing_review} ${plural(data.payments_needing_review, "platba čeká", "platby čekají", "plateb čeká")} na spárování`,
        href: link("/invoices/payments", role),
      });
    }
    if (data.ocr_pending_confirmation > 0) {
      lines.push({
        text: `${data.ocr_pending_confirmation} ${plural(data.ocr_pending_confirmation, "faktura z importu čeká", "faktury z importu čekají", "faktur z importu čeká")} na kontrolu`,
        href: link("/invoices/import", role),
      });
    }
    if (data.reminders_due_soon > 0) {
      lines.push({
        text: `${data.reminders_due_soon} ${plural(data.reminders_due_soon, "upomínka se brzy odešle", "upomínky se brzy odešlou", "upomínek se brzy odešle")}`,
        href: link("/reminders", role),
      });
    }
    return lines.length
      ? { text: "Dnes bych se podíval na tohle:", lines }
      : { text: "Dnes nic nehoří. Žádná faktura po splatnosti ani platba ke kontrole.", lines: [] };
  }

  if (id === "overdue") {
    return data.overdue_count > 0
      ? {
          text: `Po splatnosti ${plural(data.overdue_count, "je", "jsou", "je")} ${data.overdue_count} ${plural(data.overdue_count, "faktura", "faktury", "faktur")} za ${totals(data.overdue_totals)}.`,
          lines: [{ text: "Zobrazit faktury", href: link("/invoices", role) }],
        }
      : { text: "Žádná faktura není po splatnosti.", lines: [] };
  }

  if (id === "open") {
    return {
      text: data.active_count > 0
        ? `Na úhradu čeká ${data.active_count} ${plural(data.active_count, "faktura", "faktury", "faktur")} za ${totals(data.open_totals)}, včetně těch po splatnosti.`
        : "Žádná faktura teď nečeká na úhradu.",
      lines: [],
    };
  }

  if (id === "payments") {
    return {
      text: data.payments_needing_review > 0
        ? `${data.payments_needing_review} ${plural(data.payments_needing_review, "platba čeká", "platby čekají", "plateb čeká")} na kontrolu při párování.`
        : "Žádná platba teď nečeká na kontrolu při párování.",
      lines: [{ text: "Otevřít platby", href: link("/invoices/payments", role) }].filter(line => line.href),
    };
  }

  if (id === "imports") {
    return {
      text: data.ocr_pending_confirmation > 0
        ? `${data.ocr_pending_confirmation} ${plural(data.ocr_pending_confirmation, "faktura z importu čeká", "faktury z importu čekají", "faktur z importu čeká")} na potvrzení údajů.`
        : "Žádná vytěžená faktura teď nečeká na potvrzení.",
      lines: [{ text: "Otevřít import faktur", href: link("/invoices/import", role) }].filter(line => line.href),
    };
  }

  if (id === "reminders") {
    return {
      text: `${data.reminders_due_soon} ${plural(data.reminders_due_soon, "upomínka je", "upomínky jsou", "upomínek je")} naplánováno v nejbližší době. Celkem bylo odesláno ${data.reminders_sent} ${plural(data.reminders_sent, "upomínka", "upomínky", "upomínek")}.`,
      lines: [{ text: "Otevřít upomínky", href: link("/reminders", role) }].filter(line => line.href),
    };
  }

  if (id === "next_reminder") {
    const next = data.upcoming[0];
    if (!next?.next_reminder_at) return { text: "U aktivních faktur teď nevidím žádnou naplánovanou další upomínku.", lines: [] };
    const when = new Intl.DateTimeFormat("cs-CZ", { dateStyle: "medium", timeStyle: "short", timeZone: "Europe/Prague" }).format(new Date(next.next_reminder_at));
    return {
      text: `Nejbližší evidovaná upomínka je naplánovaná na ${when} pro fakturu ${next.invoice_number} (${next.counterparty_name}).`,
      lines: [{ text: "Otevřít fakturu", href: link(`/invoices/${next.id}`, role) }].filter(line => line.href),
    };
  }

  return {
    text: `Zatím přišlo ${totals(data.paid_totals)}, včetně částečných úhrad.`,
    lines: [],
  };
}
