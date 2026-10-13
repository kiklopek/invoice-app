// Splatno Síť: typy a čisté funkce sdílené serverem i klientem.
//
// Pravidla (viz supabase/migrations/20261013120000_partner_network.sql):
// propojení firma↔firma vzniká žádostí a přijetím, faktury se nekopírují --
// partner čte faktury vystavitele přes propojení, a partner nikdy nemění
// peníze vystavitele (rozpor a oznámená platba jsou jen viditelné záznamy).

import { isValidIco } from "@/lib/company-validation";

export type PartnerCard = {
  id: string;
  name: string;
  ico: string;
  dic: string | null;
  address: string | null;
  logo_path: string | null;
};

export type CurrencyBalance = {
  currency: string;
  they_owe: number;
  we_owe: number;
  they_overdue: number;
  we_overdue: number;
  they_count: number;
  we_count: number;
};

export type ConnectionPreview = {
  open_count: number;
  open_totals: Record<string, number>;
  email_domain_match: boolean | null;
};

export type NetworkConnection = {
  id: string;
  status: "pending" | "active";
  direction: "incoming" | "outgoing";
  origin: "search" | "suggestion" | "invitation";
  message: string | null;
  created_at: string;
  activated_at: string | null;
  requested_by_email: string | null;
  partner: PartnerCard;
  balances: CurrencyBalance[];
  open_flags: number;
  preview: ConnectionPreview | null;
};

export type NetworkSuggestion = {
  partner: PartnerCard;
  relation: "customer" | "supplier" | "both";
  invoice_count: number;
};

export type InviteCandidate = {
  ico: string;
  name: string;
  email: string | null;
  invoice_count: number;
  open_amount_czk: number;
  invited_at: string | null;
};

export type NetworkInvitationRow = {
  id: string;
  ico: string;
  email: string;
  sent_at: string | null;
  expires_at: string;
  expired: boolean;
  accepted_at: string | null;
  accepted_partner: PartnerCard | null;
};

export type NetworkOverview = {
  me: { name: string; ico: string; network_ready: boolean; role: "accounting" | "admin" };
  connections: NetworkConnection[];
  suggestions: NetworkSuggestion[];
  invite_candidates: InviteCandidate[];
  invitations: NetworkInvitationRow[];
};

export type PartnersPageData = NetworkOverview & { can_manage: boolean };

export type FlagKind = "disputed" | "payment_claimed";
export type FlagReason = "price" | "quantity" | "not_delivered" | "duplicate" | "other";
export type FlagStatus = "open" | "resolved" | "rejected" | "withdrawn";

export type NetworkFlag = {
  id: string;
  kind: FlagKind;
  reason: FlagReason | null;
  note: string | null;
  status: FlagStatus;
  claimed_paid_on: string | null;
  claimed_amount: number | null;
  resolution_note: string | null;
  created_at: string;
  decided_at: string | null;
};

export type NetworkInvoiceStatus = "pending" | "overdue" | "paid";

export type NetworkInvoice = {
  id: string;
  invoice_number: string;
  variable_symbol: string | null;
  issue_date: string;
  due_date: string;
  amount: number;
  paid_amount: number;
  currency: string;
  status: NetworkInvoiceStatus;
  paid_at: string | null;
  issued_by_me: boolean;
  flags: NetworkFlag[];
};

export type ReceivedInvoice = NetworkInvoice & { connection_id: string; partner: PartnerCard };

export type PaymentBehaviour = { paid_count: number; avg_days_late: number | null; on_time_share: number | null };

export type PartnerDetail = {
  id: string;
  role: "accounting" | "admin";
  activated_at: string;
  origin: NetworkConnection["origin"];
  partner: PartnerCard & {
    email: string | null;
    phone: string | null;
    bank_account_czk: string | null;
    bank_account_eur: string | null;
  };
  share_history: { mine: boolean; theirs: boolean };
  balances: CurrencyBalance[];
  issued: NetworkInvoice[];
  received: NetworkInvoice[];
  behaviour: { they_pay: PaymentBehaviour; we_pay: PaymentBehaviour };
};

export type PartnerDetailPageData = PartnerDetail & { can_manage: boolean };

export type ReceivedInvoicesPageData = { invoices: ReceivedInvoice[] };

export type InvoiceNetworkContext =
  | { state: "not_connected"; partner: { name: string; ico: string } }
  | { state: "shared" | "not_shared"; connection_id: string; partner: { name: string; ico: string }; flags: NetworkFlag[] };

export type LookupResult =
  | { state: "invalid_ico" | "self" | "own_ico_ambiguous" }
  | { state: "not_on_network" | "ambiguous"; ico: string }
  | {
    state: "available" | "connected" | "pending_outgoing" | "pending_incoming";
    ico: string;
    connection_id: string | null;
    partner: { name: string; ico: string; logo_path: string | null };
  };

export const FLAG_REASON_LABELS: Record<FlagReason, string> = {
  price: "Nesouhlasí cena",
  quantity: "Nesouhlasí množství",
  not_delivered: "Plnění nebylo dodáno",
  duplicate: "Duplicitní faktura",
  other: "Jiný důvod",
};

