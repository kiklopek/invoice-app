# Splatno pro více firem: jak to funguje a co nastavit

Tento dokument popisuje provoz větve, která otevírá Splatno pro všechny firmy.
R. Hlavica přitom dál používá vlastní vstup `splatno.cz/hlavica`.

## 1. Procesy v kostce

| Scénář | Kroky |
|---|---|
| **Založení firmy** | `/register` (Založit firemní účet) → potvrzovací e-mail → `/auth/callback` → `/mfa` (kód z e-mailu) → `/onboarding` (IČO z ARES, kontakt, bankovní účet, tým, shrnutí) → firma vznikne naráz → `/dashboard` |
| **Pozvání do firmy** | Admin: Nastavení → Tým → e-mail a role → potvrzení → e-mail s odkazem `splatno.cz/pozvanka/<token>` (platí 7 dní, jen jednou) |
| **Přijetí pozvánky** | Odkaz → jméno a heslo (e-mail je daný pozvánkou) → člen firmy s rolí z pozvánky → `/dashboard`. Odkaz se počítá jako 2FA pro tuto první relaci. |
| **Běžné přihlášení** | `/login` (obecný vzhled) nebo `/hlavica` (s logem R. Hlavica) → heslo → kód z e-mailu → aplikace |
| **R. Hlavica** | vlastní vstup jako dosud: `/hlavica` a `/hlavica/registrace` (jen pozvaný @hlavica.cz). Přidání člověka v Nastavení → Tým e-mail neposílá, pozvánka e-mailem jen tlačítkem. 2FA i zapomenuté heslo z tohoto vstupu mají jejich logo (`?vstup=hlavica`). |

Obecný vstup (`/login`, `/register`, zapomenuté heslo) s R. Hlavica nijak
nesouvisí. Nemá jejich logo ani odkazy. Obecná registrace e-mail @hlavica.cz
nepřijme a odkáže na `/hlavica/registrace`. Přihlásit se přes `/login` může
každý, včetně lidí z R. Hlavica. Do dat se ale dostane jen do své firmy.

O přesměrování rozhoduje jediná funkce, `src/lib/access-state.ts` (tabulka
stavů × stránek). Používají ji proxy, layout aplikace i onboarding.

**Pravidla, která hlídá databáze**

- jeden účet patří nejvýš do jedné firmy,
- firmu zakládá zakladatel jen jednou a vzniká naráz,
- stejné IČO nemůže založit nikdo jiný,
- doménu e-mailu hlídá firma (R. Hlavica: `hlavica.cz`),
- pozvánka platí jen pro pozvaný e-mail, jen jednou a jen do vypršení.

Test těchto pravidel je v `supabase/tests/organization_onboarding.sql`.
Lokálně se spouští příkazem `node scripts/test-organization-onboarding-db.mjs`.

## 2. Databáze (migrace)

Nové migrace:

- `20261007124800_organization_onboarding.sql` (v produkci od 7. 10.)
- `20261007125359_billing_and_verification.sql` (v produkci od 7. 10.)
- `20261007125410_company_logos.sql` (v produkci od 7. 10.)
- `20261007130000_auth_rate_limit_actions.sql` (**zatím ne**: nástroj Supabase
  MCP u ní opakovaně vypršel; pustit ji v SQL editoru Supabase a pak soubor
  přejmenovat podle zapsané verze)

Další změny databáze pouštět jen po schválení. Běží tam živá data R. Hlavica.

Co migrace udělají se stávající firmou:

- R. Hlavica dostane `allowed_email_domain = 'hlavica.cz'`, svoje logo a
  `onboarding_completed_at`. Pro ni se nic nezmění.
- Pevný constraint `@hlavica.cz` na členech zmizí. Jeho roli převezme doména
  nastavená u firmy.

Po `apply_migration` přes Supabase MCP je potřeba **přejmenovat lokální
soubory podle skutečně zapsané verze**. Postup popisuje CLAUDE.md.

## 3. Co musí nastavit člověk (mimo kód)

### Vercel

- **Doména:** `splatno.cz` a `www.splatno.cz`, jedna z nich přesměrovává na druhou.
- **Proměnné prostředí pro Production i Preview:**
  - `EMAIL_MFA_SECRET` (alespoň 32 znaků)
  - `AUTH_EMAIL_DELIVERY_ENABLED=true`
  - `RESEND_API_KEY`
  - `AUTH_EMAIL_FROM`
  - `APP_BASE_URL=https://splatno.cz`

  Bez prvních dvou se náhled větve nesestaví.
- `REMINDER_LOGO_URL` už není potřeba. Logo v upomínkách se bere z firmy.

### Supabase → Authentication

