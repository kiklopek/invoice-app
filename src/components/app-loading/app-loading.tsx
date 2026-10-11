// Načítací obrazovka pro skupiny stránek, které se skládají při požadavku
// (přihlášení, onboarding, provoz). Landing ji záměrně nemá: je předgenerovaná
// a obal by do HTML dal nejdřív tuhle obrazovku a vyřadil přednačtení písem.
export function AppLoading() {
  return (
    <main className="app-loading" role="status" aria-live="polite">
      <span className="import-progress-spinner" aria-hidden="true" />
      <span>Načítám aplikaci…</span>
    </main>
  );
}
