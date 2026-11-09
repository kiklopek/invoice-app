# Splatno — audit responzivity

**Navazující změna:** tento dokument zachycuje původní audit. Později uživatel schválil [lokální implementaci vstupních stránek a onboardingu](../verification/auth-entry-responsive.md); její výsledky a změny jsou vedeny odděleně.

Datum: 2. listopadu 2026. Rozsah: audit, důkazy a návrh systému. Produktový kód nebyl měněn.

## Stav a hlavní závěr

Současný frontend už má použitelné komponentové režimy. Audit nepotvrdil potřebu globálního přepisu CSS. Nejvyšší prioritu má zachování funkcí při změně šířky a společný způsob ověřování, nikoliv nové univerzální breakpointy.

**Uzamčení referenčního desktopu zatím není dokončené.** Uživatelem dodaný viewport 440×956, DPR 3 a iPhone Safari identifikuje mobilní emulaci. Nejde o referenci MacBooku Air. Skutečný desktopový viewport/zoom/displej byl znovu vyžádán. Stávající autorizovaná testovací session na produkci přesměrovala chráněné stránky na login. Nic z toho nebylo nahrazeno odhadem 1440×900 nebo screenshotem loginu vydávaným za dashboard.

## Oddělené zdroje pravdy

| Zdroj                                | Co prokazuje                                                           | Co neprokazuje                                                                        |
| ------------------------------------ | ---------------------------------------------------------------------- | ------------------------------------------------------------------------------------- |
| Živá produkce                        | Deployment/commit, dostupnost a vzhled veřejných stránek               | Přihlášený dashboard/faktury/import se současnou session nejsou zachyceny             |
| Izolovaný archiv produkčního commitu | Vykreslení skutečných komponent a CSS této revize se syntetickými daty | Serverové autorizace, SSR, produkční pořadí/chunkování CSS a skutečná zákaznická data |
| Aktuální pracovní adresář            | Rozdíly dosavadních necommitnutých úprav                               | Schválený produkční design                                                            |

Produkční nasazení: `dpl_691yi3qMViUEeg5m23FirnK3J5Rg`, commit `26defdcc90f9ebaf979d40d23a6c5c7648dd0e0f`, stav READY; metadata v [production.json](../../artifacts/responsive-audit/2026-11-02/production.json). Zdrojový archiv je připraven odděleně v dočasném adresáři. Neobsahuje změny lokálního pracovního adresáře.

## Nálezy a doporučené pořadí

### R-001 — Kontakt zákazníka a jeho editace nejsou dostupné v tabletovém/kompaktním režimu

**Kategorie:** production-source-render · **Priorita:** P1.

Admin fixture: 8 dostupných editorů při 390/1280/1440 px, 0 při 768/1024 px; celé kontaktní buňky mají nulovou vykreslenou šířku.

**Reprodukce:** Otevřít přehled zákazníků jako admin s vyplněnými kontakty. Při 768 nebo 1024 px hledat e-mail a akci jeho úpravy. Porovnat s 390 nebo 1280 px.

**Doporučení:** Zachovat kompaktní souhrn, doplnit dostupný kontakt/rozbalení řádku se stejnou editací. Nevytvářet druhou zákaznickou datovou implementaci.

**Meze důkazu:** Potvrzeno na komponentách přesné produkční revize, nikoli v přihlášené živé produkci.

Důkazy: [interactions/results.json](../../artifacts/responsive-audit/2026-11-02/interactions/results.json), [interactions/chromium-customer-contact-access-768.png](../../artifacts/responsive-audit/2026-11-02/interactions/chromium-customer-contact-access-768.png), [interactions/webkit-customer-contact-access-1024.png](../../artifacts/responsive-audit/2026-11-02/interactions/webkit-customer-contact-access-1024.png)

### R-002 — Přehled faktur vyžaduje horizontální posun na menším notebooku

**Kategorie:** production-source-render · **Priorita:** P2.

Při 1024 px je scrollovací obal široký 738 px a tabulka má scrollWidth 1090 px; část sloupců a akcí vyžaduje posun. Firefox potvrzuje vnitřní scroll při 1280 px.

**Reprodukce:** Otevřít faktury při 1024×768 a pokusit se použít všechny sloupce a řádkové akce bez horizontálního posunu.

