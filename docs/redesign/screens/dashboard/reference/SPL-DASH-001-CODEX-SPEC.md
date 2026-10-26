# SPL-DASH-001 — Nástěnka Splatna 2.0

**Stav:** DESIGN REFERENCE / čeká na schválení implementačních detailů  
**Zdroj:** přesně oříznuté výřezy dodaného mockupu `assets/00-full-dashboard.png`. Obrázky nejsou nově generované a popisy jsou **mimo obrázky**.  
**Účel:** Přestavět vizuální část `/dashboard` podle schválené obrazovky bez ztráty existující funkcionality, datové správnosti, oprávnění a responzivity.

## 0. Jak se dokument používá v Codexu

1. Otevři `assets/00-full-dashboard.png` a pak jednotlivé výřezy uvedené níže.
2. Zmapuj reálnou implementaci dashboardu a společných layoutů; **nevymýšlej názvy existujících souborů ani backendové API**.
3. U každé komponenty porovnej současnou funkcionalitu s vizuálním cílem; zachovej všechny stávající akce a datové kontrakty.
4. Vytvoř minimální, opakovaně použitelné komponenty. Jejich umístění přizpůsob skutečné struktuře projektu, ne naopak.
5. Před úpravami zapiš baseline chování a testů; po úpravách proveď jednotkové, integrační, E2E a vizuální/responzivní kontroly v rozsahu, který podporuje projekt.
6. Každou část implementuj malým PR, bez současného přepisování business logiky.

## 1. Obrazovka jako celek — `assets/00-full-dashboard.png`

**Cílový vzhled:** Bílý až velmi světlý podklad s jemným zeleným organickým přechodem v pozadí. Fixní/persistentní sidebar vlevo, společná horní lišta, uvítání, čtyři přehledové ukazatele, dvousloupcové grafy a pod nimi tabulka a panel upomínek. Nápověda Esko je malá plovoucí ikona v pravém dolním rohu. Mezi sekcemi je dostatek prostoru, karty používají decentní okraj či stín a umírněné zaoblení.

**Priorita informací:** (1) kolik čeká na úhradu / po splatnosti, (2) graf a struktura faktur, (3) faktury vyžadující pozornost, (4) stav automatizace. Nespoléhat na dekorace při sdělování stavu.

**Šablona implementace:** Znovupoužitelný AppShell (sidebar + topbar + floating Esko), `DashboardHeader`, `DashboardKpiGrid`, `PaymentTrendChart`, `InvoiceStatusChart`, `DueInvoicesTable`, `ReminderOverview`. Jde o **navrhovaná rozhraní**, nikoliv potvrzené názvy existujících komponent.

**Rozvržení:** Na širokém desktopu 4 KPI vedle sebe; graf cca 2/3 šířky a donut cca 1/3; stejné proporce v dolní dvojici. Na tabletu layout podle skutečného prostoru (např. 2 KPI vedle sebe, případně grafy pod sebou). Na mobilu jeden sloupec a kompaktní řádky/karty místo nepoužitelné horizontálně stlačené tabulky. Žádné horizontální přetékání celé stránky.

## 2. Specifikace jednotlivých vizuálních objektů

### CMP-01 Sidebar — `assets/01-sidebar.png`
**Úloha:** Navigace do Nástěnky, Faktur, Plateb, Upomínek, Zákazníků, Reportů a Nastavení. Logo a značka nahoře; vybraná položka jemně zeleně podbarvená; počítadlo u Faktur. Profil a firma pouze **vlevo dole**.

**Interakce:** Aktivní položka odvozená od aktuální trasy, odkazy navigují bez ztráty oprávnění. Počitadla získat ze stejného zdroje jako v současné aplikaci. Kliknutí na profil otevře menu účtu / změny firmy jen tehdy, když tyto funkce v projektu existují.

**Responzivita:** Na mobilu stávající přístupná mobilní navigace / drawer; nespoléhat na hover. Klávesnice, focus a ARIA labely.

**Rozhodnutí oproti screenshotu:** V mockupu je navíc avatar **vpravo nahoře**; tento duplikát **neimplementovat** (uživatelské rozhodnutí: profil na jednom místě vlevo dole).

### CMP-02 Topbar — `assets/02-topbar.png`
**Úloha:** Globální vyhledávání vlevo; vpravo akce „Importovat fakturu“, „Nová faktura“ a notifikace.

