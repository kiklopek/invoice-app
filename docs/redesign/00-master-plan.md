# SPLATNO 2.0 — MASTER PLÁN REDESIGNU PRO CODEX

**Účel:** Řízený, auditovatelný a postupný redesign celé webové aplikace Splatno podle schválených mockupů, bez neúmyslných změn obchodní logiky, backendu, bezpečnosti, dat a responzivity.

**Status:** Implementační plán, nikoli potvrzení současné architektury. Názvy cest, knihoven a testovacích příkazů Codex nejprve zjistí z repozitáře. Pokud se specifikace a skutečný kód rozcházejí, zastaví dotčený krok, popíše rozdíl a navrhne bezpečné řešení.

## A. Produktové hranice a designový směr

Splatno je primárně **aplikace na evidenci vydaných faktur, sledování pohledávek, párování přijatých plateb a automatické upomínání**. Nejde automaticky o systém pro vytváření a rozesílání účetně/daňově platných faktur. Obrazovka „Přidat fakturu“ znamená primárně **zadat existující fakturu ke sledování**, nikoli vystavit nový daňový doklad. Jakýkoli skutečný modul vystavování faktur je mimo scope, pokud ho repozitář výslovně obsahuje a uživatel neschválí jeho redesign.

**Schválená vizuální pravidla:** jemné organické světle zelené pozadí podle dashboardu a landing page, téměř bílé povrchy, střídmá zelená pro primární akce a aktivní stavy, tenké linky, decentní stíny, jasná typografická hierarchie, dostatek whitespace, přiměřeně kompaktní data, omezené množství karet a tlačítek. Zobrazit jen údaje potřebné pro aktuální rozhodnutí (progressive disclosure), ale nikdy neztratit důležité funkce. Světlý levý sidebar pro hlavní sekce; uživatelský profil pouze vlevo dole. AI asistent **Eško** jako nenápadný plovoucí ovladač vpravo dole. Horní lišta neobsahuje druhý uživatelský profil. Vzhled navazuje na landing page; není cílem ji slepě kopírovat do datově intenzivních obrazovek.

**Komponenty a pravidla:** jedna globální sada design tokens (barvy, typography, scale, radius, shadow, z-index, transitions), sdílený AppShell (sidebar/topbar/content/mobile nav), přístupné univerzální prvky (button, input, select, calendar, tabs, badge, card, table, toast, dialog, drawer, upload, progress, empty state, skeleton), doménové komponenty (invoice status, currency amount, payment match, reminder timeline, document viewer). Preferovat současné knihovny, pokud jsou vhodné; nezavádět novou UI knihovnu nebo framework bez doložené potřeby a schválení.

## B. Nepřekročitelné bezpečnostní mantinely

1. **Backend first-class invariant:** neměnit Supabase schéma, RLS, role, auth flow, tenant isolation, Edge Functions, platební bránu, harmonogram a algoritmus upomínek, OCR službu, matching algoritmus, finanční výpočty a API kontrakty pouze z důvodu vzhledu. Pokud nový UI koncept vyžaduje změnu kontraktu, vytvořit samostatný návrh a vyžádat schválení.
2. Neměnit interpretaci dat, algoritmus zaokrouhlování, měny, formát peněz, desetinná místa, datumové zóny a počítání částečných úhrad.
3. Neprovádět produkční mutace, nemazat firemní data, neposílat reálné e-maily a nespouštět skutečné inkaso/platby při testování. E2E provádět izolovaně se syntetickými daty a bezpečným režimem odesílání.
4. Před změnou každé trasy zachytit její dosavadní kontrakt: validace, loading, empty, error, permissions, keyboard, mobile, mutace, exporty a překryvné dialogy.
5. Nevypouštět funkce jen proto, že nejsou vidět na mockupu. Mockup je **vizuální reference**; jako autorita pro chování platí fungující současná aplikace a odsouhlasená specifikace.
6. Mockupy mohou mít vymyšlená jména, částky, nesrovnalosti i neexistující tlačítka. **Nepřenášet placeholdery a imaginární workflow do produkčních dat a logiky**. Ukázkové datumy/částky používat jen ve storybook/demo/test fixtures.
7. Časté malé commity, jednoznačně oddělené PR, žádný big-bang přepis. Každý podplán po dokončení projde build/lint/typecheck/testy, vizuální kontrolou i manuálním smoke testem.
8. Pokud nejsou dostupné testy či vývojové závislosti, nepředstírat jejich úspěch: dokumentovat mezeru, sestavit kontrolovaný náhradní postup a nevydávat fázi za dokončenou.

