# Audit výkonu a bezpečnosti — 12. 10. 2026

Bezpečné optimalizace jsou implementované. Počáteční JavaScript přihlášení a registrace má přibližně o 25 % menší gzip budget. Nastavení už při prvním vykreslení nepotřebuje samostatný požadavek na další bankovní účty. Autentizace, MFA, role, platební pravidla a vlastnictví dat zůstaly zachované.

Audit obsahuje lokální produkční a vývojová měření, kontrolu databázových metadat přes Supabase, regresní testy a návrhy dalších kroků. Neobsahuje tvrzení, že se živá přihlášená aplikace zrychlila o konkrétní počet milisekund: pro takové měření nebyla dostupná bezpečně připravená přihlášená stagingová relace.

Aktualizace před pushem 13. 10. 2026: Next.js a lockfile jsou aktualizované na 16.3.8 kvůli [SSRF v Image Optimization](https://github.com/advisories/GHSA-cjq9-62q9-8jv4); `audit:ci` prochází. Inventář a benchmarky níže zachycují původní audit na 16.3.6. Na přání uživatele se změny kolem Stripe neposílají: oddělení `subscription-data.ts` zůstává pouze lokálně a pushovaný layout dál čte předplatné z původního `billing-server.ts`. Historická měření zahrnovala toto lokální oddělení; přihlášený layout bez něj nebyl benchmarkován.

## Rozsah a skutečná konfigurace

| Položka | Zjištění |
| --- | --- |
| Next.js | Instalováno 16.3.6; App Router, `src/proxy.ts`, žádné Server Actions |
| React / React DOM | Instalováno 19.2.8 |
| Supabase JS / SSR | Instalováno 2.112.1 / 0.12.4 |
| Databáze | Živý projekt, PostgreSQL 17.6, region `eu-west-1` |
| Hosting | `vercel.json` požaduje `dub1`; jde o konfiguraci repozitáře, nikoli nezávislé ověření každého nasazení |
| API | 62 souborů `route.ts`; inventář zahrnuje metody, lokální auth/role/origin kontroly a RPC |
| Build | Webpack; `cacheComponents` není zapnuté; klientská Router Cache má `staleTimes.dynamic = 30` |
| Počáteční data | Dashboard, faktury, detail, reporty, upomínky a nastavení mají Server Component loader a SWR hydrataci |
| Klienti Supabase | Prohlížečový singleton, uživatelský serverový klient s cookies, existující oddělený service klient na serveru |
| Produkční prostředí | Lokálně chybí `EMAIL_MFA_SECRET` a je vyplněné `EMAIL_MFA_BYPASS_EMAILS`; standardní build správně odmítne tuto konfiguraci |

Pro kontrolní produkční build a lokální server byl pouze v podprocesu vytvořen náhodný silný MFA klíč a seznam výjimek nastaven prázdný. Produkční validátor zůstal zapnutý. Žádný `.env` soubor, nasazení, účet ani databázová konfigurace nebyly změněny. Pevná výjimka popsaná níže je samostatné existující pravidlo, které tento environment validátor nekontroluje.

Kompletní statický inventář je v [repository-inventory.json](repository-inventory.json). Statické značky samy o sobě neprokazují správnost každé transitive authorization kontroly; jejich závěry doplňuje čtení společných helperů, loaderů, SQL migrací a regresní sada.

## Naměřené výsledky

[performance-benchmarks.json](performance-benchmarks.json) obsahuje výchozí, průběžná, finální a vývojová měření. Jsou v něm zachované i průběžné méně příznivé výsledky.

### První načtení formulářů v lokálním produkčním buildu

Chromium, desktop 1365 × 900, bez CPU nebo síťového throttlingu, nový browser context pro každý vzorek, deset návštěv na stránku. Velikost JS je součet externích skriptů v počáteční HTML odpovědi; gzip byl spočítán jednotně stejným nástrojem. Tento budget zahrnuje i podmíněné skripty, například nomodule polyfill; nejde o přesné wire bytes konkrétního prohlížeče ani o celkovou velikost všeho JS, které aplikace může stáhnout po dalších interakcích.

| Metrika | Před | Finální stav | Rozdíl |
| --- | ---: | ---: | ---: |
| `/login`: počáteční JS, raw | 900 209 B | 647 206 B | −28,1 % |
| `/login`: počáteční JS, gzip | 271 432 B | 204 344 B | −24,7 % |
| `/register`: počáteční JS, raw | 902 453 B | 649 402 B | −28,0 % |
| `/register`: počáteční JS, gzip | 272 423 B | 205 344 B | −24,6 % |
| Skripty v počáteční HTML, obě stránky | 17 | 15 | −2 |
| `/login`: LCP p50 / p95 | 236 / 296 ms | 180 / 236 ms | Syntetické měření |
| `/register`: LCP p50 / p95 | 268 / 320 ms | 192 / 204 ms | Syntetické měření |
| `/login`: měřená interakce p50 / p95 | 32 / 40 ms | 16 / 16 ms | Vyplnění pole a přepnutí viditelnosti hesla |
| `/register`: měřená interakce p50 / p95 | 40 / 48 ms | 16 / 24 ms | Stejný scénář |
| CLS, obě stránky | 0 | 0 | Beze změny |

Měřená interakce je omezený INP proxy, nikoli field INP za celý život stránky. U deseti vzorků jsou p95 a p99 prakticky maximem vzorku. Průběžný běh měl na přihlášení LCP p50 236 ms a p95 424 ms; variabilitu nelze vydávat za garantované produkční zrychlení. Spolehlivým výsledkem je menší počáteční bundle. SDK se začne načítat při zaměření formuláře, takže celkový počet JS požadavků po interakci může být vyšší, zatímco první přenos je menší.

### HTTP: produkční režim, anonymní přístup

30 zahřátých požadavků na routu, tělo odpovědi vždy dočtené. `/settings` představuje přesměrování na přihlášení a chráněná API vracejí 401. Tyto hodnoty **nejsou** časy načtení firemních dat přihlášeného uživatele.

| Routa | Stav | Před p50 / p95 / p99 | Po p50 / p95 / p99 |
| --- | ---: | ---: | ---: |
| `/login` | 200 | 8,80 / 15,53 / 21,18 ms | 9,26 / 16,10 / 22,69 ms |
| `/register` | 200 | 7,91 / 9,99 / 10,02 ms | 8,15 / 10,08 / 10,20 ms |
| `/settings` | 307 | 1,94 / 2,82 / 3,74 ms | 2,08 / 2,77 / 3,70 ms |
| `/api/settings/page-data` | 401 | 2,60 / 4,78 / 5,26 ms | 2,70 / 4,70 / 6,36 ms |
| `/api/settings/bank-accounts` | 401 | 2,49 / 2,75 / 3,55 ms | 2,56 / 2,94 / 4,33 ms |

TTFB přihlášení p50 byl 7,71 → 8,23 ms. Při souběhu osmi klientů, 40 vzorcích: přihlášení p50/p95 48,87/63,77 → 52,70/65,77 ms; odmítnuté settings API 8,98/15,33 → 9,67/17,08 ms. Anonymní serverová obsluha se měřitelně nezrychlila; drobné rozdíly zahrnují novou instrumentaci a běžnou variabilitu. Nejde o důkaz produkční kapacity autentizovaných dotazů ani cold starts Vercelu.

### Vývojový režim a SQL

Existující vývojový server na portu 3000 zůstal běžet. Zahřátý `/login` měl p50/p95 71,00/87,49 ms; registrace 75,16/90,02 ms; odmítnuté settings API 16,76/34,71 ms. První návštěva registrace zabrala 3 615 ms, první přístup na settings API 1 673 ms. Tyto první časy zahrnují stav kompilace a nejde o produkční cold starts.

Z dodaného logu připadá 7 000 z 8 300 ms na Next.js ve vývojovém režimu; samotná application-code část byla 1 275 ms, další zahřátý požadavek 883 ms. Nelze z toho odvodit pomalý PostgreSQL dotaz.

Povolený živý `EXPLAIN (ANALYZE, BUFFERS)` nad projekcí konstanty `1`, tenantovým filtrem a stejným řazením auditních událostí naměřil execution 0,289 ms a planning 1,811 ms. Výstup neobsahoval auditní záznamy ani e-maily. Dotaz běžel pod administrativním připojením konektoru, **neměřil RLS ani přenos skutečného payloadu**, a je pouze jeden vzorek.

## Bottlenecky a pořadí změn

| Priorita | Doložený problém | Řešení / stav | Riziko |
| --- | --- | --- | --- |
| P0 | Koncept firemních údajů měl společný sessionStorage klíč a kontroloval jen revision | Klíč nyní zahrnuje organizaci a uživatele; starý nescopeovaný koncept se neobnovuje; logout čistí pouze aplikační koncepty | Nízké; starý koncept nelze bezpečně přiřadit k účtu |
| P0 | Pozdní odpověď profilu mohla po logoutu obnovit starou cache | Generace cache odmítá staré odpovědi; úspěšný logout ji resetuje | Nízké |
| P0 | Přesměrování proxy kopírovalo cookies, ale vynechávalo cache hlavičky refresh odpovědi | Přenášejí se `cache-control`, `expires`, `pragma`; chráněné odpovědi jsou `private, no-store` | Nízké; nemění se auth rozhodnutí |
| P0 | Neočekávaná chyba logovala raw URL a error.message | Log používá šablonu routy, bezpečný typ chyby a digest; neobsahuje query ani volný chybový text | Nízké; méně podrobného textu, zachovaný digest |
| P1 | Auth SDK bylo součástí počátečního JS login/register | Dynamický import a přednačtení na focus formuláře | Naměřený přínos výše; submit SDK stále použije |
| P1 | BankAccountsSection při mountu posílala další chráněný API request | Účty jsou vložené přes existující relaci do company query; komponenta hydratuje serverový seznam | Test potvrzuje nula mount fetchů i pro prázdný seznam |
| P1 | Layout při identitě bez firmy znovu prováděl celé ověření session | Sdílené React `cache` pro session a odvozenou identitu v rámci Server Component requestu | Request-scoped; Route Handlery nejsou sdíleně cacheované |
| P2 | Pouhé ověření MFA importovalo SDK pro odesílání e-mailu | Resend se importuje až při odeslání kódu | E-mailový obsah, idempotence a pravidla beze změny |
| P2 | Čtení předplatného v layoutu importovalo platební SDK | Oddělený `subscription-data.ts` připravený pouze lokálně; vynecháno z pushe na přání uživatele | Push zachovává původní import a platební chování |
| P2 | Chybělo rozlišení claims / Auth server / membership / DB | Request-local `Server-Timing`, explicitní `no-store` Supabase transport | Žádné tokeny, URL, query ani payloady v měření |

Předchozí redesign nastavení zůstal zachovaný. Dvě textové regresní kontroly byly upravené na nový, přísnější formulářový guard. Původní testy proxy jsou zachované; nové kontroly cache jsou v samostatném souboru.

## Autentizace, cache a izolace

- Proxy dál používá ověřené `getClaims()`, obnovuje obě strany cookies a kontroluje podepsanou relaci prohlížeče a MFA. Matcher neběží na statických assetech ani obecně na všech API.
- Serverové `getClaims()` a `getUser()` zůstaly. `sub` musí odpovídat aktuálně načtenému uživateli; session_id musí existovat. Odebrání čerstvé Auth-server kontroly by změnilo dosavadní bezpečnostní sémantiku. [Oficiální rozlišení auth metod](https://supabase.com/docs/reference/javascript/auth-getclaims), [getUser](https://supabase.com/docs/reference/javascript/auth-getuser).
- `getSession()` v recovery callbacku slouží po úspěšném `verifyOtp()` jen k získání právě vydaného access tokenu; server neautorizuje podle neověřeného embedded user objektu.
- Role pochází z membership tabulky, nikoli uživatelsky upravitelného user_metadata. Převzetí pozvánek zůstalo ve svých původních bootstrap/callback tocích; normální request nadále vyžaduje session a MFA před zápisem.
- React cache nesdílí identitu mezi requesty. SWR provider se obnoví při změně organizace, uživatele **nebo role**. Mutace zachovávají existující invalidaci SWR a Router Cache. Odhlášení resetuje profil a koncepty.
- ARES cache obsahuje veřejná registry data s TTL a omezením velikosti. Existující cache Stripe cen obsahuje cenu veřejného plánu. Privátní Supabase requesty jsou explicitně `no-store`; žádná tenantová data nebyla vložena do globálního serverového či CDN cache.
- Stávající service klient nebyl nově zaveden jako optimalizace. Řada serverových loaderů jej již používá po ověření membership; toto zůstává důvodem vyžadovat tenantový filtr a kontrolu actor_user v každé privilegované operaci. Široký přepis na uživatelský klient nebyl proveden bez ověření kompatibility grantů a RPC.

## Bezpečnostní nálezy, které potřebují navazující rozhodnutí

1. **Vysoká priorita: pevná MFA výjimka.** `isEmailMfaBypassed()` v `src/lib/email-mfa-core.ts` uznává konkrétní testovací účet i v production. Prázdné `EMAIL_MFA_BYPASS_EMAILS` tuto výjimku nevypíná. Doporučení: zakázat ji v produkci nebo odstranit po schválení změny přihlašovacích pravidel, ověřit `/login → /mfa → workspace` a trusted-device scénáře. Výjimka nebyla rozšířena ani využita pro benchmark.
2. **Vysoká priorita, lokální důkaz a neověřená živá definice:** poslední lokální tenant-isolation migrace předefinuje `private.is_org_member` a `private.has_org_role` bez predikátu expirace support členství. Aplikační helper expiraci kontroluje a support ukončuje, ale databázový helper musí nezávisle odmítnout prošlý support při přímém REST přístupu. Živý obsah těchto funkcí nebylo dovoleno načíst; nález je potřeba potvrdit před opravou migrací.
   Stejné ověření musí zahrnovat přímý REST přístup před dokončením aplikačního e-mailového MFA: místní SQL helpery kontrolují membership, nikoli druhý faktor, zatímco aplikace používá vlastní MFA cookie. Cookie se do databázové RLS kontroly automaticky nepřenáší. To je doložený rozdíl vrstev v lokálním zdroji; účinné živé pravidlo a stagingový scénář s před-MFA tokenem zůstávají k ověření, nikoli potvrzenou exploatací produkce.
3. **Onboarding / login correctness:** `/api/auth/access` umí vrátit `needsOnboarding` pro ověřený účet bez firmy, zatímco `/api/auth/session-preference` vyžaduje `getRequestIdentity` včetně členství. Password login tak může zakladatele odmítnout, přestože access endpoint povolil onboarding. Doporučenou změnu na samotnou ověřenou session je potřeba samostatně schválit a integračně otestovat; nebyla potichu změněna.
4. **Živý advisor:** leaked-password protection je vypnutá. Zapnout v Supabase po kontrole plánu a auth testech; nejde o změnu implementovanou do produkční konfigurace. [Dokumentace](https://supabase.com/docs/guides/auth/password-security#password-strength-and-leaked-password-protection).
5. **Živý advisor:** `private.assistance_normalize_account` má mutable search_path. Doporučení zafixovat search_path v nové kontrolované migraci se schema-qualified referencemi. [Remediation](https://supabase.com/docs/guides/database/database-linter?lint=0011_function_search_path_mutable).
6. Obecné starší `structured-log.ts` stále přijímá volný text chyb; jeho širší review/redakce je další krok. Nová timing instrumentace žádné takové hodnoty nezapisuje a raw request logging byl opravený.

Živá metadata: všech 40 public tabulek má RLS; klientské přímé zápisy jsou odebrané; externě spustitelné SECURITY DEFINER helpery jsou pouze v private schématu, authenticated, nikoli anon. OCR view má `security_invoker=true` a odebrané klientské SELECT granty. Storage nemá klientské policies; aplikace používá autorizované signed upload/download URL, proto se žádné veřejné policies nepřidávaly. Žádný nový SECURITY DEFINER ani grant nevznikl.

Advisor hlásí 19 tabulek s RLS bez policies; jde převážně o serverové tabulky s odebranými klientskými právy, nikoli automaticky o únik dat. [Význam notice](https://supabase.com/docs/guides/database/database-linter?lint=0008_rls_enabled_no_policy), [RLS a grants](https://supabase.com/docs/guides/database/postgres/row-level-security).

## Databáze a indexy

Horké settings dotazy už měly vhodné indexy: PK organizations, unique `(organization_id, email)` a user_id index pro členství, `(organization_id, created_at DESC, id DESC)` pro audit a `(organization_id, started_at DESC)` pro support. Nezávislé settings dotazy už běžely v Promise.all; tato část se nepřepisovala do nové RPC.

Advisor uvádí 16 neindexovaných FK a 34 dosud nepoužitých indexů. Nepoužité indexy se nesmazaly: krátké období statistik ani malá databáze nedokazují, že nejsou potřebné. Malý sequential scan je často správný plán.

Po získání skutečných statistik a při růstu dat má smysl posoudit zejména `invoices.customer_id` pro customer joiny a případně `(organization_members.user_id, email, created_at)` pro identity lookup. Ostatní neindexované FK jsou často auditní `created_by`, `updated_by`, `invited_by`, `ended_by`; jejich priorita závisí na delete/update provozu. Nejprve EXPLAIN na reprezentativních datech a četnost dotazů, až potom kontrolovaná migrace. Žádná indexová ani infrastrukturní změna nebyla provedena. [FK advisor](https://supabase.com/docs/guides/database/database-linter?lint=0001_unindexed_foreign_keys), [unused index advisor](https://supabase.com/docs/guides/database/database-linter?lint=0005_unused_index).

Další rezervy: reminders loader má deset nezávislých databázových requestů; detail faktury načítá až 1 000 členů kvůli autorům událostí; import faktur stále obsahuje velký OCR/form/preview graph. Po měření lze snížit overfetching nebo rozdělit UI po akcích. Globální CSS má přibližně 82 KB + 235 KB zdrojového textu, proto stojí za další route-level CSS audit; nebylo plošně promazáváno s rizikem rozbití designu. Část těchto toků je již stránkovaná a velké Excel/PDF/OCR závislosti už mají vlastní odložené načítání.

## Ověření a monitoring

- Konečný JSON výsledek: 1 437 průchodů, 0 failures, 0 pending; 179 testovacích souborů. Původní auth, role, IDOR, tenant, payments a mutation testy zůstaly.
- Nové testy: odmítnuté claims, mismatch user/sub, zrušený Auth user, MFA/login gate, role z membership, oddělení dvou uživatelů, souběžná timing izolace, nulový bank-account mount fetch, role omezení loaderu, draft scope, logout race, refresh cookies a log privacy.
- ESLint prošel pro projekt i následně pro změněné `src`, `scripts`, konfiguraci. Produkční build finálního zdroje prošel v dočasné bezpečné konfiguraci. Samostatné typecheck ověření používá `--incremental false`, aby nevycházelo ze starých `.next/dev` záznamů po build režimu.
- Kontrola 145 klientských JS souborů neodhalila skutečné hodnoty service-role, Resend, webhook, cron nebo OpenAI tajných klíčů z lokálního prostředí.
- Nepřihlášené settings stránka/API zachovaly 307/401; cache hlavičky jsou privátní. Živé integrační ověření dvou stagingových tenantů, token refresh, MFA a přihlášené SQL latency vyžaduje bezpečně připravené relace. Mock testy se za takové měření nevydávají.

[scripts/benchmark-performance.mjs](../../../scripts/benchmark-performance.mjs) nabízí opakovatelné p50/p95/p99, TTFB, souběh a agregaci Server-Timing. Přijímá volitelný lokální Playwright storage state, respektuje domain/path/secure/expiry cookies a žádné credential hodnoty ani response body neukládá. HTTPS secure cookie neposílá přes HTTP. Pro chráněná měření použít staging s reálným MFA, nikoli bypass.

Pro monitoring sledovat zvlášť `claims`, `auth_user`, `membership`, `auth_http`, `data`, `db` a `proxy`. `db` je součet dob síťových DB requestů a může kvůli souběhu přesáhnout wall time `data`; není to PostgreSQL execution time. Přidat RUM pro LCP/INP/CLS po typech rout, anonymizované trace correlation a alerty pro 401/403/5xx, rate-limit odmítnutí a refresh chyby. Nezahrnovat URL query, tokeny, cookies, e-maily ani názvy firem do atributů. Sledovat reálnou kapacitu s přihlášenými stagingovými účty, neodvozovat ji z tohoto anonymous loopback benchmarku.

## Záměrně zachované hranice

Nebyly odstraněné aktuální Auth-server kontroly, vypnuté MFA, oslabené rate limits, změněné platby, role nebo datové vlastnictví. Nebyly instalované nové knihovny, změněné regiony, vytvořené produkční indexy nebo provedené migrace. Předchozí SWR/Router Cache a serverové loadery se zachovaly, kde již řešily výkon správně.

Automatická kontrola konektoru odmítla export živých definic private SQL funkcí a interních statement statistik. Audit jejich chování proto používá místní migrace a označuje neověřený živý stav. Připravené přesné read-only dotazy pro případné schválení jsou v [read-only-database-checks.sql](read-only-database-checks.sql); nyní nebyly provedené.

Použitá dokumentace: lokální guides z instalovaného Next.js 16.3.6 pro CSS, Server/Client Components, caching bez Cache Components, production a instrumentation; [Supabase SSR a cookie propagation](https://supabase.com/docs/guides/auth/server-side/creating-a-client?queryGroups=framework&framework=nextjs), [Next.js lazy loading](https://nextjs.org/docs/app/guides/lazy-loading), [Supabase changelog](https://supabase.com/changelog). Živý Postgres 17.6 také doporučuji zkontrolovat proti aktuálním bezpečnostním minor releases před plánovaným upgradem; infrastruktura se automaticky neupgradovala.