export const FLAG_STATUS_LABELS: Record<FlagStatus, string> = {
  open: "Čeká na vyjádření",
  resolved: "Vyřešeno",
  rejected: "Zamítnuto",
  withdrawn: "Staženo",
};

export const INVOICE_STATUS_LABELS: Record<NetworkInvoiceStatus, string> = {
  pending: "Čeká na úhradu",
  overdue: "Po splatnosti",
  paid: "Zaplaceno",
};

export function normalizeIcoInput(value: string) {
  return value.replace(/\D/g, "").slice(0, 8);
}

export function isLookupIco(value: string) {
  return isValidIco(normalizeIcoInput(value));
}

const moneyFormatters = new Map<string, Intl.NumberFormat>();
export function formatMoney(value: number, currency = "CZK", fractionDigits = 0) {
  const key = `${currency}:${fractionDigits}`;
  let formatter = moneyFormatters.get(key);
  if (!formatter) {
    try {
      formatter = new Intl.NumberFormat("cs-CZ", {
        style: "currency", currency, minimumFractionDigits: fractionDigits, maximumFractionDigits: fractionDigits,
      });
    } catch {
      formatter = new Intl.NumberFormat("cs-CZ", { minimumFractionDigits: fractionDigits, maximumFractionDigits: fractionDigits });
    }
    moneyFormatters.set(key, formatter);
  }
  return formatter.format(Number.isFinite(value) ? value : 0);
}

export function formatDate(value: string | null) {
  if (!value) return "—";
  const parsed = new Date(/^\d{4}-\d{2}-\d{2}$/.test(value) ? `${value}T12:00:00` : value);
  return Number.isNaN(parsed.getTime()) ? "—" : new Intl.DateTimeFormat("cs-CZ").format(parsed);
}

export type NetPosition = {
  currency: string;
  net: number;
  direction: "they_owe" | "we_owe" | "settled";
  theyOwe: number;
  weOwe: number;
  overdue: number;
};

// Čistá pozice po měnách. Měny se nikdy nesčítají ani nepřepočítávají.
export function netPositions(balances: CurrencyBalance[]): NetPosition[] {
  return balances
    .map((balance) => {
      const theyOwe = Number(balance.they_owe) || 0;
      const weOwe = Number(balance.we_owe) || 0;
      const net = Math.round((theyOwe - weOwe) * 100) / 100;
      return {
        currency: balance.currency,
        net,
        theyOwe,
        weOwe,
        overdue: (Number(balance.they_overdue) || 0) + (Number(balance.we_overdue) || 0),
        direction: net > 0 ? "they_owe" as const : net < 0 ? "we_owe" as const : "settled" as const,
      };
    })
    .sort((left, right) => (left.currency === "CZK" ? -1 : right.currency === "CZK" ? 1 : left.currency.localeCompare(right.currency)));
}

export function describeNetPosition(position: NetPosition, partnerName?: string) {
  const amount = formatMoney(Math.abs(position.net), position.currency);
  if (position.direction === "settled") return "Vyrovnáno";
  if (position.direction === "they_owe") return partnerName ? `${partnerName} vám dluží ${amount}` : `Dluží vám ${amount}`;
  return partnerName ? `Dlužíte firmě ${partnerName} ${amount}` : `Dlužíte ${amount}`;
}

// Součet přes všechny aktivní partnery, zvlášť po měnách.
export function networkTotals(connections: NetworkConnection[]): CurrencyBalance[] {
  const totals = new Map<string, CurrencyBalance>();
  for (const connection of connections) {
    if (connection.status !== "active") continue;
    for (const balance of connection.balances) {
      const current = totals.get(balance.currency) ?? {
        currency: balance.currency, they_owe: 0, we_owe: 0, they_overdue: 0, we_overdue: 0, they_count: 0, we_count: 0,
      };
      current.they_owe += Number(balance.they_owe) || 0;
      current.we_owe += Number(balance.we_owe) || 0;
      current.they_overdue += Number(balance.they_overdue) || 0;
      current.we_overdue += Number(balance.we_overdue) || 0;
      current.they_count += Number(balance.they_count) || 0;
      current.we_count += Number(balance.we_count) || 0;
      totals.set(balance.currency, current);
    }
  }
  return [...totals.values()];
}

// „1 000 Kč + 200 €“ -- stejná konvence jako CurrencyTotals na přehledu.
export function formatCurrencyList(entries: Array<{ currency: string; amount: number }>) {
  const visible = entries.filter((entry) => Math.abs(entry.amount) >= 0.005);
  if (!visible.length) return formatMoney(0, "CZK");
  return visible.map((entry) => formatMoney(entry.amount, entry.currency)).join(" + ");
}

export function openAmount(invoice: Pick<NetworkInvoice, "amount" | "paid_amount">) {
  return Math.max(0, Math.round((Number(invoice.amount) - Number(invoice.paid_amount)) * 100) / 100);
}