## C. Jak pracovat s mockupy a zadáním

Do repozitáře založ `docs/redesign/`:

```text
docs/redesign/
  00-master-plan.md
  01-screen-inventory.md
  02-design-contract.md
  03-route-and-contract-map.md
  04-component-inventory.md
  05-testing-matrix.md
  06-progress.md
  07-decisions.md
  prompts/phase-template.md
  phases/P00-audit.md ... P18-release.md
  screens/<slug>/spec.md
  screens/<slug>/desktop.png
  screens/<slug>/mobile.png (pokud existuje)
  screens/<slug>/acceptance.md
```

* Při každé implementaci Codex dostane (i) MASTER PLÁN, (ii) podplán konkrétní fáze, (iii) mockup(y), (iv) existující kód a související testy. Nemá-li obrázek mobilní variantu, odvodí breakpointové chování ze schváleného design systému a stávající UX, nikoli z kreativního odhadu, který by skryl funkce.
* Každý screenshot připojit pod stabilním názvem, např. `screens/payments-upload/desktop-approved.png`; uvést, zda jde o schválený návrh, experiment nebo screenshot starého UI. Nedovolit záměnu.
* Zdrojový seznam obrazovek ze zadání převést do `01-screen-inventory.md` a ke každé položce evidovat `route`, `owner`, `mockup`, `status`, `functional contract`, `states`, `responsive`, `tests`, `last verified`.
* Na každé stránce udržovat samostatně **funkční akceptaci** a **vizuální akceptaci**. Schválení vzhledu není souhlas s odstraněním funkcí.

## D. Úvodní průzkum: P00 — pouze audit, žádný redesign

**Cíl:** reálný technický obraz repozitáře. Výstupy: mapa tras (včetně deep linků a autentizačních obrazovek), strom frontendových komponent, data hooks, UI knihovna, CSS/styling, typové kontrakty, test framework, CI, stav responzivity, kritické business flows, seznam rizik.

**Úlohy:**
1. Zkontrolovat git stav a práci ostatních. Vytvořit pracovní větev po souhlasu. Nezahazovat cizí změny.
2. Zjistit skutečný framework/router (Next, React apod.), architekturu sty­lů, stavovou správu, i18n, komponentovou knihovnu, ikonky, testovací nástroje, aktuální build příkazy.
3. Zmapovat route za route veřejný web, auth, onboarding, app, admin, výstupní šablony. Pro každou trasu popsat navázané efekty.
4. Sepsat bezpečnostní a datové hranice: tenant ID, RLS, session, reset password, pozvánky, bankovní účty, platební importy, OCR, reminder jobs, billing.
5. Screenshot baseline pro desktop 1440–1600, tablet ~768–1024, mobil ~375–430; se seedovanými bezpečnými daty. Zajistit konzistentní testovací data.
6. Identifikovat duplicity design tokenů a komponent; určit migrační pořadí dle závislostí.
7. Připravit smlouvu o stabilitě backendu a testovací plán. Nezačínat měnit JSX bez schválení výstupů P00.

**Gate P00:** audit má všechny trasy, kritické end-to-end cesty, známé testovací příkazy a seznam nejistot; dokument je revidovaný uživatelem.

## E. Globální infrastruktura: P01–P04

