# Zobrazení finančních částek

## Pravidla

- Souhrnné KPI v reportech, peněžní přehledy nástěnky a součet filtrovaných
  faktur sdílí `SummaryMoney`. Od milionu zobrazují české `mil.`, `mld.` a
  `bil.` s nejvýše třemi desetinnými místy. Přechody mezi jednotkami respektují
  zaokrouhlení; záporné hodnoty zachovávají znaménko a měny se nesčítají.
- Podle posledního upřesnění uživatele zůstává pouze částka v původním designu.
  Žádné další řádky, rozbalovací detaily ani značka přibližnosti.
- Hover, fokus a klepnutí zpřístupní přesnou částku včetně haléřů. Tooltip je
  portál mimo ořezávající souhrnné kontejnery, drží se ve viewportu a zavírá se
  klávesou Escape, odchodem ukazatele/fokusu, kliknutím mimo nebo posunem stránky.
  Dostupný je i plný přístupný popisek. Zaokrouhlení mění pouze prezentaci.
- Faktury, kontrola platby, přiřazení, historie a zákaznická tabulka zůstávají
  přesné. `ExactMoney` v úzkých kontrolních místech chrání číslo a měnu před
  zalomením a dovoluje lokální horizontální posun velmi dlouhé hodnoty.
- Odstraněno zaokrouhlování haléřů na celé koruny v přehledu nástěnky,
  zákaznících, archivu faktur, částce rychlé platby a přehledu upomínek.
- Ve fakturačních cenách předplatného a historii plateb jsou vždy přesné
  částky. Při převodu z haléřů zůstává zachována dosavadní jednotka zdroje.
- Tabulky reportů mají vlastní horizontální posun. Grafové osy používají
  orientační lokalizované popisky; jejich datové tabulky zůstávají přesné.
  Formulářové hodnoty, výpočty, API, exporty a tiskový report se nemění.

## Ověření

- 126 Vitest testů v 8 souborech: formátování, reporty, dashboard, párování,
  předplatné, mobilní kontrakty a tisk.
- `money-display-check.mjs`: 320/390/768/1536px, skutečný komponent ve stylech
  reportů, faktur, dashboardu a párování; nula, haléře, částka těsně pod milionem,
  miliony, záporná hodnota, miliardy i biliony. Jednořádkové částky, žádné
  přetečení stránky, přesný tooltip, hover, klepnutí, fokus a Escape.
- 27 prohlížečových scénářů reportů na osmi šířkách včetně tisku.
- Seznam faktur: 5 rozměrů a 15 funkčních scénářů včetně vysokých součtů,
  filtrace, stránkování, oprávnění, potvrzení platby a exportu.
- Nástěnka: 46 scénářů rozložení a interakcí úspěšných. Starý test společného
  shellu hledal již odstraněnou nabídku účtu; aktualizován na současné tlačítko
  odhlášení a centrování jeho ikony; všech 44 scénářů společného shellu prošlo.
- Cílený ESLint, TypeScript a produkční sestavení Next.js úspěšné.

Artefakty: `docs/redesign/visual-validation/money-display/`, `reports/`,
`invoices/` a `artifacts/dashboard-design/`. Vše ověřeno lokálně na syntetických datech;
žádný push, nasazení ani finanční operace.
