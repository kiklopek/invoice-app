# Mapa pokrytí a otevřené podmínky

Datum: 2. 11. 2026. `measured` znamená, že byla vykreslena skutečná komponenta ve zdrojovém harnessu a zaznamenána geometrie. Není to schválení designu, plný produkční E2E test ani tvrzení, že všechny stavy prošly funkčními asercemi.

## Povinné chybějící reference

| ID   | Co chybí                                                                           | Důkaz                                                                                                       | Dopad                                                                     |
| ---- | ---------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------- |
| B-01 | Skutečné běžné okno MacBooku: viewport, zoom, browser/OS a interní/externí displej | Uživatelský výstup 440×956/DPR3/UA iPhone identifikuje mobilní emulaci; desktopový výstup zatím nebyl dodán | Žádný odhadovaný rozměr se neuzamyká jako referenční desktop              |
| B-02 | Přihlášená živá produkční reference dashboard/faktury/import                       | Autorizovaná existující testovací session skončila na `/login` pro všechny 3 chráněné stránky               | Izolované snímky přesného commitu nejsou vydávány za přihlášenou produkci |
| B-03 | Fyzické Safari, softwarová klávesnice a nativní browser zoom                       | Desktopová emulace; při změně orientace ve WebKitu se prohlížeč zavřel                                      | Orientace/klávesnice nejsou označeny jako fyzicky ověřené                 |

## Vykreslené obrazovky

Tabulka je generovaná z aktuálních výsledků. Některé šířky se opakují v různých stavech a prohlížečích. `/invoices/detail` je pouze URL alias harnessu pro skutečný dynamický klient faktury, nikoliv nová aplikační route.

