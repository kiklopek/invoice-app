# P00 — komponenty, formuláře a styly

Baseline `f0f5fcb`, 17. 10. 2026. Stávající aplikace nemá jedinou centrální knihovnu všech formulářových polí, tabulek a tlačítek. Sdílí část komponent a globální CSS tříd, část UI je přímo ve stránkách. Tento audit neprovádí jejich extrakci.

## Mapa UI a datových vazeb

| Oblast | Skutečné zdroje / komponenty | Vazba a stavy důležité pro redesign |
| --- | --- | --- |
| Aplikační rámec | `src/components/layout/app-shell.tsx`, workspace layout | Sidebar, podsekce, mobile navigation, user menu, logo, shell; serverově předaná role/firma/předplatné. Změna shellu zasáhne všechny privátní stránky. |
| Infrastruktura dat | `workspace-data-provider.tsx`, `router-cache-invalidator.tsx`, `src/lib/api-client.ts`, `workspace-cache.ts` | SWR provider, RSC refresh, API error/request ID a invalidace doménových dat. Nejsou prezentační komponenty. |
| Brand a obrázky | `splatno-mark.tsx`, `company-logo.tsx`, `company-branding.ts`, `company-logo-file.ts` | Výchozí značka, vlastní firma, fallback/selhání obrázku, veřejná verzovaná logo URL, společný e-mail branding. |
| Ikony | `icons.tsx`, `chevron-down.tsx`, `landing/landing-icons.tsx` | Více zdrojů; zachovat význam a přístupný název icon-only akcí. Není důvod v P00 instalovat jiný balíček ikon. |
| Dialogy a zprávy | `modal.tsx`, `toast.tsx`, `popup-fitter.tsx`, `mobile-disclosure.tsx` | Confirm, formulářový dialog, toast, popup v dostupném okně, sbalovací mobilní obsah. Ověřit focus/escape/návrat focusu u každé konzumující stránky. |
| Neuložené změny | `src/lib/use-unsaved-changes.ts` + lokální draft kód | Dirty guard a obnovení konceptu; onboarding, firma a oba view upomínek nemají jeden univerzální draft store. |
| Loading / bannery | `page-skeleton.tsx`, `app-loading/app-loading.tsx`, `subscription-banner.tsx`, `support-banner.tsx` | Skeleton, omezený přístup, předplatné a support; neskrýt skutečné blokování jen přepracováním karty. |
| Eško | `esko/esko-assistant.tsx`, `src/lib/esko.ts` | Lazy SWR dashboard a hledání přes API faktur; panel/chat/stav čekání/chyba. Není to nový externí LLM endpoint. |
| Landing | `landing-page`, `pricing`, `landing-video`, `landing-motion`, `count-up` | CS/EN dictionary, pricing period, video overlay, FAQ a scroll/reduced-motion proces; dashboard v hero je marketingová prezentace, ne přihlášený workspace. |
| Auth | `auth-shell`, `login-form`, `register-form`, `password-input`, `otp-input`, `plan-choice-memo` | Login, signup → OTP, resend, heslo, plán/období; mfa/recovery stránky mají i vlastní lokální formulář. |
| Pozvánka | `(auth)/pozvanka/[token]/invitation-client.tsx` | Stav tokenu, jiný účet, nový/existující uživatel; nesjednotit násilně s prvním založením firmy. |
| Onboarding | `onboarding-client.tsx`, `onboarding.module.css` | Osm kroků, sidebar/progress, ARES, validace, per-user draft, více členů a subscription vstup. Logo/tým/platba mohou selhat odděleně. |
| Dashboard | `dashboard-client.tsx`, `dashboard-summary.module.css`, `dashboard-page-data.ts` | Souhrny, grafy, attention list a empty; SWR počáteční data a role-aware akce. |
| Seznam faktur | `invoices-client.tsx`, `invoice-list-page-data.ts`, `invoice-list-query.ts` | Filtry, vyhledávání, řazení, pagination, rychlá úhrada; mobilní karty a kopírování. |
| Formulář faktury | `src/components/invoice-form.tsx`, `optional-payment-assignment.tsx` | Společný nový/edit/import form, DPH, částky a příjemce, volitelná platba; client review nesmí nahradit server validaci. |
| Detail faktury | `invoice-detail-client.tsx`, `invoice-detail-page-data.ts` | Edit, dokument, platby, historie, upomínky, e-mail, storno/mazání. Tlačítka mají skutečné finanční či doručovací efekty. |
| Dokument a import | `document-preview.tsx`, `invoices/import/page.tsx`, `invoice-import.module.css` | PDF/obrázek, načítání, OCR kandidáti/zdroje, fronta a CSV; mobilní Údaje/Doklad. Privátní URL a kontrola souboru zůstávají. |
| Archiv faktur | `invoices/archive/page.tsx` | Vlastní klientská stránka/SWR, archivované a stornované záznamy; není stejné jako archiv plateb. |
| Párování výpisů | `payments-client.tsx`, `gpc-import-panel.tsx`, `payments-upload.module.css` | Intro vs. pracovní režim bez hero, více souborů, revize, sumáře, řádky, warning, filtr, split a commit. |
| Platby a archiv | `payments-archive-client.tsx`, `statement-archive.tsx`, `payment-assistance-panel.tsx` | Historie plateb, evidence originálu výpisu, stažení/discard, asistence, release a manuální přiřazení. |
| Zákazníci | `customers-client.tsx`, `customers-page-data.ts` | Identita/iniciála, kontakt editace, fakturace, velké částky, sort/search/export, výběr textu versus navigace na faktury. |
| Reporty | `reports-client.tsx`, `report-print-document.tsx`, `report-page-data.ts` | Čtyři pohledy, společné filtry a tisk; grafy a tabulky dnes i přes globální styly. |
| Firma/tým | `settings-client.tsx`, `bank-accounts-section.tsx`, `settings-page.module.css` | Formulář firmy, další účty, role, členové/pozvánky, access/support; revision/dirty/read-only. |
| Upomínky/šablona | `reminders-client.tsx`, `email-templates-section.tsx`, `email-suppressions-panel.tsx`, `company-logo-editor.tsx` | `view=automation/templates` nad jedním datovým kontraktem; logo vlastní save; text stage/reply/CC/preview/test a cron/suppression jsou odlišné akce. |
| Billing | `predplatne/subscription-client.tsx`, `src/lib/billing*.ts`, `stripe-billing.ts` | Plány/perioda, trial/active/past_due/exempt, preview/confirm/cancel/resume a externí karta/checkout. |
| Provoz | `(operator)/provoz/operator-console.tsx`, `operator-server.ts` | Výběr firmy, důvod/dočasný support a ukončení; jiná oprávnění než běžný admin. |
| Právní stránky | `(legal)/legal-page.tsx`, `legal.module.css` | Obchodní podmínky, ochrana údajů a návrat na web. |

