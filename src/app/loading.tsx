export default function Loading() {
  return (
    <main className="app-loading" role="status" aria-live="polite">
      <span className="import-progress-spinner" aria-hidden="true" />
      <span>Načítám aplikaci…</span>
    </main>
  );
}
