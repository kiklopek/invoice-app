# P00 — routy a kontrakty

Baseline `f0f5fcb`, 17. 10. 2026. Výčty níže jsou zdrojová mapa; neověřují aktuální konfiguraci hostovaného Supabase. JSON kontrakty se v P00 nemění a nejsou nově definovány tímto dokumentem. Přesné typy/validátory zůstávají autoritou v odkazovaných zdrojích.

## Router a hranice vykreslování

`src/app/layout.tsx` obsahuje globální metadata, viewport a CSS. Route groups `(landing)`, `(legal)`, `(auth)`, `(onboarding)`, `(workspace)`, `(operator)` nejsou součást URL. Seznam všech 28 stránek je v dokumentu 01. Layout workspace zavádí serverově ověřenou identitu, oprávnění, předplatné, AppShell, Toast a WorkspaceDataProvider. Serverové `*-page-data` loadery nelze při redesignu nahradit jen klientským kontrolováním role.

`src/proxy.ts` používá společné rozhodování `access-state.ts`. Proxy řeší relaci/MFA; členství a předplatné doplňují serverové stránky/layout. Nestavět nový konkurenční router podle breakpointu. Mobilní a desktopová varianta mají stejnou adresu i datový stav.

Systémové hranice: kořenové `error.tsx`, `global-error.tsx`, `not-found.tsx`; workspace má vlastní error/loading. Auth, onboarding, provoz a hlavní sekce mají loading soubory; přesný seznam je v `source-inventory.json → boundaries`.

Metadata a assety mimo `page.tsx`: `robots.ts`, `sitemap.ts`, favicon/icon/apple-icon, veřejné `/og/cs` a `/og/en` (`src/app/og/[locale]/route.tsx`). Veřejné stránky explicitně povolují indexaci; kořenová metadata jsou pro nové soukromé stránky `noindex`. Redesign nesmí globálně zapnout indexaci aplikace ani odstranit CS/EN canonical/hreflang v `src/lib/seo.ts`.

## Identita, role a firma

| Vrstva | Zdroj | Kontrakt |
| --- | --- | --- |
| Stav přístupu | `src/lib/access-state.ts`, `src/proxy.ts` | `anonymous`, `stale_session`, `mfa_pending`, `verified`, `needs_onboarding`, `needs_payment`, `member`; zachovat returnTo a bezpečnou lokální cílovou cestu. |
| Ověřená relace | `src/lib/auth.ts`, `login-session-server.ts`, `email-mfa-server.ts` | Supabase claims a getUser musí souhlasit v user ID; platný normalizovaný e-mail, session ID, podepsaná login-session a požadované MFA. |
| Aktivní členství | `src/lib/auth.ts`, `invitation-claim.ts` | Vázané `user_id` + e-mail; převzetí platné pozvánky až po ověření relace. Podpora má expiraci a důvod. Serverová memoizace je jen v rámci requestu. |
| Role UI a serveru | `src/lib/role-access.ts`, `use-access-role.ts` | `viewer`, `accounting`, `admin`; UI profile pouze řídí prezentaci. Backend autorizuje samostatně. |
| Firma / RLS | `supabase/schema.sql`, migrace `20261010120000_tenant_isolation_guards.sql`, další navazující migrace | Členství podle `auth.uid()`, nikoli pouze domény/e-mailu; unikátní IČO a trial guards. Service role obchází RLS, proto vyžaduje explicitní organization/actor filtry a RPC kontroly. |
| Zápisy | `src/lib/request-security.ts` | Same-origin kontrola při přítomném Origin; jeho absence je pro serverové klienty povolena. Výjimka loopback aliasů pouze v dev při stejném protokolu a portu. Webhooky mají vlastní podpisy. |

