# Splatno pro více firem: jak to funguje a co nastavit

Tento dokument popisuje provoz větve, která otevírá Splatno pro všechny firmy.
Všechny firmy se přihlašují přes `splatno.cz/login`; firmu určuje účet, ne
adresa. `splatno.cz/hlavica` zůstává jen jako starší adresa s logem R. Hlavica.

## 1. Procesy v kostce

| Scénář | Kroky |
|---|---|
| **Založení firmy** | `/register` (Založit firemní účet) → potvrzovací e-mail → `/auth/callback` → `/mfa` (kód z e-mailu) → `/onboarding` (IČO z ARES, kontakt, bankovní účet, upomínky, logo, tým, shrnutí) → firma vznikne naráz → tarif a karta (Stripe, 14 dní zdarma) → `/dashboard` |
| **Pozvání do firmy** | Admin: Nastavení → Tým → e-mail a role → potvrzení → e-mail s odkazem `splatno.cz/pozvanka/<token>` (platí 7 dní, jen jednou) |
| **Přijetí pozvánky** | Odkaz → jméno a heslo (e-mail je daný pozvánkou) → člen firmy s rolí z pozvánky → `/dashboard`. Odkaz se počítá jako 2FA pro tuto první relaci. |
| **Běžné přihlášení** | `/login` pro všechny firmy → heslo → kód z e-mailu → aplikace. Po odhlášení i po změně hesla se jde vždy na `/login`. |
| **R. Hlavica** | přihlášení přes `/login`; `/hlavica` dál funguje kvůli starým záložkám, aplikace na ni nikoho neposílá. Registrace `/hlavica/registrace` (jen pozvaný @hlavica.cz). Přidání člověka v Nastavení → Tým e-mail neposílá, pozvánka e-mailem jen tlačítkem. 2FA i zapomenuté heslo z tohoto vstupu mají jejich logo (`?vstup=hlavica`). |

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
- `20261007132631_auth_rate_limit_actions.sql` (v produkci od 7. 10.)

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

## 3a. Předplatné přes Stripe

### Jak to funguje

| Část | Chování |
|---|---|
| **Onboarding** | Poslední krok „Tarif a karta“: výběr tarifu a období a zadání karty přes Stripe Checkout (režim setup, nic se nestrhává). Bez karty se aplikace neotevře (stav `needs_payment`). |
| **Zkušební doba** | 14 dní, nejvýš 50 faktur. Limit hlídá databázový trigger s čítačem: smazáním faktury se limit nevrací, souběžné vkládání ho nepřeleze. U 50. faktury jde zkušební dobu ukončit a začít platit hned (po potvrzení částky). |
| **Ochrana proti zneužití** | Jedna zkušební doba na IČO (i po smazání firmy), na kartu (otisk karty ze Stripe) a nejvýš 3 za 30 dní z jedné IP (jen HMAC otisk, po 90 dnech se maže). Registrace z jednorázových schránek se odmítne. Kdo na zkušební dobu nárok nemá, vidí důvod a částku a platí až po potvrzení. Otisk prohlížeče se záměrně nepoužívá: vyžaduje souhlas (ePrivacy) a k otisku karty a IČO přidá málo; zařízení u plateb kartou vyhodnocuje Stripe Radar. |
| **Po zkušební době** | Stripe automaticky strhne zvolený tarif a dál každý měsíc nebo rok. |
| **Změna tarifu** | Na stránce Předplatné, vždy s náhledem částky a potvrzením. Vyšší tarif a přechod na roční platbu platí hned, doplatí se poměrná část (Stripe `always_invoice`). Když platba neprojde, tarif se nezmění. Nižší tarif a přechod na měsíční platbu platí od dalšího období (subscription schedule), peníze se nevrací. |
| **Neúspěšná platba** | Stripe platbu opakuje, aplikace funguje a ukazuje pruh „Aktualizujte kartu“. Po vyčerpání pokusů (`unpaid`/`canceled`) se zastaví nové faktury a odesílání upomínek. Data zůstávají. |
| **Zrušení** | Ke konci zaplaceného období, jde odvolat. |
| **Karta a faktury** | Stripe Billing Portal (odkaz na stránce Předplatné). Daňové doklady vystavuje Stripe. |
| **R. Hlavica a starší firmy** | Trvalé `active` bez Stripe, nic se pro ně nemění. Zrcadlení ze Stripe takový řádek nepřepíše (`legacy_subscription`). |