### P01 — Design tokens a vizuální základ
* Extrahovat paletu a charakter z LANDING PAGE a schválených dashboard/invoice mockupů (neodvozovat přesné HEX jen z JPEG bez ověření). Navrhnout semantic tokens: canvas, surface, surface-muted, text, text-secondary, border, brand-primary, success, warning, danger, focus, shadow, radius, spacing, typographic scale.
* Zavést light theme a jasně stanovené kontrasty; nezhoršit čitelnost kvůli pastelovým barvám. Rozlišit dekorativní background od kontejneru pro interaktivní obsah.
* Žádné bezhlavé globální CSS přepisy. Ověřit landing, auth, PDF, e-mail HTML a print styl.
* Zajistit jednotnou podporu `prefers-reduced-motion`, `:focus-visible` a kontrastu.
* Visual smoke: porovnání před/po na bezpečné demonstraci komponent.
**Gate:** stylové tokeny existují a legacy obrazovky se nerozbily.

### P02 — Sdílené UI komponenty
* Inventarizovat stávající prvky a vyrobit/adaptovat ty chybějící: button, icon-button, inputs, field (label/help/error), combobox/search, multi-select, date/range, switch, tooltip, dropdown, tabs, badge, dialog/confirm, drawer, uploader, file list, breadcrumbs, pagination, sortable table, charts wrappers, currency/date labels, form sections, toasts, skeleton/empty/error.
* API komponent zachovává přístupnost, disabled/loading/busy states, validaci a ref forwarding podle potřeby.
* Unit + interaction tests: tab order, keyboard, Escape, focus trapping v dialogu, disabled state, screen-reader labels, error association, touch target.
* Příklady/showcase komponent (pokud je v projektu Storybook nebo obdobný nástroj; nepřidávat automaticky novou závislost).
**Gate:** komponentová sada schválená na showcase, bez regresí stávajícího UI.

### P03 — Společný AppShell, navigace, Eško
* Jedna desktop navigace, aktivní route, žádné duplicitní avatary nahoře, firemní účet pouze ve spodní části sidebaru, role a přepínání firmy dle skutečné logiky.
* Topbar: hledání jen pokud existuje funkční endpoint/logika; import/primární akce mají kontextové chování. Nepřidávat mrtvé ovladače.
* Globální jemný wave background, správné stacking contexts, overflow, sticky header a pravý dolní floating Esko; Eško nesmí blokovat save/export/toast ani mobilní navigaci.
* Responsivita: desktop sidebar, tablet collapse, mobilní drawer/bottom nav (dle schválené varianty), touch, safe area, správné focus/scroll při otevření menu.
* Role- and tenant-aware navigace; udržet stávající deep links.
**Gate:** průchod všech interních tras ve 3 breakpointech a role-specific test.

### P04 — Testovací kostra, baseline a rollout mechanismus
* Udržet/rozšířit unit a integrační testy; Playwright E2E pro klíčové flows; visual regression snapshots v desktop/tablet/mobile.
* Syntetické bezpečné fixtures: 0 faktur, mnoha faktur, dlouhé názvy, 9místné částky, multi-currency, negativní/vratky, částečně zaplaceno, rozdělené párování, chyby OCR, expirace session.
* Při implementaci neaktivovat reálné emailové/job side effects. Vizuální screenshoty generovat proti stabilním fixtures.
* Připravit variantní rollout / route-level feature flag jen pokud technicky dává smysl; jinak řízená migrace s reverzibilními PR.
**Gate:** baseline scénáře běží na CI nebo jsou zdokumentované spolehlivé lokální instrukce; rollback existuje.

## F. Implementace po funkčních blocích: P05–P16

U KAŽDÉHO bloku se opakuje sekvence: **read code → write spec → attach mockup → implement presentation layer → preserve hooks/contract → tests → 3 breakpoint screenshots → review → commit → update checklist.** Každý blok ideálně dělit na dílčí PR označené `Pxx.A`, `Pxx.B` atd.

### P05 — Dashboard (mockup schválen)
A. Přehled s daty: greeting/summary, hlavní částky, overdue, zaplaceno, relevantní akce. Nezobrazovat nic fiktivního.
B. Grafy a nejbližší splatnosti, priorita práce; standardní report filters jen existují-li.
C. Prázdná firma, loading, error, role restrictions, dlouhé názvy, mobilní karty.
D. Eško floating widget dle P03; nepřidávat obří chat panel na dashboard.
**Gate:** KPI se shodují s realnými daty a stávajícími výpočty, CTA fungují.

