import Link from "next/link";
import { CompanyLogo } from "@/components/company-logo";
import { Icon } from "@/components/icons";
import {
  FLAG_REASON_LABELS,
  FLAG_STATUS_LABELS,
  formatDate,
  formatMoney,
  INVOICE_STATUS_LABELS,
  netPositions,
  type CurrencyBalance,
  type NetworkFlag,
  type NetworkInvoiceStatus,
} from "@/lib/partner-network";

// Drobné společné kousky stránek Splatno Sítě.

export function PartnerIdentity({
  name,
  ico,
  logo,
  detail,
  href,
}: {
  name: string;
  ico: string;
  logo: string | null;
  detail?: string | null;
  href?: string;
}) {
  const body = (
    <>
      <CompanyLogo src={logo} name={name} />
      <span>
        <strong>{name}</strong>
        <small>IČO {ico}{detail ? ` · ${detail}` : ""}</small>
      </span>
    </>
  );
  return href
    ? <Link href={href} className="network-identity">{body}</Link>
    : <span className="network-identity">{body}</span>;
}

export function NetPills({ balances }: { balances: CurrencyBalance[] }) {
  const positions = netPositions(balances);
  if (!positions.length) return <span className="net-pill settled">Vyrovnáno</span>;
  return (
    <span className="net-pill-list">
      {positions.map((position) => (
        <span key={position.currency} className={`net-pill ${position.direction}`}>
          {position.direction === "settled"
            ? `Vyrovnáno (${position.currency})`
            : `${position.direction === "they_owe" ? "Dluží vám" : "Dlužíte"} ${formatMoney(Math.abs(position.net), position.currency)}`}
        </span>
      ))}
    </span>
  );
}

export function InvoiceStatusBadge({ status }: { status: NetworkInvoiceStatus }) {
  return <span className={`status ${status}`}><i />{INVOICE_STATUS_LABELS[status]}</span>;
}

export function FlagBadges({ flags, currency }: { flags: NetworkFlag[]; currency: string }) {
  const visible = flags.filter((flag) => flag.status === "open" || flag.decided_at);
  if (!visible.length) return null;
  return (
    <>
      {visible.map((flag) => (
        <span
          key={flag.id}
          className={`flag-badge ${flag.kind === "payment_claimed" ? "payment" : ""} ${flag.status === "open" ? "" : "closed"}`.trim()}
          title={flag.note ?? undefined}
        >
          <Icon name={flag.kind === "payment_claimed" ? "bank" : "alert"} />
          {flag.kind === "payment_claimed"
            ? `Oznámená platba ${formatMoney(Number(flag.claimed_amount ?? 0), currency, 2)} (${formatDate(flag.claimed_paid_on)})`
            : `Rozpor: ${flag.reason ? FLAG_REASON_LABELS[flag.reason] : "jiný důvod"}`}
          {flag.status !== "open" ? ` · ${FLAG_STATUS_LABELS[flag.status]}` : ""}
        </span>
      ))}
    </>
  );
}
