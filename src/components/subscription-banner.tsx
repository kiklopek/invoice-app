import Link from "next/link";

// Pruh nad obsahem aplikace: posledních 7 dní zkušební doby a po jejím konci.
export function SubscriptionBanner({ warning, canOrder }: { warning: { kind: "ending" | "expired"; daysLeft: number } | null; canOrder: boolean }) {
  if (!warning) return null;
  const text = warning.kind === "expired"
    ? "Zkušební doba skončila. Data zůstávají, ale nové faktury a automatické upomínky jsou pozastavené."
    : `Zkušební doba končí za ${warning.daysLeft} ${warning.daysLeft === 1 ? "den" : warning.daysLeft < 5 ? "dny" : "dní"}.`;
  return (
    <div className="subscription-banner" role="status" data-kind={warning.kind}>
      <span>{text}</span>
      {canOrder ? <Link href="/predplatne" className="btn primary">Vybrat tarif</Link> : <span>Tarif může koupit administrátor firmy.</span>}
    </div>
  );
}
