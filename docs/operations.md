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

### Ruční záloha (povinná, dokud je projekt na Supabase Free)

Tarif Supabase Free nedělá žádné zálohy. Ani placené zálohy Supabase navíc
neobsahují soubory ve Storage (PDF faktur, výpisy, loga). Do přechodu na Pro
a zavedení automatické zálohy bucketů proto spouštějte jednou týdně:

```shell
SUPABASE_DB_URL="postgresql://postgres.<ref>:<heslo-databaze>@<host>:5432/postgres" \
NEXT_PUBLIC_SUPABASE_URL=https://<ref>.supabase.co \
SUPABASE_SERVICE_ROLE_KEY=... \
node scripts/backup-production.mjs
```

- Připojovací řetězec je v Supabase → Project Settings → Database → Connection string
  (Session pooler). Heslo databáze není v aplikaci, zná ho vlastník projektu.
- Potřebuje `pg_dump` verze 17 a vyšší (stejná hlavní verze jako server). Na Windows
  ho nainstalujete s PostgreSQL 17 (jen „Command Line Tools“).
- Výsledek je ve složce `backups/<čas>/`: `database.dump`, `storage/<bucket>/…`
  a `manifest.json` s počty řádků klíčových tabulek a SHA-256 každého souboru.
  Skript skončí chybou, pokud záloha není úplná.
- Složka obsahuje osobní a finanční data zákazníků. Zašifrujte ji (např. 7-Zip s AES-256)
  a uložte mimo Supabase. Do gitu nepatří (`backups/` je v `.gitignore`).

**Ověření obnovy** (nikdy ne do produkce):

```shell
createdb splatno_restore_test
pg_restore --no-owner --no-privileges --dbname=splatno_restore_test backups/<čas>/database.dump
psql splatno_restore_test -c "select count(*) from public.invoices;"
```

Do obyčejného Postgresu pg_restore nahlásí chyby u objektů, které závisí na
rozšířeních a rolích Supabase (schémata `auth`, `storage`, `extensions`). Data
tabulek v `public` se obnoví i tak. Úplnou zkoušku dělejte do nového dočasného
Supabase projektu. Počet musí sedět s `tableCounts.invoices` v `manifest.json`. Výsledek, datum a čas
obnovy zapište do provozního protokolu.

### Pravidelný provoz

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
