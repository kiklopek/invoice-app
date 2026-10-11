// Model obrazovky kontroly výpisu: z řádku výpisu a toho, co uživatel zatím
// vybral, spočítá, v jakém stavu platba je a co od uživatele potřebuje.
//
// Žádná nová pravidla párování -- rozhoduje se z toho, co už vrací server
// (disposition, proposal_confidence, bank_payment_id, overlap_warning …).
// Jen se to přeloží do tří „krabic“, kterým rozumí i člověk, který se
// v účetnictví nevyzná:
//   done          -- zaúčtováno, nebo připraveno a nic dalšího netřeba;
//   needs_answer  -- návrh ke kontrole, žádný návrh, nebo nesedí částka;
//   not_invoice   -- odchozí, vlastní převod, duplicita, chyba řádku.
//
// Pravidla částek odpovídají kontrole v databázi (save_statement_review):
// součet přiřazení nesmí převýšit platbu, nesmí převýšit zbytek faktury a
// musí se rovnat platbě, ledaže je přiřazení výslovně „částečné“
// (is_manual_partial) -- to je přeplatek, kdy faktura dostane jen svůj zbytek.
import { minorUnits } from "@/lib/money";

export type ReviewInvoice = {
  id: string;
  invoice_number: string;
  counterparty_name: string;
  amount: number;
  paid_amount: number;
  currency: string;
  variable_symbol: string | null;
};

export type ReviewEntry = {
  disposition: "accepted" | "ignored" | "error" | "duplicate";
  reason: string | null;
  amount: number | string | null;
  currency: string | null;
  variable_symbol: string | null;
  counterparty_name: string | null;
  bank_payment_id?: string | null;
  processing_error?: string | null;
  overlap_warning?: boolean;
  overlap_acknowledged_by?: string | null;
  proposal_kind: string | null;
  proposal_confidence: "safe" | "review" | null;
  proposal_reason: string | null;
  proposed_invoice_ids: string[];
};

export type ReviewChoice = {
  /** Vybrané faktury (pořadí = pořadí výběru). */
  selectedIds: string[];
  /** Ručně upravené částky přiřazení podle faktury. */
  amounts?: Record<string, number>;
  /** Přeplatek odsouhlasený uživatelem: faktura dostane jen svůj zbytek. */
  overpaymentAccepted?: boolean;
  /** Řádek označený „Nesouvisí s fakturami“. */
  unrelated?: boolean;
  /** Možnou duplicitu uživatel označil „Je to stejná platba“ (uloží se jako nesouvisející). */
  duplicateSkipped?: boolean;
  /** Uživatel výslovně odpověděl „Nechat nespárovanou“. */
  leftUnmatched?: boolean;
  /** Proč řádek vypadá jako převod mezi vlastními účty. */
  ownTransferReason?: string | null;
  /** Proč ho automat zaúčtoval (jen u automaticky zaúčtovaných). */
  autoReason?: string | null;
};

export type ReviewBucket = "done" | "needs_answer" | "not_invoice";

export type ReviewStatus =
  // done
  | "booked"
  | "ready"
  | "ready_partial"
  | "ready_overpaid"
  | "left_unmatched"
  // needs_answer
  | "suggested"
  | "no_match"
  | "underpaid"
  | "overpaid"
  | "over_allocated"
  | "possible_duplicate"
  // not_invoice
  | "unrelated"
  | "own_transfer"
  | "outgoing"
  | "ignored"
  | "duplicate"
  | "error";

export type PaymentReview = {
  bucket: ReviewBucket;
  status: ReviewStatus;
  /** Jedna věta pro člověka: proč je platba v tomto stavu. */
  plainReason: string;
  /** Faktury, které navrhujeme (prázdné = nic nenavrhujeme). */
  suggestionIds: string[];
  /** Kolik je z platby rozděleno na vybrané faktury. */
  allocated: number;
  /** Platba minus rozděleno (kladné = zbývá, záporné = vybráno víc). */
  difference: number;
  /** Faktura se uhradí jen zčásti (platba je menší než její zbytek). */
  isPartial: boolean;
  /** Řádek lze ještě měnit (není zaúčtovaný ani mimo platby). */
  editable: boolean;
};

const remaining = (invoice: ReviewInvoice) =>
  Math.max(0, minorUnits(Number(invoice.amount)) - minorUnits(Number(invoice.paid_amount))) / 100;

const sameSet = (a: string[], b: string[]) => a.length === b.length && a.every((id) => b.includes(id));