### P06 — Seznam faktur a archiv
A. Aktivní seznam: kompaktní tabulka, hledání, filtry, sorting, pagination, export, multi-status a rychlé akce.
B. Řádky: neuhrazeno, částečně, po splatnosti, zaplaceno, zobrazení úhrad a upomínek; bez odstraňování existujících možností.
C. Archiv: zaplacené/stornované, stejné komponenty jako seznam, specifické filtry a datum úhrady.
D. Confirm dialogy, bulk actions, empty/no-results, mobilní karty, dlouhé texty/částky.
**Gate:** filtry/počty/řazení odpovídají původním datům a exporty se neliší.

### P07 — Ruční přidání a detail faktury
A. **Ruční zadání stávající faktury ke sledování**: číslo/VS, odběratel, kontaktní e-mail, datum vystavení/splatnosti, částka/DPH/měna, reminder category, poznámka. CTA „Uložit a začít sledovat“. Žádná povinná tvorba PDF/fakturačních položek bez existující business potřeby.
B. Detail: klíčové číslo, zůstatek, stav a datum; záložky Přehled/Platby/Upomínky/Dokumenty/Historie, progressive disclosure.
C. Editace, potvrzení úhrady ručně/nebo přiřazením, návrat mezi neuhrazené, storno, delete, email, file preview/missing file a interní poznámka.
D. Částečné úhrady, rozdílné měny, negativní/velké částky, externí OCR původ, duplicity, validity.
**Gate:** žádná mutace se nespustí jinak než v původním workflow; auditní historie a reminder semantics zachované.

### P08 — Import faktur + OCR (schválený minimalistický upload)
A. Upload screen: dvě volby „Dokumenty faktur“ vs „Hromadný CSV import“; jeden drag-drop prostor, jasné limity/formáty; pouze kompaktní indikátor zpracování, **bez samostatného dashboardu progress barů a historie importů**.
B. Single OCR review: vlevo editovatelná data, vpravo originální PDF/viewer, rozlišení verified/uncertain; zachovat korekci OCR; ovládání vícestránkového PDF.
C. Multi-OCR queue: seznam souborů/rozpracovaných faktur, krokové review/save-skip, varování chybných údajů a návrat bez ztráty konceptu dle současné logiky.
D. CSV preview/mapování, validace řádků, konflikt/duplicity, partial success a dokončení.
E. Mobil: přepínač Údaje/Doklad, persist form state, error focus, zoom PDF.
**Gate:** OCR a import validace identické baseline; žádné poškozené dokumenty či duplicitní vložení při retry.

### P09 — Nahrání bankovního výpisu (schválený upload)
A. GPC a CSV jako dvě jasné volby, jeden dropzone, bez zbytečného vysvětlovacího panelu.
B. Zachovat více souborů, omezení typů/velikosti, správnou interpretaci českých výpisů, status loading/error, detekci banky a ověření účtu, duplicate prevention.
C. Zpracování indikovat jedinou stavovou zprávou; po úspěchu přechod do kontrolní pracovní plochy.
**Gate:** stejné parsed transactions, bank account verification a žádné nechtěné zaúčtování před potvrzením.

### P10 — Párování bankovních plateb: kontrola
A. Kompaktní list transakcí s filtry Vše / Spárováno / K potvrzení / Nespárováno / Ignorováno, detail vybraného řádku vpravo; bez duplicity filtrování a přehnaných KPI.
B. Stav jednoznačné shody, návrhu, chybného VS, duplicity, ignored, bank fee, převodu mezi účty.
C. Manuální přiřazení faktury: searchable chooser, částky, multiple suggestions, vazba na zákazníka, clear/undo.
D. Rozdělení platby, částečné úhrady, mismatch amount, více faktur; zachovat edge-case pravidla systému.
E. Potvrzení celého batch procesu + správně odlišit „navrženo“ od „zaúčtováno“ a výsledné counts.
F. Problém s účtem/bankou, částečný úspěch, retry, batch více výpisů, změna výběru bez ztráty práce.
**Gate:** golden fixtures proti stávajícímu matching enginu; no double-posting a idempotence.