export function behaviourLabel(behaviour: PaymentBehaviour | null | undefined) {
  if (!behaviour || !behaviour.paid_count) return "Zatím bez zaplacených faktur";
  const late = Number(behaviour.avg_days_late ?? 0);
  if (late < 0.5) return "Platí včas";
  const days = Math.round(late);
  return `Průměrně ${days} ${days === 1 ? "den" : days >= 2 && days <= 4 ? "dny" : "dní"} po splatnosti`;
}

export function hasOpenFlag(invoice: NetworkInvoice, kind?: FlagKind) {
  return invoice.flags.some((flag) => flag.status === "open" && (!kind || flag.kind === kind));
}

// Odmítnutí z databázových funkcí přeložená do vět, se kterými se dá něco udělat.
const NETWORK_ERRORS: Record<string, { status: number; message: string }> = {
  insufficient_permission: { status: 403, message: "K této akci nemáte oprávnění. Propojení spravuje administrátor firmy." },
  invalid_ico: { status: 400, message: "Zadejte platné IČO (8 číslic s kontrolní číslicí)." },
  invalid_origin: { status: 400, message: "Neplatný požadavek." },
  message_too_long: { status: 400, message: "Zpráva může mít nejvýš 500 znaků." },
  own_ico_ambiguous: { status: 409, message: "Vaše IČO je ve Splatnu u více firem. Než se propojíte, kontaktujte prosím podporu." },
  self_connection: { status: 400, message: "Nemůžete se propojit sami se sebou." },
  partner_not_found: { status: 404, message: "Firmu s tímto IČO se ve Splatnu nepodařilo jednoznačně najít." },
  already_connected: { status: 409, message: "S touto firmou už jste propojení." },
  already_pending: { status: 409, message: "Žádost už jste odeslali. Čeká na přijetí." },
  recently_declined: { status: 409, message: "Firma vaši žádost nedávno odmítla. Znovu ji můžete poslat za 30 dní." },
  daily_limit: { status: 429, message: "Dnes jste odeslali příliš mnoho žádostí. Zkuste to zítra." },
  connection_not_found: { status: 404, message: "Propojení nebylo nalezeno." },
  not_pending: { status: 409, message: "Žádost už byla vyřízena." },
  not_active: { status: 409, message: "Propojení už není aktivní." },
  use_decline: { status: 409, message: "Příchozí žádost odmítněte tlačítkem Odmítnout." },
  invalid_decision: { status: 400, message: "Neplatná volba." },
  invalid_flag: { status: 400, message: "Neplatný typ připomínky." },
  invoice_not_found: { status: 404, message: "Faktura nebyla nalezena." },
  invoice_closed: { status: 409, message: "Faktura už je uzavřená." },
  note_too_long: { status: 400, message: "Poznámka může mít nejvýš 1000 znaků." },
  invalid_reason: { status: 400, message: "Vyberte důvod rozporu." },
  note_required: { status: 400, message: "U jiného důvodu napište krátké vysvětlení." },
  invalid_paid_on: { status: 400, message: "Zadejte datum platby (nejpozději dnešní)." },
  invalid_amount: { status: 400, message: "Částka musí být kladná a nejvýš rovna zbývající částce faktury." },
  flag_exists: { status: 409, message: "K faktuře už máte otevřenou připomínku stejného typu." },
  flag_not_found: { status: 404, message: "Připomínka nebyla nalezena." },
  flag_closed: { status: 409, message: "Připomínka už byla vyřízena." },
  invalid_email: { status: 400, message: "Zadejte platnou e-mailovou adresu." },
  invalid_token: { status: 400, message: "Neplatný odkaz." },
  invalid_expiry: { status: 400, message: "Neplatná platnost pozvánky." },
  already_on_network: { status: 409, message: "Tato firma už Splatno používá. Pošlete jí místo pozvánky žádost o propojení." },
  email_suppressed: { status: 409, message: "Na tuto adresu nelze pozvánku poslat – příjemce si další zprávy nepřeje nebo e-mail nefunguje." },
  invitation_limit: { status: 409, message: "Firmu jste už pozvali dvakrát. Další pozvánku poslat nelze." },
  recently_invited: { status: 409, message: "Pozvánku jste poslali v posledních 7 dnech. Připomenout ji můžete později." },
  invitation_not_found: { status: 404, message: "Odkaz pozvánky už neplatí." },
  invitation_used: { status: 409, message: "Pozvánka už byla přijata." },
  invitation_expired: { status: 410, message: "Platnost pozvánky vypršela. Požádejte firmu o novou." },
  ico_mismatch: { status: 409, message: "Pozvánka je určená pro firmu s jiným IČO, než má vaše firma ve Splatnu. Propojení se nevytvořilo." },
};

export function networkErrorMessage(databaseMessage: string | null | undefined) {
  if (!databaseMessage) return null;
  const code = Object.keys(NETWORK_ERRORS).find((key) => databaseMessage.includes(key));
  return code ? { code, ...NETWORK_ERRORS[code] } : null;
}
