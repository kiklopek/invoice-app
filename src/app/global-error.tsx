"use client";

import { useEffect } from "react";

export default function GlobalError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    console.error("Global application error", { message: error.message, digest: error.digest });
  }, [error]);

  return (
    <html lang="cs">
      <body>
        <main className="app-error-page">
          <section className="app-error-card" role="alert" aria-live="assertive">
            <h1>Aplikace je dočasně nedostupná</h1>
            <p>Vaše poslední operace nemusela být dokončena. Před opakováním nejprve zkontrolujte aktuální stav.</p>
            <button type="button" onClick={reset}>Zkusit znovu</button>
            {error.digest && <small>Kód chyby: {error.digest}</small>}
          </section>
        </main>
      </body>
    </html>
  );
}