**Doporučení:** Přepínat řádek podle šířky vlastního kontejneru: plná tabulka od 1090 CSS px, kompaktní dvouúrovňový řádek pod touto hranicí. Akce musí zůstat v dostupné šířce.

**Meze důkazu:** Nejde o horizontální přetékání celé stránky; současný posuvník je funkční, ale zhoršuje použití.

Důkazy: [production-source/results-chromium-matrix.json](../../artifacts/responsive-audit/2026-11-02/production-source/results-chromium-matrix.json), [interactions/results.json](../../artifacts/responsive-audit/2026-11-02/interactions/results.json), [interactions/chromium-invoice-table-small-laptop-1024.png](../../artifacts/responsive-audit/2026-11-02/interactions/chromium-invoice-table-small-laptop-1024.png)

### R-003 — Částky zákazníků vytvářejí vlastní scrollovací oblasti i při malém přesahu

**Kategorie:** production-source-render · **Priorita:** P2.

Například při 390 px mají částkové spany clientWidth 102/103 px a scrollWidth 105/107 px. Starší globální overflow-x:auto se skládá s měřicími elementy sdílené částky.

**Reprodukce:** V přehledu zákazníků změřit .customer-amount a overflowX; viditelnost lišty závisí na systémovém nastavení scrollbarů.

**Doporučení:** Zachovat již přítomnou lokální opravu odstranění nadbytečného scrollování a ověřit přesnou částku/tooltip. Opravu neimplementovat podruhé.

**Meze důkazu:** Viditelná lišta není na každém systému trvale vykreslená; potvrzena je existence zbytečné scrollovací oblasti.

Důkazy: [production-source/results-chromium-matrix.json](../../artifacts/responsive-audit/2026-11-02/production-source/results-chromium-matrix.json), [local/results-chromium.json](../../artifacts/responsive-audit/2026-11-02/local/results-chromium.json)

### D-001 — Lokální import/platby/reporty používají odlišné širokoúhlé škálování než produkční reference

**Kategorie:** local-difference · **Priorita:** P2-review.

Na 2560 px má lokální obsah zoom 1.21818; produkční revize zoom 1. Importní nadpis se vykreslí přibližně 51.16 px místo 42 px. Sidebar zůstává 244 px.

**Reprodukce:** Porovnat stejné syntetické údaje a viewport na obou zdrojových revizích.

**Doporučení:** Tuto změnu vést odděleně od produkční baseline. Pro budoucí Expanded režim použít role komponent a omezený růst, nikoli automatické převzetí lokálního zoomu.

**Meze důkazu:** Rozdíl místní práce, nikoliv chyba nasazené produkce.

Důkazy: [local/results-chromium.json](../../artifacts/responsive-audit/2026-11-02/local/results-chromium.json), [local-vs-production.patch](../../artifacts/responsive-audit/2026-11-02/local-vs-production.patch)

### Q-001 — Původní vizuální reference nejsou stabilním schváleným kontraktem

**Kategorie:** test-infrastructure · **Priorita:** P2.

Existující vizuální test používá živá data a toleranci 1 %. Auditní snímky se stálými daty jsou 14/18 byte-shodné; zbývající 4 mají 22–38 odlišných pixelů (nejvýše 0.00294 %).

**Reprodukce:** Porovnat dva po sobě jdoucí snímky po načtení fontů a ustálení požadavků.

**Doporučení:** Oddělit kandidáty od schválených snímků; použít pevný čas/data/prostředí, regionální kontroly a geometrii. Neaktualizovat baseline automaticky.

**Meze důkazu:** Dvě zachycení jedné připojené stránky neprokazují stabilitu mezi různými OS, verzemi nebo novými běhy.

Důkazy: [repeatability/results.json](../../artifacts/responsive-audit/2026-11-02/repeatability/results.json)

### H-001 — Rozsáhlá CSS kaskáda zvyšuje riziko nechtěných změn, ale samotný počet pravidel není závada

**Kategorie:** static-hypothesis · **Priorita:** P3-investigate.

Produkční zdroj: 48 CSS souborů, 390 media queries, 29 container queries a 626 deklarací !important.

**Reprodukce:** Použít inventář opakovaných selektorů a ověřit computed styles konkrétního prvku.