| Právo | admin | accounting | viewer |
| --- | --- | --- | --- |
| Dashboard, seznam/detail faktury, zákazníci, reporty | ano | ano | ano |
| Správa faktur a provozní funkce | ano | ano | ne |
| Firma/nastavení pro čtení | ano | ano | ne |
| Editace firmy, logo, správa členů | ano | ne | ne |
| Přímé otevření dalších privátních rout | dále podle serverových/business guardů | dále podle serverových/business guardů | jen přesný allowlist a UUID detail faktury |

Provozovatel není čtvrtá běžná členská role. `/provoz` ověřuje oprávnění provozovatele zvlášť; support session je časově omezený vstup s vlastními serverovými pravidly. Billing a jednotlivé endpointy mají jemnější pravidla než prosté povolení stránky.

## Auth a onboarding — hranice procesů

Zakladatel: `/register` → vlastní e-mailový kód → ověřená relace → `/onboarding` → vytvoření firmy → tarif/karta → workspace. Registrace používá serverovou ochranu rozpracované registrace a ověření Supabase; redesign nesmí přidat neověřený vstup do firmy. Kódy mají pět znaků z omezené alfanumerické sady, unikátní znaky a pravidla z `verification-code.ts`; expirace, počet pokusů, resend a rate limits zůstávají serverové. Nepřevádět je zpět na číselný input, který zahodí písmena.

Pozvaný kolega: `/pozvanka/[token]` → nový nebo existující účet → ověřené přijetí pozvánky → původní firma. Nesmí vzniknout druhá firma ani se účet tiše převést z jiné firmy. Následný login je společný. `/hlavica` a `/hlavica/registrace` jsou skutečně implementované zvláštní tenant vstupy; nelze je zahodit jako duplicitu běžného formuláře.

Login → session preference/access → MFA, pokud je požadováno → návrat podle stavu firmy/předplatného. Obnova hesla má vlastní jednorázový recovery flow `/auth/recovery` a `/reset-password`; uživatelův požadavek na registrační kód neznamená odstranit recovery kontrakt.

Onboarding: krok 1 firma, 2 kontakt, 3 banka, 4 upomínky, 5 logo, 6 tým, 7 shrnutí, 8 tarif/karta. `src/lib/onboarding-draft.ts`, `/api/onboarding/draft` a migrace `20261015181557_onboarding_drafts.sql` drží koncept pro uživatele. Po založení je firma vytvořena přes `create_organization_for_user`; nedokončený billing vrací do kroku platby. Založení firmy, nahrání loga a poslání pozvánek jsou různé operace a mají i částečný neúspěch.

## Kritické doménové kontrakty

