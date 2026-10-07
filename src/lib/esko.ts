import type { DashboardData } from "./dashboard-summary";
import { canAccessPage, type AccessRole } from "./role-access";

// Esko, asistent v aplikaci. Zatím bez jazykového modelu: odpovídá jen na
// otázky, na které zná přesnou odpověď z živých čísel nástěnky. Nic si
// nedomýšlí a nic sám neodesílá -- akce zůstávají na tlačítkách v aplikaci.

export type EskoQuestionId = "today" | "overdue" | "open" | "paid";

export const ESKO_QUESTIONS: { id: EskoQuestionId; label: string }[] = [
  { id: "today", label: "Co mám dnes řešit?" },
  { id: "overdue", label: "Kolik je po splatnosti?" },
  { id: "open", label: "Kolik čeká na úhradu?" },
  { id: "paid", label: "Kolik už přišlo?" },
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
  return canAccessPage(role, href) ? href : undefined;
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

  return {
    text: `Zatím přišlo ${totals(data.paid_totals)}, včetně částečných úhrad.`,
    lines: [],
  };
}