/**
 * Částky, se kterými se řádek uloží. Stejné jako dřív v panelu: ručně
 * zadaná částka, jinak celý zbytek faktury; u odsouhlaseného přeplatku
 * s jednou fakturou nejvýš výše platby a příznak is_manual_partial.
 */
export function reviewAllocations(entry: ReviewEntry, choice: ReviewChoice, invoices: Map<string, ReviewInvoice>) {
  const chosen = choice.selectedIds
    .map((id) => invoices.get(id))
    .filter((invoice): invoice is ReviewInvoice => Boolean(invoice));
  const payment = minorUnits(Number(entry.amount ?? 0));
  const overpaid = Boolean(choice.overpaymentAccepted) && chosen.length === 1;
  return chosen.map((invoice, index) => {
    const manual = choice.amounts?.[invoice.id];
    let amount = minorUnits(typeof manual === "number" && Number.isFinite(manual) && manual >= 0 ? manual : remaining(invoice));
    if (overpaid) amount = Math.min(amount, payment);
    return { invoice_id: invoice.id, amount: amount / 100, is_manual_partial: overpaid && index === 0 };
  });
}

export function reviewPayment(entry: ReviewEntry, choice: ReviewChoice, invoices: Map<string, ReviewInvoice>): PaymentReview {
  const amount = Number(entry.amount ?? 0);
  const allocations = reviewAllocations(entry, choice, invoices);
  const allocatedMinor = allocations.reduce((sum, item) => sum + minorUnits(item.amount), 0);
  const differenceMinor = minorUnits(amount) - allocatedMinor;
  const base = {
    suggestionIds: entry.proposed_invoice_ids ?? [],
    allocated: allocatedMinor / 100,
    difference: differenceMinor / 100,
    isPartial: allocations.some((item) => {
      const invoice = invoices.get(item.invoice_id);
      return invoice ? minorUnits(item.amount) < minorUnits(remaining(invoice)) : false;
    }),
  };
  const result = (bucket: ReviewBucket, status: ReviewStatus, plainReason: string, editable: boolean): PaymentReview =>
    ({ ...base, bucket, status, plainReason, editable });

  if (entry.disposition === "error")
    return result("not_invoice", "error", `Řádek výpisu se nepodařilo přečíst${entry.reason ? `: ${entry.reason.replace(/\.$/, "")}` : ""}. Nic se nezapíše.`, false);
  if (entry.disposition === "duplicate")
    return result("not_invoice", "duplicate", "Tuto platbu už máte z dřívějšího výpisu. Podruhé se nezapíše.", false);
  if (entry.disposition === "ignored")
    return amount < 0
      ? result("not_invoice", "outgoing", "Odchozí platba – k fakturám se nepřiřazuje.", false)
      : result("not_invoice", "ignored", `${entry.reason ? `${entry.reason.replace(/\.$/, "")}. ` : ""}K fakturám se nepřiřazuje.`, false);

  if (entry.bank_payment_id)
    return result("done", "booked", choice.autoReason ? `Zaúčtováno automaticky: ${lowerFirst(choice.autoReason)}` : "Zaúčtováno.", false);

  if (choice.unrelated && choice.duplicateSkipped)
    return result("not_invoice", "unrelated", "Stejná platba jako v jiném výpisu – podruhé se nezapíše.", true);
  if (choice.unrelated)
    return choice.ownTransferReason
      ? result("not_invoice", "own_transfer", `Převod mezi vašimi účty: ${lowerFirst(choice.ownTransferReason)}`, true)
      : result("not_invoice", "unrelated", "Označili jste, že platba nesouvisí s fakturami. Nezapíše se jako platba.", true);

  if (entry.overlap_warning && !entry.overlap_acknowledged_by)
    return result("needs_answer", "possible_duplicate", "Tuto platbu už možná máte z jiného výpisu (stejná částka, den i plátce).", true);

  if (choice.selectedIds.length === 0) {
    if (choice.leftUnmatched)
      return result("done", "left_unmatched", "Uloží se jako nespárovaná, fakturu přiřadíte později v Platbách.", true);
    if (base.suggestionIds.length > 0)
      return result("needs_answer", "suggested", plainProposalReason(entry), true);
    return result("needs_answer", "no_match", "Nenašli jsme fakturu, ke které platba patří.", true);
  }

  if (differenceMinor === 0) {
    const safe = entry.proposal_confidence === "safe" && sameSet(choice.selectedIds, base.suggestionIds);
    if (base.isPartial) return result("done", "ready_partial", "Částečná úhrada – faktura zůstane zčásti neuhrazená.", true);
    return result("done", "ready", safe ? `${plainProposalReason(entry)} Připraveno k zaúčtování.` : "Připraveno k zaúčtování.", true);
  }
  if (differenceMinor > 0)
    return choice.overpaymentAccepted && choice.selectedIds.length === 1
      ? result("done", "ready_overpaid", "Přeplatek – faktura se uhradí celá, zbytek platby zůstane nepřiřazený.", true)
      : result("needs_answer", "overpaid", "Platba je vyšší než vybrané faktury.", true);
  return choice.selectedIds.length === 1
    ? result("needs_answer", "underpaid", "Platba je menší než vybraná faktura.", true)
    : result("needs_answer", "over_allocated", "Vybrané faktury dohromady převyšují platbu.", true);
}

