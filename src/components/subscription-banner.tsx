import Link from "next/link";
import type { BillingNotice } from "@/lib/billing";

const days = (n: number) => `${n} ${n === 1 ? "den" : n >= 2 && n <= 4 ? "dny" : "dní"}`;

function text(notice: BillingNotice) {
  switch (notice.kind) {
    case "trial_ending":
      return `Zkušební doba končí za ${days(notice.daysLeft)}. Potom se strhne zvolený tarif z uložené karty.`;
    case "trial_invoices":
      return `Ve zkušební době jste přidali ${notice.used} z ${notice.limit} faktur.`;
    case "trial_limit":
      return `Vyčerpali jste ${notice.limit} faktur zkušební doby. Další přidáte po zahájení placeného tarifu.`;
    case "payment_failed":
      return "Poslední platba za Splatno se nezdařila. Aktualizujte prosím kartu, ať se nic nepozastaví.";
    case "expired":
      return "Předplatné skončilo. Data zůstávají, ale nové faktury a automatické upomínky jsou pozastavené.";
    case "needs_payment":
      return "Pro používání Splatna dokončete nastavení platby.";
  }
}

// Pruh nad obsahem aplikace: zkušební doba, limit faktur, nezdařená platba.
export function SubscriptionBanner({ notice, canManage }: { notice: BillingNotice | null; canManage: boolean }) {
  if (!notice) return null;
  const urgent = notice.kind === "expired" || notice.kind === "payment_failed" || notice.kind === "trial_limit";
  return (
    <div className="subscription-banner" role="status" data-kind={urgent ? "expired" : notice.kind}>
      <span>{text(notice)}</span>
      {canManage
        ? <Link href="/predplatne" className="btn primary">{notice.kind === "payment_failed" ? "Aktualizovat kartu" : "Spravovat předplatné"}</Link>
        : <span>Předplatné spravuje administrátor firmy.</span>}
    </div>
  );
}
