# Provozní příručka Splatno

Tento dokument doplňuje technické nastavení v `README.md`. Žádný z níže uvedených nouzových postupů nesmí vypnout autentizaci ani rozšířit pevnou MFA výjimku pro potvrzený účet `test-admin@hlavica.cz`.

## Povinná produkční konfigurace

Před každým nasazením spusťte `pnpm validate:env`. Produkční sestavení se samo zastaví, pokud:

- chybí některý povinný klíč,
- `EMAIL_MFA_SECRET`, `CRON_SECRET` nebo webhook secret není dostatečně dlouhý,
- `APP_BASE_URL` nepoužívá HTTPS,
- `AUTH_EMAIL_DELIVERY_ENABLED` není nastavené na `true`,
- `EMAIL_MFA_BYPASS_EMAILS` obsahuje libovolnou hodnotu.

`EMAIL_MFA_SECRET` musí být náhodný tajný řetězec s alespoň 32 znaky a musí být stejný ve všech produkčních instancích. Po jeho změně přestanou platit existující podepsané preference „Zapamatovat si mě“.

## Výpadek Resendu nebo doručování přihlašovacích kódů

1. Ověřte stav Resendu, domény a poslední události webhooku. Pro `AUTH_EMAIL_FROM=Splatno <prihlaseni@mail.splatno.cz>` musí být doména `mail.splatno.cz` v Resendu ve stavu `verified` a veřejné DNS musí obsahovat Resendem předepsané SPF/MX a DKIM záznamy.
2. Nechte aktivní uživatelské relace doběhnout; uživatele zbytečně globálně neodhlašujte.
3. Pozastavte automatické upomínky v nastavení, pokud nelze garantovat jejich doručení.
4. Obnovte API klíč nebo DNS/SMTP konfiguraci a proveďte testovací odeslání na interní adresu.
5. Ověřte nový přihlašovací kód a doručení webhooku před obnovením automatických upomínek.

Legacy proměnnou `EMAIL_MFA_BYPASS_EMAILS` nikdy nevyplňujte. Nouzový přístup se řeší opravou doručování nebo návratem na poslední funkční deployment, ne přidáváním dalších výjimek z druhého kroku přihlášení.

## Monitoring a upozornění

Ve Vercel Observability nastavte upozornění alespoň na:

- nárůst odpovědí 5xx,
- selhání `/api/cron/check-due`,
- výrazný nárůst latence API,
- opakované chyby Resend webhooku.

Aplikační chyby jsou strukturované a nesou `request_id`. Při incidentu vyhledejte stejné ID v odpovědi API a runtime logu. Logy nesmí obsahovat hesla, kódy MFA, session tokeny ani celé tajné klíče.

## Zálohy a obnova

- Denně ověřte, že Supabase záloha doběhla podle zvoleného tarifu.
- Alespoň jednou měsíčně obnovte poslední zálohu do odděleného neprodukčního projektu.
- Po obnově ověřte počty organizací, faktur, plateb, upomínek a dokumentů a proveďte test přihlášení testovacího uživatele.
- Výsledek, čas obnovy a případné odchylky zapište do provozního protokolu.
- Obnovu nikdy netestujte přepsáním produkční databáze.

## Databáze a migrace

1. Existující migrační soubory neupravujte; každá změna dostane novou migraci.
2. Spusťte `pnpm check:migrations`.
3. Migraci nejprve aplikujte na Supabase Preview nebo staging.
4. Spusťte Security a Performance Advisors a integrační testy rolí `viewer`, `accounting` a `admin`, včetně přístupu do cizí organizace.
5. Teprve potom nasaďte produkci mimo pracovní špičku a 24 hodin sledujte Auth, API, cron, Resend a databázovou latenci.

Interní tabulky s RLS bez klientských politik jsou záměrně nepřístupné rolím `anon` a `authenticated`. Advisor proto může u těchto tabulek zobrazit informativní hlášení; přístup navíc blokuje explicitní `REVOKE`.

## CI a staging E2E

GitHub Actions při každém pushi do `main` a pull requestu spouští frozen instalaci, lint, typecheck, unit testy, kontrolu migrací, audit, produkční build a Playwright.

Ve stagingu nastavte repozitářová tajemství `E2E_EMAIL` a `E2E_PASSWORD` pouze pro vyhrazený testovací účet. Tento účet nesmí být členem produkční organizace ani používat produkční data.

## Reakce na regresi

1. Poznamenejte `request_id`, čas, trasu a uživatelskou roli.
2. Zkontrolujte Vercel runtime log, GitHub checks, Supabase Auth/Database logy a Resend události.
3. Pokud problém začal posledním deploymentem, vraťte provoz na předchozí ověřený Vercel deployment.
4. Databázovou migraci nevracejte ručně bez samostatného ověřeného opravného migračního skriptu.
5. Po opravě zopakujte dotčený E2E scénář a sledujte provoz alespoň 24 hodin.