| Obrazovka / alias            | Prohlížeče                | Změřené CSS šířky                                                                                                 | Vykreslené varianty                  |
| ---------------------------- | ------------------------- | ----------------------------------------------------------------------------------------------------------------- | ------------------------------------ |
| `/`                          | chromium, webkit          | 390, 768, 1440                                                                                                    | normal                               |
| `/customers`                 | chromium, firefox, webkit | 320, 360, 390, 479, 480, 639, 640, 641, 767, 768, 900, 1023, 1024, 1180, 1279, 1280, 1440, 1600, 1920, 2560, 3840 | empty, error, normal, stress, viewer |
| `/dashboard`                 | chromium, webkit          | 320, 360, 390, 479, 480, 639, 640, 641, 767, 768, 900, 1023, 1024, 1180, 1279, 1280, 1440, 1600, 1920, 2560, 3840 | empty, error, normal, stress, viewer |
| `/en`                        | chromium, webkit          | 390, 768, 1440                                                                                                    | normal                               |
| `/forgot-password`           | chromium, webkit          | 320, 360, 390, 479, 480, 639, 640, 641, 767, 768, 900, 1023, 1024, 1180, 1279, 1280, 1440, 1600, 1920, 2560, 3840 | normal                               |
| `/invoices`                  | chromium, firefox, webkit | 320, 360, 390, 479, 480, 639, 640, 641, 767, 768, 900, 1023, 1024, 1180, 1279, 1280, 1440, 1600, 1920, 2560, 3840 | empty, error, normal, stress, viewer |
| `/invoices/archive`          | chromium, webkit          | 320, 360, 390, 479, 480, 639, 640, 641, 767, 768, 900, 1023, 1024, 1180, 1279, 1280, 1440, 1600, 1920, 2560, 3840 | normal                               |
| `/invoices/create`           | chromium, firefox, webkit | 320, 360, 390, 479, 480, 639, 640, 641, 767, 768, 900, 1023, 1024, 1180, 1279, 1280, 1440, 1600, 1920, 2560, 3840 | normal                               |
| `/invoices/detail`           | chromium, webkit          | 320, 360, 390, 479, 480, 639, 640, 641, 767, 768, 900, 1023, 1024, 1180, 1279, 1280, 1440, 1600, 1920, 2560, 3840 | empty, error, normal, stress, viewer |
| `/invoices/import`           | chromium, webkit          | 320, 360, 390, 479, 480, 639, 640, 641, 767, 768, 900, 1023, 1024, 1180, 1279, 1280, 1440, 1600, 1920, 2560, 3840 | normal                               |
| `/invoices/new`              | chromium, webkit          | 320, 360, 390, 479, 480, 639, 640, 641, 767, 768, 900, 1023, 1024, 1180, 1279, 1280, 1440, 1600, 1920, 2560, 3840 | normal                               |
| `/invoices/payments`         | chromium, webkit          | 320, 360, 390, 479, 480, 639, 640, 641, 767, 768, 900, 1023, 1024, 1180, 1279, 1280, 1440, 1600, 1920, 2560, 3840 | normal                               |
| `/invoices/payments/archive` | chromium, webkit          | 320, 360, 390, 479, 480, 639, 640, 641, 767, 768, 900, 1023, 1024, 1180, 1279, 1280, 1440, 1600, 1920, 2560, 3840 | normal                               |
| `/login`                     | chromium, webkit          | 320, 360, 390, 479, 480, 639, 640, 641, 767, 768, 900, 1023, 1024, 1180, 1279, 1280, 1440, 1600, 1920, 2560, 3840 | normal                               |
| `/mfa`                       | chromium, webkit          | 390, 768, 1440                                                                                                    | normal                               |
| `/notifications`             | chromium, webkit          | 320, 360, 390, 479, 480, 639, 640, 641, 767, 768, 900, 1023, 1024, 1180, 1279, 1280, 1440, 1600, 1920, 2560, 3840 | empty, error, normal, stress, viewer |
| `/ochrana-osobnich-udaju`    | chromium, webkit          | 320, 360, 390, 479, 480, 639, 640, 641, 767, 768, 900, 1023, 1024, 1180, 1279, 1280, 1440, 1600, 1920, 2560, 3840 | normal                               |
| `/onboarding`                | chromium, webkit          | 320, 360, 390, 479, 480, 639, 640, 641, 767, 768, 900, 1023, 1024, 1180, 1279, 1280, 1440, 1600, 1920, 2560, 3840 | normal                               |
| `/podminky`                  | chromium, webkit          | 320, 360, 390, 479, 480, 639, 640, 641, 767, 768, 900, 1023, 1024, 1180, 1279, 1280, 1440, 1600, 1920, 2560, 3840 | normal                               |
| `/predplatne`                | chromium, webkit          | 320, 360, 390, 479, 480, 639, 640, 641, 767, 768, 900, 1023, 1024, 1180, 1279, 1280, 1440, 1600, 1920, 2560, 3840 | empty, error, normal, stress, viewer |
| `/provoz`                    | chromium, webkit          | 320, 360, 390, 479, 480, 639, 640, 641, 767, 768, 900, 1023, 1024, 1180, 1279, 1280, 1440, 1600, 1920, 2560, 3840 | normal                               |
| `/register`                  | chromium, webkit          | 320, 360, 390, 479, 480, 639, 640, 641, 767, 768, 900, 1023, 1024, 1180, 1279, 1280, 1440, 1600, 1920, 2560, 3840 | normal                               |
| `/reminders`                 | chromium, webkit          | 320, 360, 390, 479, 480, 639, 640, 641, 767, 768, 900, 1023, 1024, 1180, 1279, 1280, 1440, 1600, 1920, 2560, 3840 | empty, error, normal, stress, viewer |
| `/reports`                   | chromium, firefox, webkit | 320, 360, 390, 479, 480, 639, 640, 641, 767, 768, 900, 1023, 1024, 1180, 1279, 1280, 1440, 1600, 1920, 2560, 3840 | empty, error, normal, stress, viewer |
| `/reset-password`            | chromium, webkit          | 320, 360, 390, 479, 480, 639, 640, 641, 767, 768, 900, 1023, 1024, 1180, 1279, 1280, 1440, 1600, 1920, 2560, 3840 | normal                               |
| `/settings`                  | chromium, webkit          | 320, 360, 390, 479, 480, 639, 640, 641, 767, 768, 900, 1023, 1024, 1180, 1279, 1280, 1440, 1600, 1920, 2560, 3840 | empty, error, normal, stress, viewer |

## Jak číst varianty

