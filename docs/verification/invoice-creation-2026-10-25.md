# Vystavení faktury — implementace a ověření

Datum: 25. 10. 2026. Nová samostatná podstránka **Faktury → Vystavit fakturu**, cesta `/invoices/create`. Původní `/invoices/new` (Přidat ručně) i OCR zůstávají samostatnými postupy.

## Rozložení a komponenty

Desktop má formulář a průběžný náhled vedle sebe. Náhled při posouvání formuláře zůstává přichycený 20 px od horního okraje, vejde se do výšky okna a delší dokument se posouvá uvnitř panelu při dostupných akcích; pod 1280 px se panely skládají pod sebe. Bez číslovaného průvodce. Navigace označuje pouze novou podstránku. Formulář používá stávající ikony, dialogy, barvy, vyhledávání zákazníků a firemní bankovní účty.

Nové soubory:

- `src/app/(workspace)/invoices/create/page.tsx`
- `src/components/invoice-creation/invoice-creation.tsx` — formulář, zákazníci, položky, koncept, vystavení, potvrzení odeslání, příloha.
- `src/components/invoice-creation/invoice-document.tsx` — živý náhled ze společného modelu.
- `src/components/invoice-creation/invoice-creation.module.css` — lokální responzivní styly.
- `src/lib/invoice-creation.ts` — validace, přesné výpočty, model dokladu, veřejná projekce.
- `src/lib/invoice-creation-server.ts` — serverová data dodavatele, ověření zákazníka, otisk požadavku.
- `src/lib/issued-invoice-pdf.ts` — PDF s českým písmem, zalamováním a více stranami.
- `src/app/api/invoices/creation/route.ts` — firemní kontext, zákazník, návrh čísla.
- `src/app/api/invoices/creation/preview/route.ts` — skutečný PDF koncept bez vystavení.

Integrace upravují `app-shell.tsx`, stávající API faktur a zákazníků, API odeslání, detail faktury, generátor PDF, české QR platby, e-mailovou šablonu, validaci, koncepty, invalidaci cache a rozpis DPH v přehledech. Import pouze přizpůsobuje callback rozšířené validaci. Existující pole API zůstávají kompatibilní.

## Pole a podporované režimy

| Oblast | Implementace |
| --- | --- |
| Dodavatel | Načtený z nastavení firmy; název, sídlo, IČO, DIČ a známý stav plátcovství. Chybějící povinné údaje blokují vystavení. |
| Odběratel | Vyhledání existujícího, nový zákazník do společného registru, fakturační identita a potvrzená adresa e-mailu. |
| Doklad | Číslo, samostatný číselný VS do 10 číslic, vystavení, splatnost a DUZP u plátce. |
| Úhrada | Bankovní převod na vlastní účet v měně dokladu nebo hotově. Hotovost nevytváří QR ani záznam přijaté úhrady. |
| Položky | Název, množství, jednotka, cena/MJ bez DPH, sazba, procentní sleva, přidání, duplikace, odstranění. Nejvýše 200 položek. |
| Poznámky | Veřejná na dokladu; interní pouze v aplikaci. |
| Příloha | Jeden interní podklad, PDF/JPG/PNG/WEBP, nejvýše 10 MB, ověřený existujícím uploadem. Neposílá se zákazníkovi. |
| DPH | Běžné tuzemské plnění plátce v CZK, sazby 21 % a 12 %, včetně jejich kombinace. Neplátce je samostatný režim bez daně. |
| Měny | Plátce pouze CZK. Neplátce může použít existující měny aplikace; částky se zaokrouhlují na dvě desetinná místa. |

Jednotkové ceny přijímají čtyři desetinná místa a také je zobrazují v náhledu a PDF; množství až šest, sleva dvě. Výpočet používá škálovaná celá čísla `BigInt`, nezaokrouhlené binární součiny nejsou základem výsledku. Základ se zaokrouhlí po položce, daň po sazbě; haléřové rozdíly se deterministicky rozdělí položkám. Součty položek, sazeb a celého dokladu souhlasí. Příklady: 50 000 + 21 % = 60 500 Kč; kombinace 1 000 při 21 % a 500 při 12 % = 1 770 Kč.

## Koncept, vystavení, PDF a e-mail