**Interakce:** Použij současné vyhledávací a navigační chování. Klávesová zkratka `⌘K` pouze existuje-li / byla-li schválena; neimplementovat fiktivní vyhledávání. Import = **přidání již vystavené faktury ke sledování**, nikoliv generátor PDF. „Nová faktura“ má odkazovat na **ruční zaevidování existující faktury**, proto pro konzistenci produktu zvaž text „Přidat fakturu“ po produktovém schválení. Notifikace musí mít funkční stav a přístupná jména.

**Responzivita:** Na úzkém displeji vyhledávání jako ikona/dialog; prioritní akce dostupná přes mobilní CTA/menu. Nepřidávej druhý profil.

### CMP-03 Nadpis, uvítání, období — `assets/03-page-heading.png`
**Úloha:** Datum v horní části, „Dobré ráno, Tomáši!“ a vysvětlující věta; filtr „Posledních 12 měsíců“.

**Data a stav:** Jméno, oslovení i datum načíst dynamicky a zohlednit lokální časové pásmo; nepoužívat statickou testovací identitu. Věta má odrážet skutečné údaje. Filtr může být lokální pro graf nebo globální pro celou stránku — **před implementací ověř současnou sémantiku a explicitně ji zachovej**. Jasně indikuj rozsah aktualizovaných komponent.

### CMP-04 KPI Celkem faktur — `assets/04-kpi-invoices.png`
**Úloha:** Počet faktur, porovnání s obdobím, ikona dokumentu. Kliknutí dle reálného dashboardu směřuje na odpovídající filtrovaný seznam, je-li to dnes podporováno.

**Podmínky:** Nula, načítání, velká čísla, chybějící data. Definice „Celkem“ musí být identická s výpočtem současných reportů; nepočítat samostatně z viditelných řádků.

### CMP-05 KPI Čeká na úhradu — `assets/05-kpi-awaiting.png`
**Úloha:** Počet a peněžní objem neuhrazených pohledávek. Jemně jantarový status; bez agresivní výstražné signalizace.

**Podmínky:** Předem zdokumentovat, zda „Čeká na úhradu“ zahrnuje faktury po splatnosti či nikoliv; respektovat dosavadní datovou definici. Částečně uhrazené položky počítat podle stávajících pravidel zbývající částky.

### CMP-06 KPI Po splatnosti — `assets/06-kpi-overdue.png`
**Úloha:** Počet a objem pohledávek po splatnosti; jemný červený akcent pro riziko.

**Podmínky:** Rozhoduje existující firemní časové pásmo a due-date logika; žádné ad hoc přepočty stavu na frontendu. Kliknutí případně filtruje seznam po splatnosti.

### CMP-07 KPI Zaplaceno — `assets/07-kpi-paid.png`
**Úloha:** Počet uhrazených faktur a přijatá částka. Zelený vizuální signál, nikoliv jediný způsob označení úspěšného stavu.

**Podmínky:** Dokončené platby, ručně potvrzené úhrady a částečné platby musí být vyhodnocovány podle současné business logiky; pozor na vykazované období.

### CMP-08 Graf „Příjmy v čase“ — `assets/08-chart.png`
**Úloha:** Historický sloupcový graf s osou měsíců a legendou. Kliknutí / tooltipy podle existující implementace, správné CZK formátování a filtry období.

**Podmínky:** Chart má skutečně zobrazovat požadovanou metriku. Vizuální reference může obsahovat modelová čísla a nepřesné legendy; datovou definici **neodvozuj z grafického obrázku**. Barvy přístupné, viditelné osy, sémantický tabulkový alternativní výstup pro screen reader.

### CMP-09 „Stav faktur“ donut — `assets/09-donut.png`
**Úloha:** Donut graf kategorií s počtem a podíly v legendě.

**Podmínky:** Sjednotit dataset se stavem KPI a současnou backendovou definicí. V mockupu jsou **99 zaplaceno + 18 čeká + 7 po splatnosti = 124**, ale zároveň další kategorie „Nejasná platba 4“; kategorizace se tedy překrývá nebo je ukázkově nekonzistentní. **Nesčítej slepě všechny legendy do celku**; ověř, zda „nejasná platba“ tvoří oddělený atribut. Procenta lze zobrazovat jen při matematicky korektním základu.

