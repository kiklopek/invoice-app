import Link from "next/link";

// Dřív neexistovalo vůbec: neplatná adresa nebo neexistující ID faktury
// skončilo na výchozí anglické stránce Next.js, bez layoutu aplikace.
// Pro českou fakturační aplikaci to vypadá jako pád, ne jako překlep v URL.
export default function NotFound() {
  return (
    <main className="app-error-page">
      <section className="app-error-card">
        <p className="eyebrow">Splatno</p>
        <h1>Stránka nenalezena</h1>
        <p>
          Tahle adresa neexistuje. Mohla se změnit, nebo byl odkaz opsaný
          nepřesně. Doklad, který hledáte, najdete v seznamu faktur.
        </p>
        <div className="button-row">
          <Link className="btn primary" href="/dashboard">
            Zpět na přehled
          </Link>
          <Link className="btn secondary" href="/invoices">
            Seznam faktur
          </Link>
        </div>
      </section>
    </main>
  );
}
