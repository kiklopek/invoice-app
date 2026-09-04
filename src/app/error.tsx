"use client";

import { useEffect } from "react";

export default function AppError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    console.error("Application route error", { message: error.message, digest: error.digest });
  }, [error]);

  return (
    <main className="app-error-page">
      <section className="app-error-card" role="alert" aria-live="assertive">
        <p className="eyebrow">Splatno</p>
        <h1>Stránku se nepodařilo načíst</h1>
        <p>Vaše data se nezměnila. Zkontrolujte připojení a zkuste načtení zopakovat.</p>
        <div className="button-row">
          <button type="button" className="btn primary" onClick={reset}>Zkusit znovu</button>
          <a className="btn secondary" href="/dashboard">Zpět na přehled</a>
        </div>
        {error.digest && <small>Kód chyby: {error.digest}</small>}
      </section>
    </main>
  );
}