- `normal`: výchozí syntetická data skutečné UI komponenty.
- `empty`: vyprázdnění seznamů/dashboardu/reportů, chybějící historie nebo „missing“ předplatné podle kontraktu. Prázdná firma v settings není samostatně tímto názvem ověřena.
- `stress`: skutečně prodloužené identifikátory/názvy, velké částky a kontakty u dashboardu, faktur/detailu a zákazníků. Ostatní komponenty mají ve variantě část stejných údajů; název varianty sám neprokazuje zatížení každé komponenty.
- `viewer`: prezentace s viewer profilem a příslušnými datovými flags. Neověřuje serverové vynucení oprávnění ani oprávněnost přístupu na stránku.
- `error`: řízené HTTP 503 pro mapované endpointy. Pokud UI nerevaliduje initialData a žádný požadavek nevznikne, nejde o otestovanou chybovou obrazovku. Dashboard alert a deep OCR/payment chybové scénáře mají přímé důkazy; ostatní chyby musí být vázány na konkrétní další interakci.
- Matrix bez touch flagu měří úzký viewport se standardním pointerem. Samostatná touch matice aktivuje coarse-pointer pravidla. Žádná emulace netvrdí přítomnost skutečné softwarové klávesnice.

## Rozšířený audit vstupních stránek

[Login, registrace, MFA, obnova hesla, firemní vstup, pozvánky a všech osm kroků onboardingu](AUTH_ONBOARDING.md) mají samostatnou specifikaci, syntetickou galerii a doplňující kontrolní scénáře.

## Interakce s přímým důkazem

Viz `interactions/results.json`: otevření/zavření navigace, scroll lock, mobile row menu, native dialog úhrady, přístup ke kontaktům, malý notebookový table scroll, native validace a zachování rozepsané položky. Orientace Chromium je emulované ověření; WebKit je neúspěšný environment check. Root rem-only enlargement a skutečné zdvojení computed fontů jsou rozlišeny, nejsou vydávány za totéž.

`deep-workflows/ocr-review/validation.json`: 5 viewportů + 13 funkčních scénářů. `deep-workflows/ocr-processing/validation.json`: 8 scénářů reálné fronty/processing/recovery. `deep-workflows/payment-matching/validation.json`: 6 viewportů a další scénáře výběru, filtrů, chyby uložení, bankovní brány a dialogů. Jde o reálné komponenty s řízenými dokumentovými/API odpověďmi, nikoliv skutečné OCR, storage, účetnictví nebo rozesílání.

## Co zůstává omezené či statické

- Firemní login/registrace a pozvánky: doplněné skutečné klientské komponenty se syntetickým brandingem a pozvánkou, včetně prošlé pozvánky a jiného účtu. Skutečná serverová tenant/invitation URL a přijetí neověřeny; viz [samostatný audit](AUTH_ONBOARDING.md).
- Operátorská stránka: UI se syntetickými organizacemi; skutečné operator autorizační/data dotazy neověřeny.
- Onboarding: doplněno všech osm kroků a zachování draftu mezi kroky/šířkami. Skutečné vytvoření firmy, platební onboarding session a dokončení Stripe neověřeno.
- Auth/MFA/password reset: vykreslené klienty a syntetické stavy; neproběhlo skutečné odeslání kódu, přihlášení ani změna hesla.
- Next/font na auth/landing a serverové layouty nejsou v harnessu kompletně reprodukované. Veřejné živé stránky mají samostatné produkční snímky; chybějící chráněné stránky nikoliv.
- Základní matice není úplný kartézský součin všech datových/rolových stavů, šířek a prohlížečů. Print, fyzická klávesnice a další otevřená menu vyžadují doplnění dle komponentové specifikace.
- Pixelové regresní aserce proti schválenému desktopu jsou připravené, ale zatím blokované manifestem `not_approved`. Nejsou označeny jako úspěšně proběhlé.

## Klasifikace stavů dokončení

`verified-render` = reálné UI/zdroj + záznam; `verified-interaction` = konkrétní aserce; `source-only` = statické čtení; `environment-limited` = nástroj/prohlížeč nepokrývá prostředí; `not-captured` = chybí reference/přístup; `proposed` = návrh pro další implementaci. Tyto kategorie se neslučují do jediného zeleného „pass“.