Úplný seznam 105 TSX souborů včetně lokálních UI a importů je v [source-inventory.json](source-inventory.json), klíč `ui_files`. Tabulka výše seskupuje soubory podle odpovědnosti; nezavádí novou adresářovou strukturu ani design systém.

## Formuláře a lokální stav

Převažují React `useState`, nativní input/select/textarea a lokální obsluhy submit; v dependencies není React Hook Form ani Zod. Omezování zobrazení role a disabled stav se často odvozuje z `useAccessProfile`. Validace domény je v `company-validation`, `auth-policy`, `password-policy`, `verification-code`, `invoice-validation`, `payment-validation`, `document-validation`, `bank-accounts`, `company-logo-validation-server` a serverových routách.

Při budoucí extrakci polí zachovat ID/name, label, hlášení, required/optional, autocomplete, datum/číslo/měnu, odesílání Enterem, FormData a focus. Řízení UI není důvod sjednotit různé významy ukládání (např. logo ihned × text šablony tlačítkem).

## Stylová kaskáda a tokeny

Kořen importuje v tomto pořadí: **globals.css → minimal.css → styles/responsive.css → styles/invoice-cards.css**. AppShell navíc používá mobile navigation/workspace background; stránky a komponenty importují CSS Modules. Globální a modulové styly tak působí současně; pořadí souborů ani specificity se nesmějí měnit náhodným přesunem importu.

