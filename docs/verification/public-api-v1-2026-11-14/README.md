# Ověření veřejného API v1

Datum: 14. 11. 2026. Větev `feature/public-api-v1`, založená na GitHub `main` `15ca0c1`.

## Uživatelský průchod

Administrátor vytvoří omezený integrační klíč v nastavení. Server e-shopu vystaví fakturu přes `/api/v1`, bezpečně opakuje požadavek, získá PDF a čte úhrady a události své firmy. Odeslání a počáteční úhrada vyžadují samostatná oprávnění a výslovné potvrzení.

## Výsledky

| Kontrola | Výsledek a rozsah |
|---|---|
| Unit a regresní testy | 266 souborů, 2 312 testů, vše prošlo. `corepack pnpm exec vitest run src --maxWorkers=1`. |
| Poslední smlouva API | Dalších 30 cílených kontrol vstupů, odpovědí a OpenAPI prošlo po finálním zpřesnění typů a schématu plateb. |
| Typy | `corepack pnpm typecheck` prošlo v odděleném čistém checkoutu výsledné větve. |
| Lint | `corepack pnpm lint` prošlo, včetně responzivního ratchetu; počet existujících odchylek zůstal 168. |
| Migrace | `corepack pnpm check:migrations`: 69 validních souborů, z toho tři nové API migrace. |
| Sestavení | Produkční webpack build prošel s HTTPS `APP_BASE_URL`. |
| PGlite | Všechny tři nové spouštěcí skripty prošly; zahrnují čtyři SQL sady pro klíče, zákazníky, upomínky a rozdělení plateb. |
| Skutečný PostgreSQL | Všech 69 migrací přehráno bez změn, všechny čtyři API SQL sady prošly na PostgreSQL 17.6. |
| Skutečný souběh | Dvě různá PostgreSQL spojení přidělila dvě odlišná čísla faktury. Dvě souběžná založení stejného zákazníka vytvořila jeden kontakt a jeden záznam operace; druhý výsledek byl replay. |
| Dokumentace v prohlížeči | Chromium i WebKit, šířky 1440, 768, 390 a 320 px: HTTP 200, načtené styly, bez zachycené JS výjimky a horizontálního přetečení dokumentu. |
| HTTP hranice API | Sedm anonymních požadavků na hlavní kolekce vrací 401 s `invalid_api_key`, diagnostickým ID a `private, no-store`. OpenAPI vrací veřejně JSON 3.1. |
| Správa klíčů | DOM testy ověřují oprávnění, výběr scope, jednorázové zobrazení klíče, potvrzení zrušení a obnovu po chybě načtení. |

Databázové sady ověřují i zrušené/prošlé klíče, odebranou roli autora, limit požadavků, izolaci firem, skutečné granty `service_role`, zákaz změny auditních záznamů, změněný obsah idempotentní operace, změny kontaktu po replay, pozastavení rozpracované upomínky a přímé i rozdělené úhrady. Výpočty cen s DPH a jejich prezentace v PDF mají samostatné regrese.

## Důkazy a praktické hranice

- [Skutečný PostgreSQL a souběh](real-postgres.json). Testovací databáze používala syntetická schémata Auth/Storage, oprávnění odpovídající výchozím grantům Supabase a skutečné `pg_cron`. Kontejner neměl síť, porty ani sdílené svazky a po testu byl odstraněn.
- [Prohlížeč a HTTP odpovědi](browser.json). Lokální produkční sestavení bylo kontrolováno přes dočasné HTTPS proxy. Prohlížeče důvěřovaly jen lokálnímu testovacímu certifikátu; CSP aplikace se nevypínala. Čisté HTTP ve WebKitu správně nestačilo kvůli `upgrade-insecure-requests`.
- [Desktop Chromium](chromium-1440.png), [mobilní WebKit](webkit-390.png).
- SQL sady se nově spouštějí v GitHub workflow `Public API database contracts`. Ten používá připnutý PGlite v dočasném adresáři, bez produkčních přístupů.

Produkční schéma nebylo změněno, nebyla odeslána skutečná faktura ani provedena platba. Neproběhl nový kompletní autentizovaný browser → živý Supabase → poskytovatel e-mailu průchod a nebyl upraven repozitář e-shopu. Browser ověřuje dokumentaci a anonymní hranice; oprávněné mutace ověřují runtime route testy a samostatné reálné SQL transakce. Tyto úrovně důkazu se nesměšují.

Před ostrým spuštěním nasadit a ověřit tři nové migrace na stagingu s aktuálním schématem, provést pilot s testovací firmou a porovnat cílovou migrační historii. Aktuální GitHub main již obsahuje F0–F5; dříve načtená produkce měla ještě dvě další verze (`rank_invoice_candidates`, `fix_normalize_vs`), jejichž soubory na main chybějí. Podrobnosti rozhraní a nasazení jsou v [API dokumentaci](../../api-v1.md).

Původní uživatelský checkout se zachovanými rozpracovanými změnami zůstává ve větvi `feature/public-api-v1-local`. Výsledná větev navazující na aktuální main byla ověřena v `/tmp/splatno-api-current`.