### CMP-10 Tabulka „Nejbližší splatnosti“ — `assets/10-invoices-list.png`
**Úloha:** Krátký seznam faktur k rychlé kontrole. Sloupce: číslo, odběratel, částka, splatnost, stav, kontextové menu; odkaz „Zobrazit všechny“.

**Interakce:** Celý řádek nebo číslo vede na detail; `…` menu zachovává stávající povolené rychlé akce. Třídění a výběr položek musí odpovídat názvu: „nejbližší splatnosti“ versus „po splatnosti“ je třeba explicitně vyjasnit (např. priorita po splatnosti, potom nejbližší budoucí). Tlačítka v menu nesmí spouštět změny bez potřebných potvrzení.

**Responzivita:** Převod řádků do karet s dominantní částkou, splatností a stavem.

### CMP-11 „Automatické upomínky“ — `assets/11-reminders.png`
**Úloha:** Stručný náhled nejbližších / posledních automatických akcí, ne kompletní editor automatizace.

**Interakce:** Položka vede na existující detail faktury nebo upomínek. Akce „Pozastavit“ se musí týkat správného kontextu (jedné faktury vs. celého automatu) a zobrazit potvrzení, jestli ho dnes UI používá. Historické odeslání, vynechání, čekání a selhání mají být rozpoznatelné textově i ikonou. Žádné automatické odeslání při pouhém zobrazení dashboardu.

### CMP-12 Profil v sidebaru — `assets/12-profile.png`
**Úloha:** Jméno přihlášeného uživatele a aktuální firma, tlačítko vyvolání menu. Profil **jen zde**, nikoli současně vpravo nahoře.

**Bezpečnost:** Zobrazená firma musí odpovídat tenant kontextu a rolím. Přepínání firmy jen přes existující bezpečný mechanismus; žádné ruční přepisování identifikátoru firmy v URL.

### CMP-13 Esko — `assets/13-esko.png`
**Úloha:** Malá plovoucí ikona asistenta v pravém dolním rohu. Při otevření zachovat současný skutečný chat, jeho stav a případná oprávnění.

**Responzivita a přístupnost:** Nezakrývat řádky tabulky, primární CTA ani systémové dialogy. Použít srozumitelný aria-label, bezpečný `z-index`, tlačítko pro zavření, focus management a přiměřený rozměr na mobilu.

## 3. Sdílené UI objekty / vizuální pravidla

- **Barvy:** pozadí téměř bílé, velmi subtilní světlezelené organické plochy; zelená pro aktivní navigaci, primární akci a pozitivní stavy, decentní oranžová pro čekající, tlumená červená pro prodlení. Přesné tokeny odvodit ze schváleného design systému, nesbírat náhodné hodnoty z obrázku.
- **Typografie:** moderní čitelný sans-serif, krátké názvy, vizuální hierarchie nadpis / metrika / pomocný text. Zachovat českou diakritiku.
- **Rozměry:** jednotná spacing škála a konzistentní radius (orientačně 10–14 px); responsivní breakpointy navázat na stávající aplikaci.
- **Komponenty:** přístupný `Button`, `IconButton`, `StatusBadge`, `MetricCard`, `ChartCard`, `SearchInput`, `DateRangeSelect`, `EmptyState`, `Skeleton`, `ErrorState`. Neprovozovat dvě paralelní verze téhož formulářového systému, pokud lze bezpečně reuse.
- **Ovládání:** klávesnice, viditelný focus, dostatečné kontrasty, textová alternativa grafů, podpora dlouhých názvů firem a měn.

## 4. Varianty obrazovky, které musí Codex pokrýt

| Stav | Požadované chování |
| --- | --- |
| Načítání | Skeleton na KPI, grafech, tabulce bez poskakování layoutu; žádné falešné nuly. |
| Prázdný tenant | Jednoduché CTA „Importovat fakturu“ / „Přidat fakturu“, bez fiktivních dat. |
| Bez výsledků v období | Zobrazit informaci, že v daném období nejsou data, a umožnit změnit filtr. |
| Chyba načtení | Cílená chyba sekce, tlačítko „Zkusit znovu“, neztratit ostatní načtené sekce. |
| Nedostatečné oprávnění | Nezobrazovat nepovolená data ani akce; dodržet role a RLS. |
| Dlouhá čísla/názvy | Bez přetečení na tabletu a mobilu; měna a procenta dle locale. |
| Mobilní rozvržení | Jeden sloupec; sidebar v mobilní navigaci; nejdůležitější akce dosažitelné dotykem. |
| Otevřený Esko chat | Nepřekrýt operativní UI, keyboard-safe a ovladatelný i přes čtečku. |