- Koncept používá existující `sessionStorage`, oddělený klíč uživatele a organizace. Lze uložit neúplný formulář a znovu otevřít v téže kartě. Nevytváří účetní fakturu ani upomínky. Nedostupné úložiště se při explicitním uložení hlásí jako chyba.
- Vystavení projde finální validací na serveru. Částky i dodavatel se sestaví znovu; klient nemůže přepsat firmu nebo podstrčit součty. Bez e-mailu lze vystavit, upomínky jsou pozastaveny.
- Číslo je editovatelný návrh, nikoli rezervace. Stávající unikátní databázový klíč brání duplicitě v organizaci. Souběžné obsazení čísla vrátí vysvětlitelný konflikt 409.
- Identifikátor požadavku a jeho SHA-256 otisk zajišťují, že opakování stejného vystavení vrátí stejnou fakturu. Změněná data se stejným identifikátorem vrátí konflikt.
- Vystavení a odeslání jsou oddělené operace. Před odesláním je potvrzení příjemce. Chyba doručení zachová vystavený doklad a opakuje pouze odeslání.
- E-mail používá neutrální šablonu nové faktury, historické údaje dodavatele a PDF. Úspěch vyžaduje potvrzený identifikátor zprávy od poskytovatele. Stabilní klíč poskytovatele a uložená aktivita odeslání brání běžnému duplicitnímu doručení. Retence klíče poskytovatele není neomezená; při souběhu dlouhého výpadku zápisu aktivit a pozdějšího opakování nelze slibovat absolutní doručení právě jednou.
- Reaktivní HTML a skutečné PDF používají tentýž model a výpočty. PDF se generuje na vyžádání, nikoli při každém stisku klávesy. PDF má tiskovou tabulku položek; úzký HTML náhled ji přeskupuje do kompaktních řádků. Zachovává všechny položky, sazby, termíny a veřejnou poznámku.
- Změna současných firemních údajů nepřepíše dodavatele ani účet na historickém dokladu. PDF nevyhotoveného dokladu je označeno KONCEPT; vizuální štítek v živém náhledu byl na přání odebrán. Interní poznámka ani interní příloha se nepřenášejí do zákaznického PDF.

## Databáze, zabezpečení a uchování

Připravená, lokálně ověřená migrace: `supabase/migrations/20261025194356_invoice_creation_document.sql`.

Nepřidává tabulky, sloupce ani nový stav faktury. Kanonický dokument ukládá do existujícího `money_evidence.issued_document`. Doplňuje ochranný trigger proti přepisu vystaveného snapshotu a finančních údajů, kontrolu vazby zákazníka na organizaci a správný SQL rozpis více sazeb v reportech. Stav, úhrady a nastavení upomínek zůstávají měnitelné. Detail zobrazuje interní poznámku odděleně. API odmítá přímé úpravy vystaveného dokladu a jeho smazání; dostupné zůstává storno. Původní doklady postupují stávajícími cestami.

Všechny nové operace vyžadují identitu a roli admin/accounting, mutace kontrolují původ. Organizace pochází ze serverové identity. Zákazník i soubor se kontrolují v této organizaci; upload také podle autora, ověření a expirace. Nepřidává se automatické mazání historických dokumentů ani nové veřejné úložiště. Aplikační ochrana není náhradou provozní zálohovací a retenční politiky.

**Migrace nebyla aplikována do produkce a aplikace nebyla nasazena.** Před zapnutím nové funkce aplikovat migraci přes obvyklý proces, následně nasadit kód. Ověřit úplné nastavení firmy, vlastní účty a konfiguraci e-mailu. Žádný test neposílal skutečnou zprávu a neprováděl produkční finanční zápis.

## Výsledky ověření

| Kontrola | Výsledek |
| --- | --- |
| Cílené Vitest regrese | 157 testů / 15 souborů prošlo: výpočty, validace, API, odeslání, PDF, reporty, oprávnění, cache, původní účty a navigace. |
| Izolovaná databáze PGlite | Kompletní přehrání migrací, smíšená DPH, neměnnost snapshotu/částky, unikátní číslo, cizí zákazník, pozastavené upomínky bez e-mailu, zachování dashboardu — prošlo. |
| Chromium a WebKit | Nová stránka 320, 390, 768, 1024, 1280, 1440 a 1920 px; bez přetečení dokumentu a chyb Reactu. Na desktopu navíc ověřeno přichycení náhledu při posunu o 700 px a dostupnost tlačítka vystavení. |
| Funkční prohlížečové scénáře nové stránky | Výběr/přidání zákazníka, více sazeb, koncept a reload, veřejná/interní poznámka, PDF download, opakování odeslání bez druhého vystavení, neplátce, sleva, duplikace/odstranění položky, hotovost bez QR a opakování chyby vystavení — prošlo v obou prohlížečích. |
| Původní mobilní funkce | `mobile-invoices-check.mjs --functional`: seznam, ruční formulář, chyba uložení, detail včetně stavů, OCR včetně více souborů a chybný import — prošlo. |
| Lint / TypeScript / produkční build | Prošlo. Build izolovaně v `.cache/invoices-build`, aby se nekřížil se spuštěným vývojem. |

