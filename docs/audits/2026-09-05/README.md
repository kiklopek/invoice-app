# Audit Splatno — 5. 9. 2026

## Závěr a rozsah

**Aplikaci nelze zatím označit za kompletně ověřenou pro ostrý provoz.** Technické kontroly prošly, ale audit našel reprodukovatelné chyby interakcí a bezpečnostní/provozní rizika. Chybí oddělený staging a přístupy k testovacím účtům, takže trvalé zápisy a úplné přihlášení nebyly ověřeny.

Audit dostupného rozsahu je dokončen. Nepokračovalo se od začátku: po požadavku na úsporu se prověřily jen zbývající interakce a změněné cesty souborů. Nálezy nebyly opraveny. Na samostatný požadavek uživatele byly uspořádány přihlašovací stránky a komponenty rozložení; veřejné URL zůstaly stejné.

Použitá prostředí:

- Izolovaná lokální kopie bez `.env.local`, databázových klíčů a odesílání e-mailů; prohlížečové scénáře pracovaly s demo daty a demo administrátorem.
- Stávající lokální server: pouze zobrazení loginu bez přihlášení.
- Připojený hlavní Supabase projekt: jen čtení metadat, RLS, oprávnění a Advisorů. Žádné změny ani čtení obsahu faktur.
- Byla nalezena pouze hlavní databázová větev. Testovací role a hesla nebyly dostupné. Dotaz na staging zůstal bez doplněných přístupů.

## Potvrzené chyby

| ID / priorita | Chyba a reprodukce | Očekávané / skutečné chování | Doporučení |
|---|---|---|---|
| F01 / P1 | Faktury → Nová faktura → vyplnit číslo → tlačítko prohlížeče Zpět | Varovat před ztrátou rozepsaných dat / stránka odejde bez dialogu | Pokrýt historii prohlížeče nebo automaticky uchovávat koncept. `use-unsaved-changes.ts` zachytává kliknutí na odkazy a unload, nikoli klientský návrat historií. |
| F02 / P2 | Seznam faktur ukazuje v menu 3 → otevřít detail neuhrazené faktury | Celkový počet zůstane 3 / změní se na 1 | Neposílat z detailu hodnotu 1 jako globální počet; společný údaj získávat z agregace. |
| F03 / P2 | Detail → Potvrdit úhradu → Escape | Dialog se zavře / zůstává otevřený | Sjednotit platební dialog s přístupným dialogovým komponentem, ošetřit Escape a focus. Kliknutí na Zrušit funguje. |
| F04 / P1 pro lokální testování | Otevřít aplikaci přes `http://127.0.0.1:3100`; POST `/api/auth/access` s týmž Origin | Vlastní požadavek projde / 403 `origin_denied`; menu se nenaplní | Prověřit sestavení `request.url` a kanonický host za proxy. Tentýž endpoint s Origin `http://localhost:3100` vrací 200. Neřešit vypnutím kontroly původu. Playwright v projektu používá právě 127.0.0.1. Dopad na veřejnou doménu nebyl ověřen. |

Důkazy: `interactions.json`, `follow-up.json`, `browser-results.json`; F04 byl reprodukován dvěma lokálními HTTP požadavky. V prvním běhu byly 403 na všech pracovních stránkách; při použití localhost tyto chyby zmizely.

## Potenciální a konfigurační problémy