## 5. Kritická upozornění k mockupu

1. **Nesourodá data:** datum v hlavičce je 1. 9. 2026, ale položky tabulky ukazují termíny jako 12.–22. 3. 2026. Jde o ilustraci, nikoliv důkaz reálného pořadí.
2. **Součet kategorií:** 99 + 18 + 7 = 124, doplňková kategorie „Nejasná platba 4“ překrývá nebo narušuje donut. Ověřit reálné statusy.
3. **Dvojitý profil:** avatar v horní liště z obrázku **ignorovat** a nechat jen sidebar dole.
4. **Terminologie „Nová faktura“:** Splatno zaznamenává již vystavené faktury; nevytvářej workflow vystavování PDF ani odesílání vydané faktury jen podle mockupu.
5. **„Pro tuto fakturu zapnuto“ v dashboardu:** screenshot obsahuje kontext konkrétní faktury v globálním panelu. Implementovat smysluplný přehled reálných upomínek, ne hardcoded jednokartový detail.

## 6. Implementační podplány (malé samostatné změny)

| PR | Rozsah | Ověření |
| --- | --- | --- |
| DASH-PR01 | Audit existující `/dashboard`, mapování akcí, metrik a současných testů | Dokumentace + baseline bez změny produkčního kódu |
| DASH-PR02 | Použití společného AppShellu (nebo vytvoření jen pokud chybí) | Navigace, tenant profil, mobil, regresní trasy |
| DASH-PR03 | Header + KPI 4 karty na reálných datech | Správnost výpočtů, stavy, filtrování |
| DASH-PR04 | Časový graf a donut s platnou agregací | Dataset, prázdná data, interakce, a11y |
| DASH-PR05 | Tabulka splatností + souhrn upomínek | Odkazy, oprávnění, akce, tenant izolace |
| DASH-PR06 | Esko, loading/empty/error, responsive polishing | Mobil/tablet, E2E, vizuální screenshot diff |

## 7. Akceptační kritéria (Definition of Done)

- [ ] Všechny oblasti z `assets/00-full-dashboard.png` jsou reprezentovány odpovídajícími UI komponentami.
- [ ] Profil se zobrazuje pouze vlevo dole; Eško je vpravo dole.
- [ ] Primární a sekundární akce dělají přesně to, co mají v existující aplikaci.
- [ ] Všechny metriky a grafy čerpají ze skutečných zdrojů a čísla spolu matematicky souhlasí.
- [ ] Chybové, prázdné, načítací a omezené stavy byly ověřeny.
- [ ] Žádné změny DB schématu, RLS, API kontraktů nebo pravidel OCR, párování či upomínek bez samostatného schválení.
- [ ] Desktop, tablet a mobil bez kritického přetečení a blokovaných akcí.
- [ ] Přístupnost klávesnicí, viditelný focus, role a textové alternativy grafů.
- [ ] Prošly existující relevantní testy, lint, TypeScript a připravené vizuální/E2E testy; dolož výsledky.
- [ ] Diff je malý, přezkoumatelný a propojený s P00 auditem a skutečnou route mapou.

## 8. Doporučené zadání Codexu

> Implementuj pouze `SPL-DASH-001` podle `SPL-DASH-001-CODEX-SPEC.md` a obrázkových referencí v `assets/`. Nejdříve ověř strukturu skutečného repozitáře a datové kontrakty stránky. Design obrázku je vizuální referencí, nikoliv zdrojem obchodních pravidel. Přísně zachovej funkčnost, oprávnění, responzivitu a backend; neodvozuj logiku z ilustračních částek či názvů. Postupuj po podplánech DASH-PR01 až DASH-PR06, pro každý předlož diff, testy a screenshoty. Pokud dojde k rozporu, preferuj existující produktové chování a vyžádej si rozhodnutí před jeho změnou.