Aktuální kořenové custom properties v `minimal.css` mimo jiné: `--ink #17251d`, `--muted #66736b`, `--canvas #f5f6f2`, `--paper #fff`, `--green #245f42`, `--green-dark #17462f`, `--green-soft #eaf2ec`, `--red #a7473e`, `--amber #94641e`. To je inventura dneška, nikoli schválení barev 2.0. Hodnoty v historickém brandovém návrhu se liší.

Breakpointy nejsou jen jedna soustava čtyř čísel; existují lokální media queries a pravidla pro nízké okno, tisk a animace. Přesná znění všech nalezených media queries jsou v JSON inventuře. Vizuální ověření musí zachytit obě strany skutečně dotčené hranice, ne pouze referenční velikost iPadu.

## Dotykové oblasti pro malé PR

Největší klientské soubory: GPC panel 1 208 řádků, upomínky 1 128, detail faktury 1 075, onboarding 968. Největší CSS: minimal 4 215, landing 2 706, responsive 2 105, onboarding 1 006. Jde o rozsah zdrojů, nikoli automatický důkaz vady. Extrakci komponent neprovádět zároveň s přesunem API, přejmenováním kontraktů a novým vzhledem.

`SettingsTabs` obsahuje historický společný popisek, ale ve zdrojích nebyl nalezen konzument; skutečná sidebar navigace je v AppShell. Jeho úklid nemá být omylem vydáván za opravu živé obrazovky.

## Úplný přehled stylů

Čísla jsou počty řádků a doslovných výskytů v baseline, nikoli CSS parserem změřená specificity nebo počet vad.

| Soubor | Řádky | `!important` | `@media` |
| --- | --- | --- | --- |
| `src/app/(legal)/legal.module.css` | 65 | 0 | 1 |
| `src/app/(onboarding)/onboarding/onboarding.module.css` | 1006 | 9 | 9 |
| `src/app/(workspace)/dashboard/dashboard-summary.module.css` | 571 | 10 | 3 |
| `src/app/(workspace)/invoices/import/invoice-import.module.css` | 91 | 0 | 5 |
| `src/app/(workspace)/invoices/payments/archive/payment-assistance.module.css` | 13 | 0 | 1 |
| `src/app/(workspace)/invoices/payments/payments-upload.module.css` | 167 | 0 | 9 |
| `src/app/(workspace)/predplatne/predplatne.module.css` | 41 | 1 | 1 |
| `src/app/(workspace)/reminders/company-logo-editor.module.css` | 36 | 0 | 1 |
| `src/app/(workspace)/reminders/email-templates-section.module.css` | 431 | 0 | 1 |
| `src/app/(workspace)/settings/settings-page.module.css` | 509 | 0 | 3 |
| `src/app/globals.css` | 212 | 6 | 24 |
| `src/app/minimal.css` | 4215 | 293 | 53 |
| `src/app/styles/invoice-cards.css` | 366 | 1 | 1 |
| `src/app/styles/responsive.css` | 2105 | 193 | 40 |
| `src/components/auth/auth-shell.module.css` | 794 | 7 | 9 |
| `src/components/esko/esko-assistant.module.css` | 273 | 5 | 3 |
| `src/components/landing/landing-video.module.css` | 55 | 1 | 0 |
| `src/components/landing/landing.module.css` | 2706 | 58 | 40 |
| `src/components/layout/mobile-navigation.css` | 282 | 4 | 3 |
| `src/components/layout/workspace-background.css` | 80 | 0 | 3 |
| `src/i18n/language-switcher.module.css` | 53 | 1 | 1 |