/** Důvod návrhu česky a bez zkratek. Serverový text se jen zbaví „VS“. */
export function plainProposalReason(entry: Pick<ReviewEntry, "proposal_reason" | "proposal_kind" | "proposed_invoice_ids">) {
  const reason = entry.proposal_reason?.trim();
  if (reason) return ensureSentence(reason.replace(/\bVS\b/g, "variabilní symbol"));
  if (entry.proposal_kind === "combination") return "Součet více faktur odpovídá platbě.";
  if (entry.proposal_kind === "account_suggestion") return "Ze stejného účtu jste dřív platby přiřadili k této firmě.";
  return entry.proposed_invoice_ids.length > 1 ? "Tyto faktury odpovídají platbě." : "Tato faktura odpovídá platbě.";
}

/** Co u kandidáta faktury sedí s platbou -- ukazuje se ve výběru faktury. */
export function invoiceFit(entry: Pick<ReviewEntry, "amount" | "variable_symbol" | "currency">, invoice: ReviewInvoice) {
  const amount = minorUnits(Number(entry.amount ?? 0));
  const symbol = (entry.variable_symbol ?? "").replace(/^0+/, "");
  return {
    amount: amount > 0 && amount === minorUnits(remaining(invoice)),
    symbol: Boolean(symbol) && (invoice.variable_symbol ?? "").replace(/^0+/, "") === symbol,
    currency: !entry.currency || entry.currency === invoice.currency,
    remaining: remaining(invoice),
  };
}

/** Kandidáti seřazení podle toho, co sedí: symbol i částka, pak symbol, pak částka. */
export function rankCandidates<T extends ReviewInvoice>(entry: Pick<ReviewEntry, "amount" | "variable_symbol" | "currency">, candidates: T[]) {
  const score = (invoice: T) => {
    const fit = invoiceFit(entry, invoice);
    return (fit.symbol ? 2 : 0) + (fit.amount ? 1 : 0);
  };
  return candidates
    .filter((invoice) => invoiceFit(entry, invoice).currency)
    .map((invoice, index) => ({ invoice, index, score: score(invoice) }))
    .sort((a, b) => b.score - a.score || a.index - b.index)
    .map((item) => item.invoice);
}

/** Výchozí hledání ve výběru faktury: variabilní symbol, jinak jméno plátce. */
export function defaultInvoiceQuery(entry: Pick<ReviewEntry, "variable_symbol" | "counterparty_name">) {
  const symbol = entry.variable_symbol?.replace(/^0+/, "");
  if (symbol) return symbol;
  // Dvě první slova jména; čárka za slovem („Novák, s.r.o.“) by hledání
  // zbytečně zúžila.
  return (entry.counterparty_name ?? "").trim().split(/\s+/).slice(0, 2).map((word) => word.replace(/[,;:]+$/, "")).filter(Boolean).join(" ");
}

export function summarize(reviews: PaymentReview[]) {
  return {
    done: reviews.filter((review) => review.bucket === "done").length,
    needs_answer: reviews.filter((review) => review.bucket === "needs_answer").length,
    not_invoice: reviews.filter((review) => review.bucket === "not_invoice").length,
  };
}

function lowerFirst(text: string) {
  const trimmed = ensureSentence(text.trim());
  return /^[A-ZÁČĎÉĚÍŇÓŘŠŤÚŮÝŽ][a-záčďéěíňóřšťúůýž]/.test(trimmed) ? trimmed[0].toLowerCase() + trimmed.slice(1) : trimmed;
}

function ensureSentence(text: string) {
  return /[.!?…]$/.test(text) ? text : `${text}.`;
}