| Tok / zdroje | Vstup, pořadí a výstup k zachování | Vedlejší účinek / regrese |
| --- | --- | --- |
| Faktury — `invoice-form.tsx`, `invoice-validation.ts`, `types/invoice.ts`, `/api/invoices/**` | Typovaný InvoiceInput, ISO datum, validní částka/měna/DPH, příjemce a důkazy původní částky; list query z `invoice-list-query.ts`. Detail/page-data spojuje finance, dokument a historii. | Zápis/úhrada/storno/mazání nemá být vyvolán pouhým výběrem textu. Zachovat chybové kódy a kontrolu souběhu v endpointu/RPC. |
| OCR — upload/verify/extract/import, `invoice-ocr-*.ts`, `document-validation.ts` | Upload evidence vlastníka a org, ověřený obsah, expirace, claim OCR → přesné ISDOC/QR a lokální OCR → volitelné AI → registry/kontrola účtu → ruční review → import. Výstup zahrnuje kandidáty, zdroje a varování, nejen finální hodnoty. | Storage, OCR quota a externí ARES; Gemini jen explicitní provider/hybrid konfigurace, ne nově vynucený fallback kvůli vzhledu. |
| Párování — `payments-client`, `gpc-import-panel`, `/api/payments/**` | Import výpisu → perzistentní kontrola řádků → úpravy s revizí → explicitní commit. Commit `{revision, acknowledge_account_mismatch}` → `reconcile_bank_statement(target_org, actor_user, target_import, expected_revision, acknowledge_account_mismatch)`. | Částky v menších jednotkách, deduplikace/fingerprint, split a partial úhrady, potvrzení cizího účtu. `revision_conflict`/`not_committable` jsou 409. Žádné automatické opakování účtování bez idempotence. |
| Asistence párování — `payment-assistance-panel`, `payment-assistance-*`, feature flags | Kandidáti, vysvětlení, přezkum; existují vypnuté/shadow/review větve. | Nový layout nesmí změnit aktivní engine, auto-booking policy ani udělat z doporučení potvrzenou úhradu. |
| Zákazníci — `customers-page-data`, `customers-client`, `/api/customers/**` | Hledání, sort, editace kontaktu a preferencí upomínek; u změny e-mailu potvrzení dopadu na příjemce. | Kopírování textu nesmí navigovat; odkaz vede na filtrované faktury, nikoli neexistující detail zákazníka. |
| Reporty — `report-page-data`, `report-query`, `reports-client` | Tržby/DPH/Pohledávky/Platby; filtry období, zákazník, měna a existující query parametry; tiskový dokument. | Žádná změna výpočtu nebo smíchání měn kvůli sjednocení karet. Otestovat tisk i při mobilních media queries. |
| Firma/tým — `settings-page-data`, `settings-client`, `/api/settings/**` | Versionované firemní změny a draft/dirty dialog, validátory, účty, pozvánky/role/support historie; účetní read-only. | Změna role/odebrání přístupu/pozvání mají serverové kontroly a někdy odeslání e-mailu. |
| Upomínky + šablona — `reminders-client`, `reminder-page-data`, `/api/settings/reminders` | Dva view módy, společný PUT s revizí a harmonogramem/texty/reply-to/CC. RPC `save_default_reminder_settings_versioned`. Koncepty `splatno:reminders-draft:${view}`; zachovat skrytá data druhého view. | Ruční kontrola a testovací odeslání posílají skutečné e-maily; vypnutí automatu nesmí být jen lokální stav. Kategorie/policies jsou samostatné mutace. |
| Logo — `company-logo-editor`, `company-logo-file`, `/api/settings/logo`, `/logo/[organizationId]` | FormData upload a DELETE ukládají okamžitě; verzovaná URL po změně, přechodná fajfka; nesmí přepsat rozepsané texty. | Storage a veřejný serverový výstup loga; role admin a validace/dekódování souboru zůstávají serverové. |
| Doručení — `reminders.ts`, `email.ts`, webhook Resend, cron | Fair queue, recipient safety, suppression, retry, stav odesílání a idempotence událostí. | Podpis Svix; doručená/blocked adresa není pouhý barevný badge. Cron kontrolu nepouštět jako vizuální test. |
| Billing — `billing-server`, `stripe-billing`, `/api/billing/**` | Setup/activate, trial claim, plán/období, preview/confirm změny, subscription stav, invoice limits, exempt. | Stripe card/portal a možné účtování; webhook přes raw body + podpis, event evidence. Server zůstává autoritou přístupu. |

## Formulářové invarianty

`company-validation.ts`: IČO s kontrolní číslicí, DIČ CZ + 8–10 číslic, bankovní účet včetně kontrol, e-mail, telefon, datová schránka a přiměřený formát adresy. To není ověření vlastnictví telefonu nebo existence každé adresy. ARES je samostatné obohacení s chybovým stavem, ne univerzální povinný důkaz všech hodnot.

`invoice-validation.ts`: platná data a částky, serverový limit `999_999_999_999.99`, kontrola DPH a účetní konzistence. Návrhy musí počítat i s touto délkou, nejen s běžnými desítkami tisíc. `payment-validation.ts` validuje datum úhrady. `document-validation.ts`: 16 B až 10 MB a kontrola podporované signatury. `company-logo-file.ts` + serverový decode: PNG/JPEG/WebP, nejvýše 512 KiB a 4 096 px, bez SVG.