| ID / priorita | Zjištění | Jistota a potřebné ověření |
|---|---|---|
| R01 / P1 | Vlastní e-mailové MFA a preference relace se kontrolují v aplikaci, ale databázové čtení používá členství podle JWT bez těchto kontrol | Živá metadata potvrzují `SELECT` pro authenticated a RLS `private.is_org_member`; helper kontroluje ID/e-mail člena. To vytváří cestu přímého čtení Data API mimo aplikační MFA. Praktický pokus s tokenem před MFA nebyl proveden — ověřit jako první na stagingu. Totéž platí pro přísnější omezení čtenáře v UI oproti přímému čtení tabulek organizace. |
| R02 / P1 | `.env.local` není platná produkční konfigurace | Samostatná validace potvrzuje chybějící `EMAIL_MFA_SECRET` a neprázdné `EMAIL_MFA_BYPASS_EMAILS`. Netvrdí to nic o hodnotách nasazených ve Vercelu. Ověřit produkční prostředí bez zveřejnění tajných hodnot. |
| R03 / P1 | CI používá `AUTH_EMAIL_DELIVERY_ENABLED=false`, ale produkční validátor vyžaduje `true` | Přímé zavolání validátoru s hodnotami CI vrací chybu. Build přitom lokálně prošel: wrapper validuje prostředí dříve, než Next nastaví production a načte `.env.local`. Úspěšný build tedy nedokazuje validní konfiguraci. Sjednotit načtení prostředí a validační režim. |
| R04 / P2 | Supabase má vypnutou ochranu proti uniklým heslům | Potvrzené WARN z Security Advisoru. [Dokumentace](https://supabase.com/docs/guides/auth/password-security#password-strength-and-leaked-password-protection). |
| R05 / P2 | Po simulovaném HTTP 401 přehled zůstává na původní stránce | Reprodukováno v demo UI; úplné chování vypršení skutečné relace není ověřeno. `apiFetch` obsahuje přesměrování a timeout, ale stránky tuto utilitu nepoužívají. Prověřit sjednocené zacházení s 401 a časové limity běžných fetch požadavků. |
| R06 / P2 | Test zachování menu má nejednoznačný selektor odkazu na `/dashboard` | Logo i položka menu mají stejné href; vlastní auditní skript narazil na dvě shody. Projektový `e2e/smoke.spec.ts` používá obdobný selektor. Auditní skript byl zpřesněn na `.sidebar nav a`; aplikační test ponechán beze změny v souladu s režimem auditu. |
| R07 / P2 | Některá databázová oprávnění jsou širší než potřebuje web | Metadata u faktur, organizací a členství ukazují vedle SELECT i TRUNCATE/REFERENCES/TRIGGER pro anon/authenticated. Nebyla provedena žádná destruktivní operace. TRUNCATE není běžná operace PostgREST, takže nejde o prokázané anonymní smazání přes web; přesto doporučeno omezit oprávnění na nezbytná. |
| R08 / P3 | Přesměrování po potvrzeném opuštění neuložených změn používá `window.location.assign` | Ze zdroje: dojde k plnému načtení dokumentu a společné menu se vytvoří znovu. Běžné přechody bez rozepsaného formuláře menu zachovávají. |

MFA stránka v izolovaném demu vyvolala 500 při pokusu získat kód bez služeb. Jde o omezení testovacího prostředí, nikoli potvrzení chyby reálného MFA. Tři INFO o RLS bez politik odpovídají záměrně uzavřeným interním tabulkám. Sedmnáct INFO o nepoužitých indexech není samo o sobě závada ani důvod k jejich odstranění.

## Co prošlo

| Kontrola | Výsledek / důkaz |
|---|---|
| TypeScript | Prošlo; `typecheck.log`. Po přesunu souborů znovu prošlo generování typů tras a TypeScript. |
| ESLint celého projektu | Prošlo; `lint.log`. Po přesunu samostatně ověřeny dotčené nové složky. |
| Testy | 41 souborů, 166 testů prošlo; `unit-tests.log`. Po organizační změně navíc jen 22 dotčených testů. Část testů kontroluje zdrojové smlouvy, nikoli živou databázi. |
| Produkční sestavení | Prošlo, sestaveno 45 stránek; `build.log`. Sestavení před přesunem přihlašovacích souborů; finální přesuny ověřeny typegen/TypeScript/testy, nikoli druhým plným buildem. |
| Migrace | Validace 8 migračních souborů prošla; `migrations.log`. Nejde o test čisté instalace databáze. |
| Závislosti | 553 závislostí, 0 známých zranitelností v odpovědi registru; `dependencies.json`. |
| Stránky | 10 pracovních tras včetně detailu otevřeno na localhost bez konzolových chyb; registrace a obnovy hesla se zobrazily. Skutečný login se zobrazil na portu 3000. |
| Zachování menu | Všech 6 přechodů zachovalo tentýž DOM uzel postranního sloupce. |
| Mobilní rozměry | 30 kontrol: 10 pracovních tras × šířky 320, 390, 768 px; žádné vodorovné přetékání. To není kompletní certifikace mobilní přístupnosti. |
| Faktury | Hledání nenalezeného textu a návrat seznamu; povinná pole; 100 bez DPH → 121 s DPH; zrušení odchodu při kliknutí do menu; zrušení potvrzení úhrady tlačítkem. |
| Export | Stažení CSV faktur, archivu a reportů; stažení vzorů CSV faktur a plateb. Obsah všech exportů nebyl porovnán se živou databází. |
| Reporty | Předvolby měsíc/čtvrtletí/rok a vyvolání tisku. Tisk ověřen zachycením `window.print`, nikoli fyzickým výtiskem. |
| Upomínky | Přidání pravidla, přepnutí šablony a doporučený text. Bez odeslání e-mailu. |
| Nastavení | Nelze kliknutím odebrat vlastní účet; dialog jiného uživatele lze zrušit Escape; neplatné IČO vrací chybu. |
| Odolnost | Simulované 500 přehledu zobrazí text chyby a zachová menu. |
| API validace | Šest neplatných vstupů bezpečně odmítnuto: prázdná faktura, prázdný import, EXE, soubor přes 10 MB, neplatná firma, neplatný e-mail člena. |
| OCR | Unit/integration testy skutečně rozpoznaly generovaný obrázek, mobilní JPEG a skenované PDF. To neověřuje celý upload/storage tok. |
| Databázová metadata | RLS zapnuté u všech 16 veřejných tabulek; veřejné business RPC nejsou spustitelné rolí anon/authenticated. Dokumentový bucket je neveřejný, má limit 10 MB a omezené MIME typy. |

Osmnáct interakčních scénářů má v původním logu 13 úspěchů a 5 neúspěchů. Jeden neúspěch byl chyba příliš širokého selektoru testu DPH; cílený následný test prošel. Zbývají tři potvrzené vady interakce F01–F03 a nesplněné očekávání automatického přesměrování při 401 (R05). Žádné selhání testovacího nástroje se nepočítá jako chyba produktu.

Naměřené lokální přechody: Faktury 150 ms, Reporty 180 ms, Archiv 123 ms, Upomínky 143 ms, Nastavení 1170 ms, Přehled 105 ms. Jde o jediný běh dev serveru s demo daty, včetně čekání na síťový klid; nejde o produkční SLA ani spolehlivé srovnání s původní verzí.

## Blokované a neprovedené scénáře

| Oblast | Stav a důvod |
|---|---|
| Registrace, skutečné přihlášení, MFA, obnova hesla, zapamatování relace, globální odhlášení | Blokováno: chybí stagingové účty a testovací schránka. Zobrazení formulářů a unit testy nejsou náhradou. |
| Vytvoření/editace/smazání faktury, storno, úplné a částečné platby, návrat z archivu | Blokováno integračně: demo neukládá trvale. Nelze potvrdit stav po reloadu a v databázi. |
| Bankovní import, přiřazení a odpojení, duplicity | Blokováno integračně; parsování a pravidla kryjí testy, UI stažení vzoru prošlo. |
| Upload a OCR celé cesty, uložení přílohy a podepsané URL | Blokováno bez testovacího storage a účtu; validace a lokální OCR ověřeny odděleně. |
| Odeslání upomínky, retry, webhook, cron, reálné doručení | Blokováno: žádná určená schránka a izolovaná databáze. Nebyl odeslán žádný testovací e-mail. |
| Administrátorské změny členství a trvalé firemní nastavení | Blokováno integračně; proběhla validace a zrušení dialogů. |
| Role účetní/čtenář, cizí organizace a MFA přes přímé Data API | Blokováno integračně: chybějí oddělené identity. Statická kontrola a metadata popsané výše. |
| Dvojklik při skutečném zápisu, souběžné změny, dlouhé výpadky, stránkování velkého datasetu, všechny kombinace filtrů | Netestováno kompletně; demo má malý dataset, existují pouze dílčí automatické testy. |
| Safari/Firefox, kompletní focus trap, čtečky obrazovky, obsah a sazba fyzického tisku | Netestováno. Prohlížečové kontroly běžely v Chromium. |

`action-inventory.json` eviduje 163 ovládacích prvků ve zdroji a `api-inventory.json` 41 handlerů. Jejich výchozí status je výslovně „netestováno jednotlivě/integračně“; konkrétně provedené scénáře jsou v navázaných JSON protokolech. Inventura neznamená, že byl každý prvek vyzkoušen v každém stavu.

## Priority další práce

1. Ověřit R01 a R07 v izolované databázi a sjednotit platnou produkční konfiguraci (R02–R03).
2. Opravit ochranu rozepsaných dat (F01), původ lokálních požadavků (F04), počet v menu (F02) a dialog (F03).
3. Zapnout ochranu uniklých hesel a sjednotit chybové stavy/timeouty (R04–R05).
4. Doplnit skutečné E2E se stagingovými rolemi a teprve pak uzavřít blokované zápisové a e-mailové scénáře.

## Struktura a úklid

Přihlašovací stránky jsou v `src/app/(auth)`, pracovní stránky v `src/app/(workspace)` a společné rozložení v `src/components/layout/app-shell.tsx`. Popis konvencí je v `docs/architecture.md`.

Izolovaný server byl ukončen, testovací data existovala jen jako demo odpovědi. Produkční data, schéma a veřejná API se neměnila. Dočasná kopie aplikace byla odstraněna; protokoly, screenshoty a auditní skripty jsou zachované jako evidence. Skripty před opakováním potřebují znovu vytvořený izolovaný demo server na localhost:3100.