### P11 — Historie plateb a archiv bankovních výpisů
A. Historie transakcí: hledání podle protistrany/VS/faktury, filtry, sort, převody, spárované/rozdělené/nejednoznačné/nespárované.
B. Detail transakce, přiřazené faktury, uvolnění a opětovné přiřazení pouze dle role a původních práv.
C. Archiv originálních výpisů (ke kontrole/zaúčtovaný/zahozený), stažení původního souboru, bezpečné potvrzení zahození.
D. Empty/error/mobilní karty a dlouhá jména.
**Gate:** změny párování se projeví správně ve fakturách, reportech i auditu.

### P12 — Zákazníci
A. Seznam s hledáním, sorting, počty, IČO/DIČ, kontakty, fakturace, otevřený dluh, kategorií upomínek, poslední faktura, export.
B. Inline/modal editace e-mail/telefon, chybějící kontakty, validace; po kliknutí navigace na **filtrované faktury zákazníka**, ne vymýšlená nová stránka detailu.
C. Mobilní karta, prázdný stav, delší názvy, vysoké částky.
**Gate:** žádné jiné osoby/firemní účty, permissions a kontaktní adresy pro upomínky zachované.

### P13 — Reporty
A. Tabs Tržby/DPH/Pohledávky/Platby v souladu se skutečným kódem; případný přehled dlužníků jen pokud existuje (jinak návrh samostatně).
B. Period range, issued/due date semantics, měna, odběratel, status; sdílený filter panel jen pokud opravdu snižuje složitost.
C. KPI, grafy, tabulky, export Excel/print PDF, empty period, dlouhé názvy, mobil.
D. Srovnat všechny agregace s baseline. Nesčítat nekonvertované měny do jedné částky; nerozbít DPH a partial payments.
**Gate:** přesná shoda výpočtů a exportovaných dat.

### P14 — Upomínky + e-mailové šablony
A. Nastavení automatizace: zapnuto/pozastaveno, kategorie a výchozí kategorie, harmonogram, přidání/úprava termínů, preview procesu, ruční kontrola.
B. Provozní přehled: plánované/odeslané/neúspěšné, doručení, blokované adresy, unblocking, historie.
C. Čtyři e-mailové šablony před/v den/po/důrazná, editor s proměnnými, reset textu, reply-to/CC, logo, QR platební údaje, náhled, testovací odeslání.
D. Mobilní editor vs náhled, empty/error states, správné oprávnění.
E. Bez změny frekvence jobů, scheduleru, odesílacích pravidel, prevent duplicate-email safeguards.
**Gate:** test režim bez ostrého e-mailu; porovnat skutečně vyrenderované e-maily, proměnné a QR.

### P15 — Nastavení firmy, účtu, týmu a oprávnění
A. Firma: identita, fakturační a kontaktní údaje, bankovní účty a DPH, přidání/odebrání účtu.
B. Tým: seznam členů, pozvání, čekající/prošlé pozvánky, role, rescind/resend, remove, historie přístupů.
C. Support access: grant/revoke v souladu s bezpečností a auditními záznamy.
D. Neuložené změny, validace, obnovování draftů, access denied, jiný tenant, mobil.
**Gate:** test matrix owner/admin/member/view-only; žádná privilege escalation ani cross-tenant leakage.

### P16 — Předplatné/billing
A. Trial, usage limit, active, overdue payment, plan period, tarifní nabídka, připravená/plánovaná změna, cancel/reactivate, checkout redirect/return.
B. Ceny, limity, daně a oprávnění vycházejí **výhradně ze skutečných backendových a billing dat**, nikoliv z mockupu.
C. Neúspěšná platba, zpracování, retry, změna karty, billing notices.
**Gate:** testovací režim poskytovatele, žádné ostré charge; trial/plan entitlements stále chrání server.

## G. Pomocné a okrajové oblasti: P17

P17 je soubor samostatných podplánů; žádný nesmí být považován za dokončený jen proto, že hlavní desktop UI vypadá dobře.