Zachovat popisky, povinné/nepovinné pole, chybový text u konkrétního pole, správný autocomplete/inputmode, keyboard submit, pending/disabled a ochranu před duplicitním submit. Serverový validator se nesmí odstranit po přidání klientského.

## Cache, chyby a návraty

SWR provider má vlastní Map, dedupe 10 s, keepPreviousData, focus throttle 60 s a retry vypnutý. Po úspěšné `/api` mutaci `RouterCacheInvalidator` obnovuje router; `workspace-cache.ts` invaliduje související klíče. `apiFetch` zachovává error/code/request_id, timeout 15 s a jeden retry na 401 jen pro GET/HEAD nebo s idempotency key. Ne každý komponentní fetch jde přes tento wrapper; přehled importů je v JSON inventuře. Nesmí se plošně přidat retry všech POST nebo ztratit AbortSignal/FormData.

## Výstupy a externí plochy

OTP e-mail: `auth-code-email.ts` + assets; pozvánka: `invitations.ts` / `invitation-server.ts`; recovery: `password-recovery-server.ts`; faktura/upomínka: `email.ts`, `reminder-email-template.ts`, `reminder-template.ts`, `/api/invoices/[id]/send`. Sdílený branding: `company-branding.ts`. PDF: `invoice-pdf.ts` a PDF endpoint; tisk: `reports/report-print-document.tsx`; prohlížeč dokumentů: `document-preview.tsx`.

Zachovat escapování HTML, textovou alternativu, QR platební údaje, správné logo firmy, české znaky/fonty v PDF a privátní přístup k originálům. Avatar odesílatele v inboxu řídí poštovní služba/doména, nikoli CSS e-mailu. Stripe hostovaný checkout/portál není vlastní obrazovka aplikace.

## Úplný registr handlerů

Následující tabulka je vygenerována ze skutečných `route.ts` a `route.tsx`. Obsahuje všechny metody exportované v baseline. RPC sloupec uvádí pouze doslovné volání přímo v handleru; **neznamená úplný seznam tranzitivních RPC ani důkaz oprávnění**. Pro změnu konkrétního kontraktu přečíst celý handler a importované serverové helpery. V P00 se žádný nemění.