- **URL Configuration:**
  - Site URL `https://splatno.cz`
  - Redirect URLs:
    - `https://splatno.cz/auth/callback**` (hvězdičky kvůli parametru `?vstup=hlavica`)
    - `https://splatno.cz/auth/recovery**`
    - adresy náhledů Vercelu (`https://*-<tým>.vercel.app/auth/callback`)
- **Emails → Confirm signup:** předmět „Potvrďte svůj e-mail ve Splatnu“, text
  zkopírovat ze souboru `supabase/templates/confirm.html`.
- **Providers → Email:** zapnout „Confirm email“.
- **SMTP Settings:** vlastní SMTP přes Resend (`smtp.resend.com`, port 465,
  uživatel `resend`, heslo = API klíč). Výchozí SMTP od Supabase posílá jen
  pár e-mailů za hodinu, registrace by se zasekávaly.

### Resend a DNS

- Doména `mail.splatno.cz` ověřená v Resendu (SPF, DKIM) a DMARC záznam v DNS.
  Bez nich budou pozvánky padat do spamu.

### Zálohy

- U produkčního projektu Supabase ověřit zapnuté zálohy, ideálně Point-in-time
  recovery. Po otevření pro další firmy je to nutnost.

## 3a. Předplatné, ověření firmy a provoz

### Jak to funguje

| Část | Chování |
|---|---|
| **Zkušební doba** | Nová firma má 30 dní plného provozu. Stávající firmy, včetně R. Hlavica, mají trvale aktivní předplatné. |
| **Po skončení** | Data zůstávají. Nové faktury (ručně, importem i z PDF) nejdou přidat a server vrátí 402. Upomínky se dál plánují, ale **neodesílají**. Zůstanou ve frontě a odejdou po zaplacení. V aplikaci se 7 dní předem objeví upozornění. |
| **Ověření firmy** | Kód se pošle do datové schránky dohledané podle IČO v ISDS. Platí 72 hodin a zadat ho jde nejvýš 5×. Bez napojení ISDS ověřuje provozovatel ručně na `/provoz`. |
| **Nákup** (`/predplatne`) | Jen ověřená firma a jen její administrátor. Částku vždy počítá server (`src/lib/plans.ts`). |
| **Platba kartou** | Přes Comgate. Tarif se aktivuje po oznámení z brány, které se ověří tajemstvím a navíc dotazem na stav platby. |
| **Platba převodem** | Zákazník dostane výzvu k platbě s QR kódem e-mailem. Platbu potvrdí provozovatel na `/provoz`. |
| **Po zaplacení** | Faktura e-mailem, číselná řada `SPF…`. |

Zaplacení je v databázi idempotentní a vyžaduje přesnou částku. Druhé
oznámení od brány předplatné neprodlouží.

### Co nastavit

- Proměnné `SPLATNO_SUPPLIER_*`, `COMGATE_*`, `ISDS_*` a
  `SPLATNO_OPERATOR_EMAILS`. Popis je v `.env.example`.
- **Comgate:** URL pro oznámení `https://splatno.cz/api/billing/comgate`.
  Nejdřív testovací režim (`COMGATE_TEST=true`).
- **ISDS:** přihlašovací údaje datové schránky Splatna pro webové služby.
  Nejdřív je otestujte na czebox.cz.

### Ověřeno jen proti napodobeninám

Klienty Comgate a ISDS jsem psal podle REST API Comgate v2.0 a WSDL ISDS v20.
Testy je ověřují jen proti napodobeným odpovědím. **Před ostrým provozem je
nutný průchod v testovacích prostředích** (Comgate test, czebox.cz).

## 4. Otevřená rozhodnutí

1. **Zkušební doba a placení.** „Vyzkoušet zdarma“ zatím vede na registraci
   bez omezení. Ceník na landing page je jen informativní.
2. **Upozornění pro provozovatele.** Chceš e-mail o každé nově založené firmě?
3. **Právní texty.** `/podminky` a `/ochrana-osobnich-udaju` jsou viditelně
   označený návrh. Před otevřením veřejnosti je musí zkontrolovat právník a
   doplnit údaje provozovatele.
4. **Schránka `info@splatno.cz`.** Na landing page na ni vede tlačítko Kontakt,
   je potřeba ji založit.

## 5. Vědomě mimo rozsah

- **Asistence při párování plateb** běží jen pro firmy uvedené v
  `PAYMENT_ASSISTANCE_ORGANIZATIONS`. Novou firmu je potřeba přidat ručně.
- **`run_bank_reconciliation_jobs`** zpracuje nejvýš 5 importů denně za všechny
  firmy dohromady. Při více firmách bude potřeba limit rozdělit mezi firmy.
- **Jeden člověk ve více firmách** (přepínání firem) zatím není.
- **Nahrání vlastního loga firmy.** Zatím ho jde nastavit jen v databázi
  (`organizations.logo_path`). Firma bez loga má v aplikaci monogram z názvu.