* **P17.A — Landing a veřejný web:** CZ `/`, EN `/en`, obchodní podmínky, soukromí, všechny landing sekce, video modal, cookies/SEO/semantics, footer, mobil.
* **P17.B — Auth:** login, registrace, ověřovací kód, MFA, forgot/reset, invitation accept/existing/expired, varianty Hlavica, chyby/rate limits a focus management. Už dříve stylově blízké landing; měnit jen kvůli konzistenci, jinak zachovat.
* **P17.C — Onboarding 8 kroků:** firma, kontakt, banka, upomínky, logo, tým, shrnutí, tarif/karta. ARES success/error/loading, recovery draft, validace, payment failure; nenarušit data/přechod kroků.
* **P17.D — Interní konzole:** search companies, support impersonation/temporary access, vstup/ukončení, RBAC, audit.
* **P17.E — Společné stavy:** 404, forbidden, no data, loading, session expired, modal, confirmation, toast, error banners, dialogs, toast z-index, offline/retry, banners billing/support; Eško closed/open/typing/error a permission-aware data access.
* **P17.F — Output templates:** transakční e-maily, pozvánky/reset, 4 upomínky, invoice email, případná PDF faktura jen pokud existuje, report print/PDF; e-mail client/print rendering a neporušené proměnné.
* **P17.G — Responsive & accessibility audit:** všechny obrazovky 320/375/430/768/1024/1440/1600, zoom 200 %, keyboard only, WCAG 2.2 AA cílově (ověřit dosaženou shodu), screen reader, reduced motion, high-data stress.

## H. P18 — Integrační verifikace, performance, release

1. Zkontrolovat všech 18 kapitol inventáře a jejich varianty; každá má status schváleno / nehotovo / blokováno s důvodem.
2. E2E kritické cesty: register→onboard→import OCR→review→save→bank GPC import→match→confirm→invoice paid→report; reminder schedule→test send→pause; role invitation→RBAC; trial→checkout callback (sandbox).
3. Cross-screen invariants: zaplacená faktura zmizí z otevřených pohledávek, historie zůstává; upomínky nechodí zaplaceným; reporty odpovídají; archiv ukazuje auditní souvislosti.
4. Technika: typecheck, lint, unit/integration/e2e, visual snapshots, a11y, responsive overflow, screenshot diff, Lighthouse/performance budget dle baseline, PDF/print, i18n CZ/EN.
5. Bezpečnost: review datových přístupů a permissions, form injection/XSS, bezpečné odkazy, storage permissions, bank statement and OCR upload restrictions. Redesign nesmí vypnout guardy.
6. Rollback: branch/commit/tag, postup revertu, feature flag disabling (pokud implementováno); nasadit staging; user acceptance sign-off; release po krocích a monitoring errors.
7. Dokončit `docs/redesign/06-progress.md` a report `release-readiness.md` s průkaznými testy, screenshoty, známými nedostatky.

## I. Standardní akceptační brána KAŽDÉ podfáze

Podfáze není hotová, dokud:

- [ ] přesně uvede, které trasy/komponenty měnila a proč;
- [ ] popíše zachovaný kontrakt čtení a mutací (včetně chyb, loading a oprávnění);
- [ ] vysvětlí odchylky od mockupu a od původního UI;
- [ ] funguje desktop, tablet i mobil a žádný zásadní CTA není překryt;
- [ ] projde klávesnice, screen-reader popisky, viditelný focus, chybové hlášky;
- [ ] projdou dostupné příkazy build/typecheck/lint/test včetně domain smoke;
- [ ] výstupy mají screenshoty před/po a verifikační poznámku;
- [ ] nepřibyly backend/schema/RLS/API změny bez schválení;
- [ ] je aktualizován inventory, rozhodnutí a changelog;
- [ ] změna je samostatně rollbackovatelná a čeká na design acceptance uživatele.

## J. Rozdělení práce do malých Codex úkolů

**Rozumný rozsah jedné iterace:** 1 obrazovka nebo 1 logicky propojená komponentová rodina; při riskantní logice 1 stav/flow. Codex nemá implementovat P08 až P16 v jednom promptu. Každý PR: zmapování → implementace → testy → report. Pokud testy selžou, nedělat další fázi, dokud není jasná příčina. Při nedostatku vstupu: vyžádat mockup/spec nebo zaznamenat blocking question.