**Doporučení:** Při každé opravě stanovit vlastníka pravidla; čistit pouze prokazatelně nahrazené deklarace v témže malém kroku.

**Meze důkazu:** Nejde o důkaz, že jsou všechna !important nebo různé breakpointy chybné.

Důkazy: [static-inventory.json](../../artifacts/responsive-audit/2026-11-02/static-inventory.json)

## Co prokazatelně fungovalo

- Mobilní navigace se otevřela a zavřela Escape; byl pozorován scroll lock.
- Řádková nabídka a dialog potvrzení úhrady se vešly do 390px okna v Chromium i WebKit; dialog bylo možné zavřít.
- Native validace prázdného ručního formuláře označila 7 neplatných polí bez zápisu.
- Rozepsaná položka tvorby faktury přežila změnu šířky v obou prohlížečích.
- Portrétový guard a návrat s ponechanou hodnotou byly pozorovány v emulaci Chromium. WebKit při změně orientace zavřel prohlížeč; není to ověření fyzického Safari ani potvrzená chyba aplikace.
- Skutečné OCR review prošlo 5 viewporty a 13 funkčními scénáři. Zpracování dávky prošlo 8 scénáři včetně zastavení, chyby, ručního dokončení a zachování rozpracovaných dokumentů.
- Párování plateb prošlo 6 rozměry a scénáři hledání, hromadného výběru, chyb, dialogů a filtrů. Viz samostatná validační JSON v deep-workflows.
- Zvětšení všech hlavních textových prvků a explicitních line-height na 200 % nevytvořilo horizontální přetékání přehledu zákazníků. Je to řízená DOM simulace, nikoliv nativní browser zoom nebo ověření softwarové klávesnice.
- V testovaných nízkých oknech nebyl zjištěn přesah spodního účtového panelu navigace pod viewport.

## Metodické limity

Vite harness načítá skutečné produkční komponenty, lokální styly a celou sdílenou navigaci; Next Link/Image/router/font a datové rozhraní mají izolované adaptéry. Nejde o kompletní Next.js produkční build. Auth font adapter neposkytuje Next/font generované prostředí; auth snímky neslouží k pixelovému schválení typografie. Testy MFA/obnovy hesla používají syntetické odpovědi, nikoliv skutečné ověření identity nebo změnu hesla. Supabase/databáze/e-mail/OCR/Stripe nejsou v izolovaných testech kontaktovány.

Nulové přetékání celé stránky neznamená, že uvnitř není scrollování nebo skrytý obsah. Sken sr-only elementů, záměrné ellipsis a neotevřených nabídek může hlásit falešné kandidáty; nejsou automaticky zahrnuty mezi závady.

Varianta `error` sama o sobě není důkazem zobrazené chybové obrazovky: řada komponent při prvním mountu nerevaliduje a používá initialData. Audit výslovně rozlišuje injekci chyby od viditelného alertu; například dashboard alert byl pozorován, zatímco pro některé ostatní stránky vyžaduje chyba konkrétní další akci. Totéž platí pro stress/empty varianty komponent, jejichž fixture nemění relevantní obsah. Mapa pokrytí uvádí tyto meze.

Kandidátní obrázky nejsou schválené baseline. Stabilita dvou po sobě jdoucích snímků není důkazem shody mezi OS nebo opakovanými běhy. Existující nasazený desktop se musí nejdříve zachytit ve skutečném okně uživatele.

## Výstupy

- [Specifikace systému](../../RESPONSIVE_DESIGN_SYSTEM.md)
- [Login, registrace a kompletní onboarding](AUTH_ONBOARDING.md)
- [Mapa pokrytí](COVERAGE.md)
- [Postup následných malých změn](IMPLEMENTATION_SEQUENCE.md)
- [Spuštění a opakování auditu](README.md)
- [Strojový souhrn](../../artifacts/responsive-audit/2026-11-02/summary.json)
- [Inventář stylů a jejich vlastníků](../../artifacts/responsive-audit/2026-11-02/static-inventory.json)

**Stav fáze:** auditní podklady a návrh jsou připraveny; formální uzamčení produkční reference a schválení baseline blokují B-01/B-02 v mapě pokrytí. Neproběhla žádná změna vzhledu ani deploy.
