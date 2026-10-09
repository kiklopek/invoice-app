export type OperatorCompany = {
  id: string;
  name: string;
  ico: string | null;
  email: string | null;
  created_at: string;
  state: string;
  plan: string;
  trial: string | null;
  trialDenied: string | null;
  stripeCustomer: string | null;
};

const date = (value: string | null) => (value ? new Date(value).toLocaleDateString("cs-CZ") : "—");

const DENIED: Record<string, string> = { ico_used: "IČO už mělo zkušební dobu", card_used: "karta už měla zkušební dobu", ip_limit: "limit z jedné IP" };

// Přehled firem a předplatného. Platby, karty, faktury a vratky se řeší ve
// Stripe Dashboardu (odkaz u firmy), ne tady.
export function OperatorConsole({ operatorEmail, companies, stripeDashboard }: { operatorEmail: string; companies: OperatorCompany[]; stripeDashboard: string }) {
  const counts = companies.reduce<Record<string, number>>((all, company) => ({ ...all, [company.state]: (all[company.state] ?? 0) + 1 }), {});
  return (
    <main style={{ maxWidth: 1200, margin: "0 auto", padding: "32px 20px", display: "grid", gap: 24 }}>
      <header>
        <h1 style={{ margin: 0 }}>Provoz Splatna</h1>
        <p style={{ margin: "6px 0 0", color: "#5f6b64" }}>
          Přihlášen(a) jako {operatorEmail}. Platby a faktury za předplatné jsou ve <a href={stripeDashboard} target="_blank" rel="noreferrer">Stripe Dashboardu</a>.
        </p>
      </header>
      <section className="page-panel">
        <h2 style={{ marginTop: 0 }}>Firmy ({companies.length})</h2>
        <p style={{ color: "#5f6b64" }}>
          Zkušební doba {counts.trial ?? 0} · placené {counts.active ?? 0} · nezdařená platba {counts.past_due ?? 0} · bez karty {counts.needs_payment ?? 0} · ukončené {counts.expired ?? 0}
        </p>
        <div style={{ overflowX: "auto" }}>
          <table className="data-table">
            <thead><tr><th>Firma</th><th>IČO</th><th>Založena</th><th>Stav</th><th>Tarif</th><th>Zkušební doba</th><th>Stripe</th></tr></thead>
            <tbody>
              {companies.map((company) => (
                <tr key={company.id}>
                  <td>{company.name}<br /><small>{company.email ?? "—"}</small></td>
                  <td>{company.ico ?? "—"}</td>
                  <td>{date(company.created_at)}</td>
                  <td>{company.state}</td>
                  <td>{company.plan}</td>
                  <td>{company.trial ?? (company.trialDenied ? `bez: ${DENIED[company.trialDenied] ?? company.trialDenied}` : "—")}</td>
                  <td>{company.stripeCustomer ? <a href={`${stripeDashboard}/customers/${company.stripeCustomer}`} target="_blank" rel="noreferrer">zákazník</a> : "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </main>
  );
}
