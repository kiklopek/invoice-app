# Matice scénářů a pokrytí

PASS znamená pouze uvedený typ důkazu. PARTIAL znamená neúplnou oblast, BLOCKED závislost na chybějícím prostředí, FAIL reprodukovaný problém. Souhrnný stav vydání je NO-GO.

| Oblast | Povinné scénáře | Stav | Důkaz a mezery |
|---|---|---|---|
| Statické kontroly | Typy, lint, všechny unit testy, integrita migrací, produkční kompilace | Viz aktuální výsledky | `checks.json`, `unit-results.json`, `build.log`; build používá syntetické služby. |
| Peníze a souběh | Alokace, uvolnění, zůstatky, souběžné potvrzení, opakované potvrzení, změna faktury po návrhu | PARTIAL | Skutečné lokální SQL regrese a souběh PASS (`database.log`); HTTP retry po timeoutu a UI návaznosti na stagingu chybí. |
| Nové návrhy | Splátky, kombinace, nejednoznačnost, paměť, invalidace, restart/claim fronty | PARTIAL | Unit a SQL regrese PASS; race potvrzení/worker PASS. Úplný provozní restart služby a pilot na označených reálných datech chybí. |
| Bankovní importy | GPC/CSV, duplicity, nesouvisející řádky, mismatch účtu, úspěch/chyba | PARTIAL | Unit testy a rozložení importu; skutečný autentizovaný průchod uložením a následnou kontrolou faktur chybí. |
| CAMT | Varianty XML, entity, dávky, překryvy, limit souboru | PARTIAL / vypnuto | Syntetické parser/SQL testy; skutečný anonymizovaný export KB a ověření podporovaného profilu chybí. |
| Izolace organizací | Čtení cizí organizace a vlastní čtení před MFA, role, RPC a soubory | PARTIAL / FAIL | Cizí faktura SQL PASS, vlastní před MFA FAIL. Veškeré endpointy/Storage/role přes skutečné tokeny BLOCKED. |
| Přihlášení | Hesla, MFA kód a doručení, expirace, blokace, pozvánka, deaktivace členství | BLOCKED | Pouze veřejný formulář na lokální produkční sestavě. Samotný test přesměrování do MFA nedokazuje dokončení MFA. |
| Zapamatování | Zaškrtnuto/nezaškrtnuto, restart prohlížeče, refresh, API aktivita, 30 dní, logout všech zařízení | BLOCKED | Unit testy nenahrazují životní cyklus skutečných cookies/Auth. |
| UI dashboard/faktury/platby/import | Prázdné a dlouhé položky, velké částky, role, mobilní šířky | PARTIAL | Chromium fixture logy a screenshoty PASS; interaktivní ovládání a autentizace nejsou nahrazeny fixture. |
| Ostatní UI | Detail, archiv, zákazníci, upomínky, reporty, nastavení, klávesnice/dialogy, 200 % zoom | BLOCKED | Bez přihlášeného izolovaného prostředí neověřeno. |
| Faktury a OCR | Vytvoření/editace/storno, duplicity, DPH, špatné soubory, OCR/Storage výpadky | PARTIAL | Existující unit regrese; všechny upload→OCR→oprava→uložení postupy neproběhly. |
| Upomínky | Úhrada/storno, opakovaný cron, ruční souběh, odmítnutý e-mail, opožděný webhook | PARTIAL | Unit důkazy; skutečné oddělené doručování a dvojité spuštění na stagingu chybí. |
| Reporty | Nezávislé částky, období/měny, tisk, export 100 tisíc řádků | FAIL / PARTIAL | Export má limit 20 tisíc. Plné finanční očekávání napříč UI/HTTP/exportem chybí. |
| Výkon | 300k/300k/600k, 50 relací, 20 zápisů, p95 HTTP ≤ 2 s | PARTIAL | Lokální SQL dataset a souběh PASS; p95 SQL 2 587 ms; HTTP cíle nejsou doložené. |
| Provoz a obnova | HTTPS/domény/provider limity, cron, alerty, DB+Storage obnova, rollback | BLOCKED | Skutečná konfigurace, zkouška obnovy a alerty neověřeny. |
| Prohlížeče a zařízení | Chrome, Firefox, WebKit, fyzický iPhone a Android | PARTIAL | Chromium; ostatní neproběhly. Přísný workflow má projekty pro všechny tři enginy. |

Před vydáním rozpadnout každou PARTIAL/BLOCKED oblast na jednotlivé spustitelné scénáře s konkrétní fixture, očekávaným stavem před/po, rolí a důkazem. Tato oblastní matice není tvrzením, že již existují automatizované E2E testy pro každý řádek plánu.