Stav se do databáze jen zrcadlí (`sync_stripe_subscription`), vždy z předplatného čerstvě načteného ze Stripe. Proto nezáleží na pořadí ani opakování webhooků. Jiného zákazníka nebo běžící předplatné zrcadlení tiše nepřepíše (`customer_mismatch`, `subscription_mismatch`).

### Co nastavit

1. **Stripe účet** (nejdřív testovací režim) a firemní údaje Splatna v Dashboardu: název, IČO, DIČ, adresa. Pro české faktury nastavit v Settings → Invoices číslování a patičku.
2. **Produkty a ceny:** `STRIPE_SECRET_KEY=sk_test_… node scripts/stripe-setup.mjs` (s `--vat`, je-li Splatno plátce DPH). Ceny bere z `src/lib/plans.ts`.
3. **Webhook:** `https://splatno.cz/api/billing/stripe` s událostmi `checkout.session.completed`, `customer.subscription.*`, `invoice.paid`, `invoice.payment_failed`, `invoice.payment_action_required` a `subscription_schedule.*`.
4. **Proměnné** pro Production i Preview: `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, případně `STRIPE_TAX_RATE_ID`.
5. **Settings → Billing → Subscriptions:** opakování neúspěšných plateb (Smart Retries) a po jejich vyčerpání předplatné označit jako `unpaid` nebo zrušit.

### Ověřeno jen proti napodobeninám

Logika je otestovaná proti napodobenému Stripe a podepsaným testovacím událostem. **Před ostrým provozem je nutný průchod v testovacím režimu Stripe:**

- karta `4242 4242 4242 4242` → zkušební doba → změna tarifu s doplatkem,
- karta `4000 0000 0000 0341` → neúspěšná platba → pruh v aplikaci,
- `stripe trigger` nebo Test clocks na posun času přes konec zkušební doby.

### Zrušeno

- Ověření firmy datovou schránkou (`ISDS_*`)
- Comgate a platba převodem (`COMGATE_*`, `SPLATNO_SUPPLIER_*`)
- Vlastní PDF faktury Splatna

Funkce v databázi jsou odstraněné. Tabulky `billing_orders`, `organization_verifications` a `operator_actions` zůstávají prázdné kvůli auditní stopě.

## 4. Otevřená rozhodnutí

1. **Limity tarifů.** Ceník slibuje „až 100 / 500 faktur měsíčně“ (Start/Profi),
   aplikace je zatím nevynucuje. Hlídá se jen limit 50 faktur ve zkušební době.
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

## 6. Pro všechny firmy: co platí od 10. 10.

### Exkluzivita R. Hlavica (jen pro ni, záměrně)

- **Vlastní vstup s logem** `/hlavica` a `/hlavica/registrace`. Kód je jen
  v `src/lib/tenant-entries.ts` (`CUSTOM_ENTRY`). Test
  `src/lib/tenant-exclusivity.test.ts` hlídá, že se jméno firmy nikde jinde
  v kódu neobjeví. Vstup se pozná podle `organizations.allowed_email_domain`,
  který nastavuje jen migrace. API Nastavení ho nepřijme.
- **Trvale zdarma.** Řídí to `subscriptions.billing_exempt`. Firmu s tímto
  příznakem Stripe nikdy nepřepíše, Checkout ani portál ji nepustí dál.
  Firma bez řádku předplatného už nefakturuje zdarma.
- **Automatické zaúčtování i podle jména plátce.** Řídí to
  `organizations.auto_booking = 'vs_and_name'`. Nové firmy mají `'vs'`:
  automaticky jen podle VS nebo čísla faktury. Hodnotu mění jen migrace nebo
  provozovatel.

### Bezpečnost a oddělení firem

- Čekající členství převezme jen účet s **potvrzeným e-mailem** a s pozvánkou,
  které neprošla platnost.
- RLS uzná člena jen podle převzatého členství (`user_id`), nikdy jen podle
  e-mailu v přihlašovacím tokenu.
- Jedno IČO patří nejvýš jedné firmě. Nejde převzít ani IČO, na které už
  proběhla zkušební doba jiné firmy.
- Veřejné API registrace neprozradí, kdo je pozvaný nebo kdo už má účet.

### Bankovní účty a výpisy

- **Další účty firmy:** Nastavení → Firma → Další bankovní účty (i zahraniční
  IBAN). Výpis z kteréhokoli účtu firmy nehlásí neshodu účtu. Výpis z cizího
  účtu se automaticky nezaúčtuje, dokud ho člověk nepotvrdí.
- Účty se porovnávají **včetně kódu banky**.
- **Měna výpisu GPC** se řídí účtem, ke kterému výpis patří.
- **Faktura, QR i upomínka** berou účet v měně faktury, nikdy korunový účet.
- **Registr bank** (`src/lib/bank-formats/`): formát se pozná podle obsahu.
  Banka se pozná podle sebeoznačení souboru, nebo podle účtu firmy. Ověřená je
  zatím jen KB (permutace KM). Výpis jiné banky se načte, ale platby z něj se
  párují jen podle VS a čísla účtů se neučí. **Postup pro další banku:**
  1. oficiální specifikace do `docs/bank-formats/`;
  2. anonymizovaný reálný výpis jako fixture;
  3. test (mod-11 všech účtů, zlaté hodnoty);
  4. teprve potom `verified: true` v `registry.ts`.
- CSV z bank: odchozí platby se přeskočí. Nejednoznačná částka („1.500“) a
  prázdná měna jsou chybou řádku. Reference RF… jde do zprávy.
- Čísla faktur s oddělovači („FV-2026/001“) se najdou ve zprávě i jako VS.

### Support přístup provozovatele

- `/provoz` → „Vstoupit jako podpora“: důvod, 15/60/240 minut a potvrzení s
  počtem upozorněných administrátorů. Provozovatel je pak ve firmě jako
  dočasný administrátor.
- Firma to vidí:
  - e-mail administrátorům;
  - Nastavení → Tým (označení s časem a historie vstupů);
  - v aplikaci provozovatele pruh „Režim podpory“.
- Přístup končí:
  - vypršením (RLS ho hned neuzná, cron ho uklidí);
  - tlačítkem Ukončit;
  - odhlášením;
  - když ho admin firmy odebere.
- **Support musí běžet z odděleného účtu** v `SPLATNO_OPERATOR_EMAILS`, vždy
  s 2FA. Účet s obchvatem 2FA (testovací `test-admin@hlavica.cz`)
  provozovatelem být nemůže.

### Škálování

- Fronta upomínek se dělí mezi firmy po kolech. Plánovač má díl na firmu.
  Seznam firem se načítá stránkovaně a `/provoz` stránkuje.
- Strop 25 upomínek na jeden běh cronu zůstává. Při růstu je potřeba spouštět
  cron `check-due` častěji (vyžaduje tarif Vercel, který to dovolí).

### Fakturace

- `organizations.vat_payer`: neplátce má PDF bez řádků DPH s textem „Nejsem
  plátce DPH“ a nová faktura začíná na 0 %.
- Upomínky odcházejí jako „Firma X přes Splatno“ z adresy
  `REMINDER_EMAIL_FROM`. Odpovědi jdou na e-mail firmy.

### Proměnné prostředí

- `REMINDER_TEST_RECIPIENTS` (čárkami) nahrazuje `ALLOW_ADAM_REMINDER_TEST_EMAIL`.
  V produkci (`VERCEL_ENV=production`) se ignoruje a validace ji odmítne.
  **Starou proměnnou z Vercelu odstraňte.**
- `SPLATNO_OPERATOR_EMAILS`: přidejte samostatný účet podpory.

### Migrace a pořadí nasazení

Nové migrace (zatím jen v repozitáři, do produkce **až po schválení**):

1. `20261010120000_tenant_isolation_guards.sql`
2. `20261010121000_billing_exempt.sql`
3. `20261010122000_auto_booking_per_organization.sql`
4. `20261010123000_organization_bank_accounts.sql`
5. `20261010124000_statement_bank_dialect.sql`
6. `20261010125000_support_sessions.sql`
7. `20261010126000_fair_reminder_queue.sql`
8. `20261010127000_vat_payer.sql`

**Migrace musí do databáze dřív než kód**: kód čte nové sloupce a funkce.
Po `apply_migration` přejmenovat lokální soubory podle `list_migrations`
(viz CLAUDE.md). Testy: `node scripts/test-multi-tenant-db.mjs` a
`node scripts/test-payment-assistance-db.mjs`.

### Zatím nevyřešeno

- **Identita plátce bez IČO.** Naučené účty plátců jsou dál vázané na IČO
  zákazníka. Zahraniční a soukromí zákazníci se tak nenaučí. Řešení by
  vyžadovalo přestavět klíč napříč SQL párováním i asistentem plateb.
- **Zmrazení údajů vystavitele na faktuře.** PDF ke staré faktuře ukáže
  aktuální adresu a účet firmy.
- **Asistent plateb** se dál zapíná přes env (`PAYMENT_ASSISTANCE_ORGANIZATIONS`).
- **`run_bank_reconciliation_jobs`**: limit 5 importů denně platí pro všechny
  firmy dohromady (viz §5).
