import Link from "next/link";
import { getCachedRequestIdentity } from "@/lib/auth";
import { supplierConfiguration } from "@/lib/billing";
import { loadOrder, syncCardPayment } from "@/lib/billing-server";
import { formatCzk } from "@/lib/plans";
import styles from "../predplatne.module.css";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Návrat z platební brány (a stránka objednávky placené převodem). Stav karty
// se ověří přímo u Comgate, kdyby oznámení z brány ještě nedorazilo.
export default async function SubscriptionReturnPage({ searchParams }: { searchParams: Promise<{ objednavka?: string }> }) {
  const { objednavka } = await searchParams;
  const identity = await getCachedRequestIdentity();
  const order = identity && objednavka && UUID_RE.test(objednavka) ? await loadOrder(objednavka, identity.membership.organization_id) : null;
  if (!order) return <p className="page-state error-state">Objednávka nebyla nalezena. <Link href="/predplatne">Zpět na předplatné</Link></p>;

  const card = order.payment_method === "card";
  const state = order.status === "paid" ? "paid" : card ? (await syncCardPayment(order.id)).state : "pending";
  const supplier = supplierConfiguration();
  return (
    <div className={styles.page}>
      <section className={styles.summary}>
        <h1>{state === "paid" ? "Děkujeme, tarif je aktivní" : state === "cancelled" ? "Platba byla zrušena" : card ? "Platba se zpracovává" : "Objednávka přijata"}</h1>
        {state === "paid" ? <p>Faktura odešla na {order.billing.email}. Najdete ji i v <Link href="/predplatne">přehledu předplatného</Link>.</p> : null}
        {state === "cancelled" ? <p>Nic se nestrhlo. <Link href="/predplatne">Zkusit znovu</Link></p> : null}
        {state !== "paid" && state !== "cancelled" && card ? <p>Jakmile brána platbu potvrdí, tarif se aktivuje. Stránku můžete obnovit za chvíli.</p> : null}
        {!card && state !== "paid" && supplier ? (
          <dl>
            <div><dt>Účet</dt><dd>{supplier.account}</dd></div>
            <div><dt>Variabilní symbol</dt><dd>{order.variable_symbol}</dd></div>
            <div className={styles.total}><dt>Částka</dt><dd>{formatCzk(order.gross_halere)}</dd></div>
          </dl>
        ) : null}
        <p><a className="btn secondary" href={`/api/billing/orders/${order.id}/pdf`}>{order.invoice_number ? "Stáhnout fakturu" : "Stáhnout výzvu k platbě s QR kódem"}</a> <Link className="btn primary" href="/dashboard">Na nástěnku</Link></p>
      </section>
    </div>
  );
}
