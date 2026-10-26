# Načítání PDF reportů — 26. 10. 2026

Potvrzená příčina: databáze `liczsygjiuaobdzytyea` nemá funkci `public.financial_report_snapshot`, kterou volá `/api/reports/pdf`. Shoda projektu s prostředím aplikace byla ověřena podle hostitele Supabase URL. Metadata funkcí a seznam migrací byly přečteny bez načítání klientských finančních údajů.

Připravená migrace: `supabase/migrations/20261026101041_financial_report_snapshot.sql`. Přidává čtecí snapshot, nastavuje tři existující čtecí funkce jako STABLE a omezuje volání nové funkce na service_role. Nemaže ani nepřepisuje faktury nebo platby. Vyžaduje přesto nasazení databázových definic a oprávnění.

První pokus o nasazení odmítla automatická kontrola schválení. Po výslovném souhlasu uživatele „nasad ji“ byla migrace úspěšně nasazena do připojeného projektu. Místní soubor byl přejmenován podle skutečné databázové verze `20261026101041`, aby odpovídal migrační historii.

Dokončené nezávislé změny:

- Export i Ctrl/Cmd+P automaticky připravují náhled se současnými filtry. Opětovné otevření nezměněného náhledu používá existující PDF.
- Generování přebírá konkrétní kopii filtrů a voleb; nečeká na asynchronní nastavení stavu Reactu, takže se nepošlou předchozí filtry.
- Změna obsahu nadále označí PDF jako neaktuální a vyžaduje jeho obnovení.
- Chybějící databázová funkce vrací srozumitelnou chybu 503 místo obecné chyby načítání. Server zapisuje technický kód chyby do svého logu.
- Přidána API regrese pro PGRST202 a aktualizován prohlížečový test automatického prvního načtení, zachování filtrů a opakování po chybě.

Ověření: 30 testů ve třech souborech (`route.test.ts`, `financial-report.test.ts`, `report-print.test.ts`) prošlo. Lokální databázový replay a sady financial_report, invoice_creation, dashboard_snapshot prošly. Cílený ESLint a typecheck prošly. Chromium i WebKit ověřily šířky 320/390/768/1024/1440 a kompletní PDF životní cyklus při 390 i 1440 px nad syntetickými odpověďmi. Tyto browser testy nepotvrzují funkčnost dosud nenainstalované funkce v živé databázi.

Nasazena pouze uvedená migrace; ostatní čekající migrace se nespouštěly. Živá kontrola potvrdila oprávnění service_role a zákaz přímého volání pro authenticated/anon. SQL snapshot načetl 47 faktur, všechny odpovídající importy a metadata firmy; počty detailů souhlasily se souhrny.

Navazující read-only kontrola přes skutečné Supabase RPC API a aktuální PDF renderer vytvořila v paměti platné PDF: 47 faktur, 19 stran, 99 985 bytů. Finanční údaje nebyly vypsány ani uloženy do ukázkových souborů. Fyzický tisk nebyl součástí tohoto ověření.

Bezpečnostní advisors po nasazení nehlásí problém nové funkce. Hlásí nesouvisející nastavení existující funkce [assistance_normalize_account](https://supabase.com/docs/guides/database/database-linter?lint=0011_function_search_path_mutable), vypnutou [kontrolu uniklých hesel](https://supabase.com/docs/guides/auth/password-security#password-strength-and-leaked-password-protection) a informační přehled RLS tabulek bez klientských politik; tato nastavení nebyla v rámci opravy měněna.