Přísný starší skript s porovnáním geometrie vůči původním snapshotům došel přes všechny obrazovky 320–767 px a skončil na staré geometrii seznamu při 768 px (předchozí přechod na tabletové karty). Referenční soubory před redesignem nebyly přepsány. Funkční regrese se následně spustila samostatně a prošla; tento starý rozměrový baseline se nepovažuje za nově schválený.

Nové screenshoty a výsledky jsou odděleně v `docs/redesign/visual-validation/invoice-creation/`; původní audit zůstává zachován. Skripty: `scripts/invoice-creation-check.mjs`, `scripts/test-invoice-creation-db.mjs`. HTTP fixture prohlížeče není produkční end-to-end test; skutečné PDF bajty a SQL jsou ověřené samostatnými testy.

## Záměrná omezení

- Koncepty nejsou serverový seznam, nepřenášejí se mezi zařízeními a zanikají zavřením karty.
- Jedna standardní šablona; bez katalogu položek či ukládání opakovatelných šablon. Ovládání nepředstírá neexistující backend.
- Bez automaticky rezervované číselné řady, opravných dokladů, záloh, reverse charge, osvobození, OSS nebo přeshraničních režimů. Plátcova faktura v cizí měně je zablokovaná; kurz a daň v CZK se neodhadují.
- Hotovostní způsob úhrady automaticky neznamená zaplaceno. Úhrady se evidují stávající funkcí.
- Nepřidává se evidence podpisů účetních odpovědných osob ani automatická desetiletá retenční služba. Nastavení neobsahuje strukturovaný zápis v obchodním rejstříku; případné chybějící podnikatelské údaje vyžadují samostatné doplnění modelu firmy.
- Nejde o potvrzení úplné právní shody všech druhů českých účetních a daňových dokladů. Ověřený technický rozsah je vymezen výše.

Podklady ke zvoleným běžným sazbám: [Portál veřejné správy](https://gov.cz/informace/obecna-pravidla-a-sazby-dph-INF-205), [Finanční správa](https://financnisprava.gov.cz/cs/dane/danovy-system-cr/popis-systemu). Posuzované požadavky dokladů: [zákon o DPH § 29](https://www.zakonyprolidi.cz/cs/2004-235#p29) a [zákon o účetnictví § 11](https://www.zakonyprolidi.cz/cs/1991-563#p11).

## Následné úpravy samotného dokumentu

Záhlaví nově zvýrazňuje název dodavatele s jeho logem; menší označení a číslo faktury jsou pod názvem. Chybějící nebo nedostupné logo nahrazuje aktuální zelený symbol Splatna. Termíny jsou v jedné oddělené řadě, strany ve dvou sloupcích, DPH pod názvem položky. Úzký náhled skládá údaje položky do přehledného bloku. Výrazný součet a platební blok s QR odpovídají tiskovému PDF.

Logo čerpá ze stávajícího spravovaného firemního obrázku, případně místního brandového souboru. Server nenásleduje libovolné URL; chybný obrázek má náhradu. Logo je volitelnou součástí metadat dodavatele v existujícím JSONB, další migrace není potřeba. Firemní logo se odkazuje na stávající úložiště, takže jeho historickou neměnnost tato úprava negarantuje. Právní identita a finanční snapshot zůstávají zachované.

Nové soubory pro branding a vizuální kontrolu: `src/lib/invoice-logo-server.ts`, `src/lib/invoice-logo-server.test.ts`, `scripts/invoice-document-preview.mjs`. Výstupní PDF a jejich náhledy jsou v adresáři screenshotů jako `invoice-standard`, `invoice-mixed`, `invoice-nonpayer` a `invoice-branded`.

Ověření této úpravy: 61 cílených testů prošlo (včetně obou režimů DPH, více stran PDF, oddělení interních poznámek a bezpečného načtení/náhrady loga). Prošlo také lint a TypeScript; živý náhled byl ověřen na šířkách 320–1920 px včetně dlouhého názvu firmy, přesných velkých částek, vlastního loga a chybějícího obrázku.
