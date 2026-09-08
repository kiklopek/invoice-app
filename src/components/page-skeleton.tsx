export function PageSkeleton({ cards = 3, rows = 4 }: { cards?: number; rows?: number }) {
  return (
    <main className="content section-page page-loading" role="status" aria-live="polite" aria-busy="true" aria-label="Načítání stránky">
      <header className="section-header page-loading-header"><div><span/><strong/><i/></div></header>
      <div className="page-loading-cards">{Array.from({ length: cards }, (_, index) => <div className="page-panel" key={index}><span/><strong/><i/></div>)}</div>
      <section className="page-panel page-loading-list">{Array.from({ length: rows }, (_, index) => <div key={index}><span/><i/></div>)}</section>
    </main>
  );
}
