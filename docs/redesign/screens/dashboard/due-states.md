# Oddělené karty splatnosti

- „Čeká na splatnost“ nahrazuje souhrn všech otevřených faktur v první kartě.
  Používá active_count − overdue_count; zbývající částky se odečítají po měnách
  v haléřích (open_totals − overdue_totals). Započítány jsou i částečné úhrady.
- „Po splatnosti“ nadále používá pouze overdue_count a overdue_totals.
  Žádná faktura ani částka se tak nepřekrývá mezi oběma kartami.
- Popis první karty upřesňuje dnešní splatnost; odkaz přidává status=pending.
  Názvosloví sjednoceno se stavovým grafem, legendou a datovou tabulkou nástěnky.
- Celkový počet otevřených faktur v pozdravu zůstává celkovým počtem; rozpad
  stavů i filtr období nadále respektují stávající serverový kontrakt.
- Testy pokrývají 18 před splatností / 7 po splatnosti, rozdílné částky,
  více měn a haléře, prázdnou firmu a všech 35 otevřených faktur po splatnosti.
- 49 cílených testů prošlo, stejně jako cílený ESLint a TypeScript.
- 57 prohlížečových scénářů rozložení a společné navigace prošlo. Artefakty:
  `artifacts/dashboard-design/due-states-chromium/`.
