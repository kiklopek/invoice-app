import { minorUnits } from "@/lib/money";
import type { Invoice, PreviewEntry } from "./payment-matching-types";

export const paymentMoney = (value: number, currency = "CZK") => new Intl.NumberFormat("cs-CZ", { style: "currency", currency }).format(value);
export function paymentDate(value?: string | null) {
  if (!value) return "—";
  const date = new Date(`${value.slice(0, 10)}T12:00:00`);
  return Number.isNaN(date.valueOf()) ? "—" : date.toLocaleDateString("cs-CZ");
}
export const isOpenPayment = (entry: PreviewEntry) => entry.disposition === "accepted" && !entry.bank_payment_id;
export function matchingState(entry: PreviewEntry, ids: string[], unrelated: boolean, manualAdjustment = false) {
  if (entry.bank_payment_id) return { tone: "booked", label: "Již zaúčtováno", detail: "Platba už je zaúčtovaná. Změnu provedete uvolněním přiřazení." };
  if (entry.disposition === "ignored") return { tone: "muted", label: "Ignorováno", detail: entry.reason || "Položka není příchozí platbou určenou k párování." };
  if (entry.disposition === "duplicate") return { tone: "danger", label: "Duplicita", detail: entry.reason || "Duplicitní položka se znovu nezaúčtuje." };
  if (entry.disposition === "error" || entry.processing_error) return { tone: "danger", label: "Vyžaduje kontrolu", detail: entry.processing_error || entry.reason || "Položku nelze bezpečně zpracovat." };
  if (entry.overlap_warning && !entry.overlap_acknowledged_by) return { tone: "danger", label: "Možná duplicita", detail: "Před zaúčtováním ověřte původní transakci z jiného formátu výpisu." };
  if (unrelated) return { tone: "muted", label: "Nesouvisí s fakturami", detail: "Řádek je označený jako nesouvisející. Rozhodnutí se uloží při potvrzení kontroly." };
  if (!manualAdjustment && entry.proposal_confidence === "safe" && ids.length > 0 && ids.length === entry.proposed_invoice_ids.length && ids.every(id => entry.proposed_invoice_ids.includes(id))) {
    return { tone: "safe", label: "Vysoká shoda", detail: "Jednoznačně navržená shoda. Jde o návrh přiřazení, nikoli potvrzení zaúčtování." };
  }
  if (ids.length > 0 || entry.proposed_invoice_ids.length > 0) return { tone: "review", label: "K ověření", detail: entry.proposal_reason || "Přiřazení vyžaduje vaši kontrolu." };
  return { tone: "danger", label: "Nespárováno", detail: "Vyberte fakturu nebo řádek označte jako nesouvisející s fakturami." };
}
export function allocationIsValid(entry: PreviewEntry, values: Invoice[], difference: number, partial: boolean, unrelated: boolean) {
  if (!isOpenPayment(entry) || (entry.overlap_warning && !entry.overlap_acknowledged_by)) return false;
  if (unrelated) return true;
  return values.length > 0 && values.every(invoice => invoice.currency === entry.currency)
    && Number.isFinite(difference) && minorUnits(difference) >= 0
    && (partial || minorUnits(difference) === 0);
}
export function paymentMatchesQuery(entry: PreviewEntry, query: string) {
  const normalize = (value: string) => value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/\s/g, "");
  const needle = normalize(query.trim());
  if (!needle) return true;
  return [entry.counterparty_name, entry.variable_symbol, entry.counterparty_account, entry.amount == null ? null : String(entry.amount), entry.amount == null ? null : paymentMoney(Number(entry.amount), entry.currency || "CZK")]
    .some(value => value != null && normalize(value).includes(needle));
}

/** Skupina řádku pro souhrn a řazení: co potřebuje člověka, je nahoře. */
export type NeedGroup = "review" | "unmatched" | "safe" | "other";
export function needGroup(entry: PreviewEntry, state: { tone: string; label: string }): NeedGroup {
  if (state.tone === "safe") return "safe";
  if (state.label === "Nespárováno") return "unmatched";
  if (state.tone === "review" || (state.tone === "danger" && isOpenPayment(entry))) return "review";
  return "other";
}
export const NEED_ORDER: Record<NeedGroup, number> = { review: 0, unmatched: 1, safe: 2, other: 3 };
/** „1 jistou shodu“, „2 jisté shody“, „5 jistých shod“. */
export function safeMatchesLabel(count: number) {
  if (count === 1) return "1 jistou shodu";
  if (count >= 2 && count <= 4) return `${count} jisté shody`;
  return `${count} jistých shod`;
}

/**
 * Krátký důvod návrhu pro řádek platby („Shoda VS a částky“). Plné vysvětlení
 * zůstává v detailu platby; neznámý důvod se na řádku neukáže.
 */
const SHORT_REASONS: Array<[RegExp, string]> = [
  [/vlastního účtu/, "Vlastní převod"],
  [/už uhrazená/, "Faktura už je uhrazená"],
  [/jiným zůstatkem/, "Jiná částka než faktura"],
  [/Stejný variabilní symbol nese více|Stejnému VS a částce odpovídá více/, "Víc faktur se stejným VS"],
  [/uchází více plateb|nárokuje stejnou fakturu/, "Víc plateb na jednu fakturu"],
  [/VS nebo čísla faktury.*zbývající částky/, "Shoda VS a částky"],
  [/zprávě pro příjemce/, "Číslo faktury ve zprávě"],
  [/Účet plátce je potvrzeně/, "Známý účet plátce"],
  [/podle jména plátce/, "Stejné jméno a částka"],
  [/kombinace celých faktur/, "Součet faktur odběratele"],
  [/Jediná otevřená faktura s přesně touto částkou/, "Jen stejná částka"],
];
export function shortReason(reason: string | null | undefined) {
  if (!reason) return null;
  return SHORT_REASONS.find(([pattern]) => pattern.test(reason))?.[1] ?? null;
}