**Závislosti:** P00 → (P01 + P04) → P02 → P03 → (P05–P07, P12–P13 částečně paralelně) → P08–P11 podle logiky workflow → P14–P16 → P17 → P18. Závislosti fakticky ověřit po auditu.

**Definice „kompletní redesign“:** ne pouze hlavní desktop screenshoty, ale všechny reálné trasy, dialogy, responsivní varianty, prázdné/loading/error stavy, auth/role, e-mail a print výstupy a prokazatelná funkční regresní kontrola. Automatizovaný test ≠ záruka nulových chyb; jde o měřitelnou ochranu a kontrolovaný rollout.

## K. Úvodní prompt pro Codex (spouštět jako první)

> Jsi lead frontend architekt Splatno. Přečti `docs/redesign/00-master-plan.md` a existující checklist všech obrazovek. Aktuální úkol je **výhradně P00 audit**. Prozkoumej skutečný repozitář a vytvoř route map, kontrakty integrací, seznam společných komponent, katalog stavů a test matrix. Nic vizuálně nemigruj, neměň backend, žádné závislosti nepřidávej bez důvodu. Sepiš plán bezpečných PR, rizika, otevřené otázky a doklady o dostupných testech. Po auditu zastav a vyžádej schválení.

## L. Prompt pro každou další iteraci (zkopírovat a vyplnit)

> **Kontext:** Splatno 2.0. Přečti MASTER PLÁN, rozhodnutí v `07-decisions.md`, přehled dokončených fází a plán `[PXX-podplán]`. K dispozici jsou mockupy `[konkrétní soubory]`, jejich status je `[schválený / draft]`.
>
> **Scope:** Implementuj pouze `[konkrétní route/komponentu/stav]`. Nikam jinam nesahaj, pokud to není nezbytná sdílená závislost; takovou změnu předem vypiš.
>
> **Před psaním kódu:** Zmapuj současné chování v dané trase včetně hooks, APIs, mutací, validation, loading/error/empty, roles a responsive; vypiš design→behavior mapping a test case checklist.
>
> **Implementace:** Přenes vzhled schváleného mockupu, použij shared tokens/components, zachovej skutečná data a každou funkci. Nepřidávej mockupové fake features ani nevytvářej nový business proces. Všechny legacy akce musí být dostupné, případně schované v menu nebo v záložce.
>
> **Ověření:** Spusť relevantní typecheck/lint/test/build, kritické UI testy, desktop/tablet/mobile screenshoty a a11y smoke. Zvlášť ověř obchodní funkčnost popsanou v podplánu. Uveď neprovedené testy.
>
> **Výstup:** (1) shrnutí změn, (2) seznam souborů, (3) výsledky testů s příkazy, (4) screenshoty/diffy, (5) zachované invariants, (6) rizika/otázky, (7) aktualizovaný checklist, (8) návrh jednoho malého navazujícího kroku. **Nezačínej automaticky další podplán.**

## M. Registr mockupů — výchozí stav podle dosavadní konverzace

**Máme návrhy (nutné evidovat konkrétní schválenou verzi):** dashboard; seznam faktur; detail faktury (zjednodušená verze); ruční přidání ke sledování; import OCR jednoduchý; OCR review single a multi; import GPC/CSV jednoduchý; kontrola/párování (zjednodušená verze); přehled upomínek; reporty — Tržby.

**Ještě vyžadují samostatný schválený mockup nebo přesnou komponentovou specifikaci:** archiv faktur; historie plateb a archiv výpisů; nejasná platba a split/partial; dokončení párování; zákazníci; reporty DPH/pohledávky/platby; editace kategorií upomínek; šablony e-mailů; nastavení firmy/týmu; předplatné; další varianty z původního 18sekčního checklistu; mobilní/empty/error/dialog stavy. Původní screenshoty existují jako funkční reference; nepovažovat je za schválené nové mockupy.

Poznámka: Před redesignem připravit pro každý mockup `spec.md` s mapováním reálných ovládacích prvků a zachovaných funkcí. Povinné zvláště u vzájemně podobných výstupů „nová faktura“ vs „přidání existující faktury“.