| ID | Metody | URL | Zdroj | Přímé RPC |
| --- | --- | --- | --- | --- |
| H01 | POST | `/api/auth/access` | `src/app/api/auth/access/route.ts` | — |
| H02 | POST | `/api/auth/email-mfa/send` | `src/app/api/auth/email-mfa/send/route.ts` | `create_email_mfa_challenge` |
| H03 | POST | `/api/auth/email-mfa/verify` | `src/app/api/auth/email-mfa/verify/route.ts` | `verify_email_mfa_challenge` |
| H04 | POST | `/api/auth/logout` | `src/app/api/auth/logout/route.ts` | `end_support_session` |
| H05 | POST | `/api/auth/password-recovery` | `src/app/api/auth/password-recovery/route.ts` | — |
| H06 | POST | `/api/auth/register` | `src/app/api/auth/register/route.ts` | — |
| H07 | POST | `/api/auth/registration-access` | `src/app/api/auth/registration-access/route.ts` | — |
| H08 | POST | `/api/auth/session-preference` | `src/app/api/auth/session-preference/route.ts` | — |
| H09 | POST | `/api/billing/activate` | `src/app/api/billing/activate/route.ts` | — |
| H10 | GET | `/api/billing` | `src/app/api/billing/route.ts` | — |
| H11 | POST | `/api/billing/setup` | `src/app/api/billing/setup/route.ts` | — |
| H12 | POST | `/api/billing/stripe` | `src/app/api/billing/stripe/route.ts` | `record_stripe_event`, `record_stripe_event` |
| H13 | POST | `/api/billing/subscription` | `src/app/api/billing/subscription/route.ts` | — |
| H14 | GET, POST | `/api/cron/check-due` | `src/app/api/cron/check-due/route.ts` | `schedule_reminder_jobs`, `claim_reminder_jobs`, `release_claimed_reminder_jobs`, `fail_claimed_reminder_job`, `skip_claimed_reminder_job`, `complete_claimed_reminder_send`, `fail_claimed_reminder_job`, `release_claimed_reminder_jobs`, `cleanup_expired_support_sessions` |
| H15 | GET | `/api/cron/reconcile-payments` | `src/app/api/cron/reconcile-payments/route.ts` | `run_bank_reconciliation_jobs` |
| H16 | PATCH | `/api/customers/[id]` | `src/app/api/customers/[id]/route.ts` | `update_customer_contact` |
| H17 | GET | `/api/customers` | `src/app/api/customers/route.ts` | — |
| H18 | GET | `/api/customers/search` | `src/app/api/customers/search/route.ts` | `search_customers` |
| H19 | GET | `/api/dashboard` | `src/app/api/dashboard/route.ts` | — |
| H20 | GET | `/api/health` | `src/app/api/health/route.ts` | `list_invoices_page`, `invoice_report_summary`, `dashboard_summary` |
| H21 | POST | `/api/invitations/[token]` | `src/app/api/invitations/[token]/route.ts` | `accept_organization_invitation` |
| H22 | GET | `/api/invoices/[id]/activity` | `src/app/api/invoices/[id]/activity/route.ts` | — |
| H23 | GET | `/api/invoices/[id]/assignable-payments` | `src/app/api/invoices/[id]/assignable-payments/route.ts` | — |
| H24 | GET | `/api/invoices/[id]/document` | `src/app/api/invoices/[id]/document/route.ts` | — |
| H25 | GET | `/api/invoices/[id]/page-data` | `src/app/api/invoices/[id]/page-data/route.ts` | — |
| H26 | GET | `/api/invoices/[id]/pdf` | `src/app/api/invoices/[id]/pdf/route.ts` | — |
| H27 | POST | `/api/invoices/[id]/reminders/[reminderId]/retry` | `src/app/api/invoices/[id]/reminders/[reminderId]/retry/route.ts` | `complete_reminder_send` |
| H28 | GET | `/api/invoices/[id]/reminders` | `src/app/api/invoices/[id]/reminders/route.ts` | — |
| H29 | GET, PATCH, DELETE | `/api/invoices/[id]` | `src/app/api/invoices/[id]/route.ts` | `confirm_manual_payment`, `reopen_paid_invoice`, `delete_invoice_safely` |
| H30 | POST | `/api/invoices/[id]/send` | `src/app/api/invoices/[id]/send/route.ts` | — |
| H31 | POST | `/api/invoices/extract` | `src/app/api/invoices/extract/route.ts` | `claim_invoice_ocr` |
| H32 | POST | `/api/invoices/import` | `src/app/api/invoices/import/route.ts` | — |
| H33 | GET | `/api/invoices/reminder-policy-preference` | `src/app/api/invoices/reminder-policy-preference/route.ts` | — |
| H34 | GET, POST | `/api/invoices` | `src/app/api/invoices/route.ts` | `list_invoices_page_filtered` |
| H35 | POST | `/api/invoices/upload` | `src/app/api/invoices/upload/route.ts` | — |
| H36 | POST | `/api/invoices/upload/verify` | `src/app/api/invoices/upload/verify/route.ts` | — |
| H37 | POST | `/api/onboarding/ares` | `src/app/api/onboarding/ares/route.ts` | — |
| H38 | PUT | `/api/onboarding/draft` | `src/app/api/onboarding/draft/route.ts` | — |
| H39 | POST | `/api/onboarding/organization` | `src/app/api/onboarding/organization/route.ts` | `create_organization_for_user` |
| H40 | POST, DELETE | `/api/operator/support` | `src/app/api/operator/support/route.ts` | `start_support_session`, `end_support_session` |
| H41 | GET, POST | `/api/payments/assistance` | `src/app/api/payments/assistance/route.ts` | `payment_assistance_overview`, `request_payment_assistance`, `set_payment_assistance_waiting`, `decide_payment_assistance`, `save_payment_payer_memory` |
| H42 | GET | `/api/payments/audit` | `src/app/api/payments/audit/route.ts` | `audit_invoice_money` |
| H43 | POST | `/api/payments/imports/[id]/commit` | `src/app/api/payments/imports/[id]/commit/route.ts` | `reconcile_bank_statement` |
| H44 | POST | `/api/payments/imports/[id]/discard` | `src/app/api/payments/imports/[id]/discard/route.ts` | `discard_bank_statement_import` |
| H45 | POST | `/api/payments/imports/[id]/release` | `src/app/api/payments/imports/[id]/release/route.ts` | `release_statement_entry` |
| H46 | GET, PATCH | `/api/payments/imports/[id]` | `src/app/api/payments/imports/[id]/route.ts` | `save_bank_statement_allocations` |
| H47 | POST | `/api/payments/imports/overlap` | `src/app/api/payments/imports/overlap/route.ts` | `acknowledge_statement_overlap` |
| H48 | GET, POST | `/api/payments/imports` | `src/app/api/payments/imports/route.ts` | `reconcile_bank_statement` |
| H49 | GET | `/api/payments/invoice-candidates` | `src/app/api/payments/invoice-candidates/route.ts` | `list_open_invoice_candidates` |
| H50 | GET, PATCH, DELETE | `/api/payments` | `src/app/api/payments/route.ts` | `assign_bank_payment`, `unassign_bank_payment_allocations` |
| H51 | GET | `/api/reminders/page-data` | `src/app/api/reminders/page-data/route.ts` | — |
| H52 | GET | `/api/reminders` | `src/app/api/reminders/route.ts` | — |
| H53 | GET | `/api/reports` | `src/app/api/reports/route.ts` | `invoice_report_rows_page`, `invoice_report_summary` |
| H54 | GET, POST, DELETE | `/api/settings/bank-accounts` | `src/app/api/settings/bank-accounts/route.ts` | — |
| H55 | GET, PUT | `/api/settings/company` | `src/app/api/settings/company/route.ts` | — |
| H56 | GET, DELETE | `/api/settings/email-suppressions` | `src/app/api/settings/email-suppressions/route.ts` | — |
| H57 | POST, DELETE | `/api/settings/logo` | `src/app/api/settings/logo/route.ts` | — |
| H58 | POST | `/api/settings/members/invitation` | `src/app/api/settings/members/invitation/route.ts` | — |
| H59 | GET, POST, PATCH, DELETE | `/api/settings/members` | `src/app/api/settings/members/route.ts` | `add_organization_member`, `update_organization_member_role`, `end_support_session`, `delete_organization_member`, `restore_organization_member_after_auth_delete_failure` |
| H60 | GET | `/api/settings/page-data` | `src/app/api/settings/page-data/route.ts` | — |
| H61 | GET, POST, PATCH, DELETE | `/api/settings/reminder-policies` | `src/app/api/settings/reminder-policies/route.ts` | `set_default_reminder_policy` |
| H62 | GET, PUT | `/api/settings/reminders` | `src/app/api/settings/reminders/route.ts` | `save_default_reminder_settings_versioned` |
| H63 | POST | `/api/settings/reminders/test` | `src/app/api/settings/reminders/test/route.ts` | — |
| H64 | POST | `/api/webhooks/resend` | `src/app/api/webhooks/resend/route.ts` | `process_resend_delivery_event` |
| H65 | GET | `/auth/callback` | `src/app/auth/callback/route.ts` | — |
| H66 | GET | `/auth/recovery` | `src/app/auth/recovery/route.ts` | — |
| H67 | GET | `/logo/[organizationId]` | `src/app/logo/[organizationId]/route.ts` | — |
| H68 | GET | `/og/[locale]` | `src/app/og/[locale]/route.tsx` | — |
