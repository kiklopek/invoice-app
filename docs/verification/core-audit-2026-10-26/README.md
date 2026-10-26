# Audit hlavních funkcí Splatna — 26. 10. 2026

## Výsledek a rozsah

Základní průchod od dokumentu po úhradu fungoval proti skutečnému izolovanému Supabase. Audit ale našel potvrzené bezpečnostní a funkční chyby; aplikaci nelze označit za kompletně ověřenou bez výhrad.

- Produkční projekt `liczsygjiuaobdzytyea`: pouze čtení metadat migrací, oprávnění, RLS a úložišť. Žádné klientské dokumenty, zápisy, produkční crony ani změny Stripe.
- Oddělený lokální projekt `splatno-core-audit-20261026`, port API 54421; dvě syntetické firmy, admin/účetní/čtenář. Aplikace běžela na portu 3006 s kopií zdrojů a samostatným build adresářem. Lokální CSP byla v kopii rozšířena pro připojení k loopback Supabase; produktový kód se neměnil.
- Běžné přihlášení heslem a skutečné aplikační MFA. Pro přípravu a kontrolu výsledků sloužil lokální servisní klient. Účetní byl ověřen přes heslo SDK a skutečné MFA/API; jeho automatizovaná navigace v UI dvakrát skončila timeoutem.
- Na výslovně zadanou adresu byly skutečně poslány **dva** syntetické e-maily, faktura s PDF a upomínka, označené TEST / NEPLATIT. Resend u obou následně vrátil `delivered`. To dokládá přijetí přijímajícím serverem, nikoliv přečtení nebo umístění do hlavní složky schránky. [Stav zpráv](email-samples.json).
- Všechny ostatní e-maily auditu se zachytávaly lokálně přes `RESEND_BASE_URL`. Bounce/complaint byly syntetické podepsané události pro lokální záznamy.

## Co bylo ověřeno

| Oblast | Stav | Úroveň a praktický výsledek |
|---|---|---|
| Migrace | Ověřeno lokálně; chyba v produkční shodě | Všechny lokální migrace šly použít na čistý skutečný Supabase; 11 izolovaných databázových sad prošlo. V produkci chybí tři migrace. |
| Registrace a obnova hesla | Ověřeno lokální integrací | Registrace se skutečným lokálním OTP, ověření účtu a přesměrování do onboardingu. Obnova hesla skutečným jednorázovým recovery tokenem; nové heslo fungovalo, původní i opakované použití tokenu byly odmítnuty. [Důkaz](registration-recovery-results.json). |
| Přihlášení, MFA, role, odhlášení | Částečně ověřeno / chyba | Admin a čtenář přes browser + MFA; účetní přes heslo SDK + skutečné MFA/API. Čtenář mohl číst vlastní fakturu, upload dostal 403; druhá firma dostala pro cizí fakturu 404. Po odhlášení API vracelo 401. Přímé DB čtení obchází aplikační MFA, viz F1. |
| Zákazníci a nastavení | Částečně ověřeno | Vystavení vytvořilo/využilo skutečná lokální data zákazníka; DIČ, účet a výchozí kategorie byly nutné předpoklady. Editace, ARES a nastavení mají unit/DB testy; úplný ruční UI průchod každou variantou a dostupnost ARES pro reálnou firmu se neověřovaly. |
| Faktury, DPH, PDF | Ověřeno pro hlavní průchod | Doklad s vlastní jednotkou `licence` a DPH 7,55 %: základ 100,00 Kč, celkem 107,55 Kč; serverový přepočet, opakované vystavení stejného požadavku vrátilo stejný doklad, PDF vzniklo. Opakované odeslání vystaveného dokladu vrátilo `already_sent`. Vícestránkovost a QR mají regresní testy a existující renderovací ověření; fyzická tiskárna se netestovala. |
| Upload a OCR | Ověřeno / chyba rozpoznání | Skutečný podepsaný upload, Storage, kontrola signatury, lokální PDF i obrázek, reálné OCR API a uložený návrh. Vadný typ a nadlimitní velikost odmítnuty. Chybně sloučený název odběratele je označen za ověřený, viz F2. |
| Externí OCR | Chyba lokální konfigurace | Aktivní hybridní režim; Gemini odmítlo lokální klíč před externím požadavkem. API použilo lokální výsledek. Úspěšné externí rozpoznání ani produkční klíč ověřeny nejsou. |
| Učení OCR | Chyba / chybějící zapojení | Oprava se uložila do `invoice_ocr_reviews`; další zpracování stejného syntetického vzoru znovu vrátilo chybný název. V kódu jsou zápisy zpětné vazby, nebyl nalezen čtecí průchod pro její využití. |
| Výpisy | Ověřeno CSV a GPC; CAMT částečně | CSV skutečně nahráno a zaúčtováno; GPC přes skutečné API přijalo 1 řádek, druhé nahrání vrátilo tentýž import. Vadný soubor odmítnut. CAMT má parserové a SQL testy; aktivace vyžaduje povolení firmy a ověřený vzorek banky, není zapnutá v původní lokální konfiguraci. Plný CAMT průchod se neoznačuje za ověřený. |
| Párování a platební paměť | Hlavní průchod ověřen; zbytek částečně | CSV s odpovídajícím VS a částkou bylo potvrzeno; faktura měla `paid_amount=1210`, `status=paid`, `next_reminder_at=null`. Částečné úhrady, přeplatky, kombinace, konflikty, souběh a izolace paměti prošly unit/SQL sadami. Každá varianta nebyla zopakována přes UI. Novější pomocná paměť plátce je řízená feature flags; v původní lokální konfiguraci není povolena žádná firma. |
| Upomínky a e-maily | Hlavní fronta ověřena / chyby | Druhá neuhrazená faktura vytvořila 1 job, worker zpracoval 1 a lokální provider převzal 1 zprávu; DB log měl `sent` a `attempt_count=1`. Automatické opakování při chybě poskytovatele a vypršení lease pokrývají unit/SQL testy, nikoliv celý nový browser průchod s výpadkem služby. Ruční odesílání má F3 a F5. |
| Resend webhooky | Ověřeno lokální integrací | Neplatný podpis odmítnut; platné `delivered`, `bounced`, `complained` změnily skutečný lokální log. Opakovaný event vytvořil jediný záznam. Suppression vznikla pouze v původní firmě. Doručení skutečného webhooku na produkční URL nebylo vyvoláváno. |
| Nástěnka, reporty, oznámení, vyhledávání, Esko | Částečně ověřeno | Report PDF z reálného DB snapshotu, vyhledávání vracelo 4 syntetické výsledky. Browser kontroloval Chromium/WebKit, 390/1440 px; 20 z 24 kombinací tras má doložené HTTP 200, bez zachycených API chyb a horizontálního přetečení. Některé screenshoty/zbývající navigace skončily timeoutem nebo přerušením navigace při Fast Refresh; nejde o úplné vizuální schválení. Esko otevřelo chat, správně odpovědělo „Po splatnosti je 1 faktura za 100 Kč“ a zavřelo se. |
| Tarify a Stripe | Částečně ověřeno | SQL/unit testy limitů a webhooků; lokální firmy byly billing-exempt. Žádná skutečná platba, změna předplatného ani produkční Stripe webhook. Produkční měsíční počítadla chybí s migrací F4. |

## Potvrzené nálezy a pořadí oprav

### F1 — P1: Aplikační MFA lze obejít přímým čtením Supabase

**Dopad:** držitel samotného hesla dostane finanční údaje firmy bez druhého faktoru, i když aplikační API správně vyžaduje MFA. Izolace mezi firmami v provedeném testu fungovala.

**Reprodukce:** přihlásit syntetického člena přes `auth.signInWithPassword`, neposlat/neověřit aplikační MFA, použít veřejný klíč a získanou session k `from('invoices').select(...)`. Admin, účetní i čtenář přečetli 2 vlastní faktury. Dotaz na druhou firmu vrátil 0. [Důkaz](security-probe.json). Produkční metadata potvrzují přímé SELECT oprávnění a membership helper bez kontroly `aal2`/email MFA; klientská data v produkci se tímto způsobem nečetla.

**Oprava:** vybrat a zavést jedinou skutečně vynucenou hranici: buď veškeré finanční čtení jen přes server po ověření MFA a odebrat přímé přístupy/RPC, nebo nativní MFA a kontrolu úrovně autentizace v RLS. Pouhá HTTP cookie aplikačního MFA databázové RLS nechrání. Zkontrolovat také související tabulky a veřejné funkce. Odstranit produkční bezpodmínečnou výjimku konkrétního testovacího e-mailu v `isEmailMfaBypassed`. Akceptace: heslo bez druhého faktoru nestačí ani přes přímé REST/RPC.

### F2 — P1: OCR označí sloučeného dodavatele a odběratele jako ověřeného

**Dopad:** může vzniknout faktura na nesprávný název protistrany, aniž je toto pole označeno ke kontrole.

**Reprodukce:** nahrát přiložený [syntetický vstup](ocr-synthetic-input.pdf), kde jsou dodavatel a odběratel vedle sebe. API vrátilo `counterparty_name = "Audit firma A Audit odběratel B"`, `field_decisions.counterparty_name.status = verified`, confidence 0,96. Správně je pouze `Audit odběratel B`. Částka 1 210 Kč byla správná; nejasný e-mail a data API vyprázdnilo a označilo jako chybějící. [Skutečná odpověď API](actual-ocr-response.json).

**Oprava:** při skládání PDF textu zachovat oddělení sloupců a souřadnice jednotlivých rolí. Hodnotu přesahující sekci odběratele nebo obsahující identitu vlastní firmy vracet ke kontrole. Přidat tento dokument jako regresi textového PDF i rastrového OCR. Akceptace: přesný odběratel, nebo zřetelně neověřené pole; nikdy chybný název jako `verified`.

### F3 — P1: Ruční odeslání ignoruje blokaci po complaint

**Dopad:** po zapsané blokaci aplikace znovu předá adresu poskytovateli, ač automatický worker ji umí potlačit.

**Reprodukce:** platným lokálním webhookem vytvořit `email_suppressions.reason=complained`, potom zavolat `POST /api/invoices/:id/send` bez `purpose=issue`. Endpoint vrátil 200 a lokální provider převzal zprávu. Test nepoužíval skutečné odeslání. [Důkaz](manual-send-results.json).

**Oprava:** společná serverová kontrola suppression před každou cestou odeslání, včetně ručního odeslání a retry. Blokaci neobcházet neoznačeným ručním požadavkem. Akceptace: zablokovaný adresát nevytvoří nový provider request.

### F4 — P1/P2: Produkční migrace neodpovídají aktuálnímu kódu

Chybí:

1. `20261022221912_subscription_monthly_usage.sql` — počítadla a atomické měsíční limity. Aplikační čtení při chybě sloupců pokračuje bez této kontroly; DB trigger nemá novou měsíční ochranu.
2. `20261023210625_notification_system.sql` — tabulky/funkce oznámení; produkční `notification_events` a feed chybí.
3. `20261025194356_invoice_creation_document.sql` — DB ochrana neměnnosti vystaveného dokladu a přehled DPH z jeho položek. Aplikační PUT ochrana existuje, DB pojistka chybí; smíšené sazby nemají odpovídající novou agregaci.

[Čtená historie a advisory](production-metadata.json), [ověřené produkční objekty a RLS](production-observations.json). Migrace finančního snapshotu je naopak nasazená. **Oprava:** po odstranění kritických chyb ověřit deployment balík na stagingu, nasadit chybějící migrace v pořadí a znovu porovnat schema/RPC a součty smíšeného DPH. Nasazení nebylo součástí tohoto auditu a nebylo provedeno.

### F5 — P2: Ruční odeslání není odolné proti souběžnému opakování

Dva souběžné shodné požadavky na ruční odeslání skončily 200/200 a vytvořily **2 provider zprávy**. Ruční větev generuje pokaždé nový `idempotencyKey`; větev prvního odeslání vystaveného dokladu má stabilní klíč a její opakování prošlo správně. [Důkaz](manual-send-results.json).

**Oprava:** identifikátor jedné uživatelské akce sdílený mezi opakováním/souběžnými požadavky a atomická serverová evidence odeslání. Úmyslné nové odeslání může mít nový identifikátor. Akceptace: stejná akce vytvoří nejvýše jednu zprávu i při souběhu a retry.

### F6 — P2: Hybridní OCR nemá funkční lokální Gemini konfiguraci

Lokální klíč je přítomen, ale aplikace jej odmítá s `invalid_key_format` před voláním poskytovatele. Hybridní API pokračovalo lokálně. Produkční tajný klíč nebyl čten. [Důkaz](ocr-provider-results.json), [průchod API](api-flow-results.json).

**Oprava:** ověřit správný klíč a dostupný model pro příslušné prostředí; provést canary s výhradně syntetickým dokladem. Dokud je AI větev vypnutá/nefunkční, neoznačovat ji za úspěšnou a kontrolovat degradaci v provozních metrikách.

### F7 — P2: Zpětná vazba OCR se eviduje, ale neopravila další rozpoznání

Po skutečně uložené opravě názvu na `Audit odběratel B` druhé zpracování stejného syntetického vzoru znovu vrátilo původní chybný název, opět jako `verified`. V aplikačním kódu jsou INSERTy do review/suggestion tabulek, bez nalezeného konzumenta pro další OCR. To je odlišné od existujícího dohledávání kontaktů v zákaznickém registru. [Důkaz](ocr-learning-results.json).

**Oprava:** zavést řízené použití potvrzených oprav se scope firmy a identitou/layoutem dokumentu, evidencí původu a možností odvolání. Neučit se z neověřených návrhů. Akceptace: další podobný dokument využije opravu ve stejné firmě, nikoliv v cizí.

### F8 — P2: Regresní sada není zelená

Celkem **2 147 úspěšných a 17 neúspěšných testů**, 236 úspěšných a 11 neúspěšných souborů. Část kontroluje už změněné texty, přesunuté komponenty, pořadí menu a starý mobilní CSS; tato selhání sama nedokládají funkční regresi. Další kontroly hlásí nejednotné `request_id`/chybové odpovědi a dvě routy s vracením neznámé výjimky. UI test platebního filtru také selhal; jeho skutečnou interakci je potřeba znovu prověřit. [Kompletní výstup](unit-tests.log).

**Oprava:** rozlišit zastaralá očekávání od vadných funkcí, opravit smlouvu chybových odpovědí, přesunout relevantní kontroly od hledání textu ve zdroji k chování a získat zelený CI. Testy pouze nevypínat.

## Další omezení a zjištění

- Supabase advisory: mutable `search_path` u `private.assistance_normalize_account` a vypnutá ochrana proti uniklým heslům. [Search path](https://supabase.com/docs/guides/database/database-linter?lint=0011_function_search_path_mutable), [ochrana hesel](https://supabase.com/docs/guides/auth/password-security#password-strength-and-leaked-password-protection). Dvacet INFO o RLS bez policy nepovažuji automaticky za chybu: u servisních tabulek jde o očekávané nepřístupné tabulky; rozhodují granty a zamýšlený přístup.
- Současná původní lokální konfigurace nezapíná CAMT ani novější payment assistance/payer memory pro žádnou firmu. SQL/parserové testy těchto větví nejsou důkazem jejich provozního zapnutí.
- Produkční cron nebyl spuštěn. Konfigurace repozitáře uvádí denní reconcile v 05:30 UTC a check-due v 06:00 UTC; skutečné doručení cron triggerů a jejich logy na hostingu nejsou tímto auditem potvrzené. Chybějící `cron.job` v DB není chyba Vercel Cronu.
- První lokální build správně odmítl vývojovou `APP_BASE_URL=http://127.0.0.1:3000`; build s HTTPS přepsanou pouze pro příkaz prošel. Není to důkaz chybné produkční URL.
- Některé první integrační pokusy narazily na neúplnou přípravu syntetické firmy (předplatné, DIČ, kategorie upomínek) a pomalou dev kompilaci. Po doplnění předpokladů byly příslušné hranice ověřeny znovu. Odmítnutí opakovaného uložení již použitého OCR souboru vrací 400, nikoliv původně očekávané 409; následná kontrola prokázala jedinou fakturu a jediný review záznam. Historické neúspěšné pokusy jsou ponechány v důkazech, nejsou vydávány za produktové chyby.
- Neprováděla se fyzická platba, bankovní připojení, test skutečné tiskárny, změna Stripe předplatného ani čtení obsahu soukromé Gmail schránky.

## Ověření, důkazy a opakování

- `corepack pnpm test` — 2 147 pass / 17 fail; [log](unit-tests.log).
- `corepack pnpm lint` a `corepack pnpm typecheck` — prošly; [lint](lint.log), [typecheck](typecheck.log).
- `APP_BASE_URL=https://www.splatno.com corepack pnpm build` — prošel; [build](build-https.log).
- `node scripts/test-*-db.mjs` spouštěné jednotlivě pro všech 11 odpovídajících skriptů — prošly; [přehled](db-results.json). Tyto sady používají PGlite a stubované Auth/Storage schéma; samy nejsou důkazem Supabase Auth end-to-end.
- Skutečné lokální API/DB: [první průchod](api-flow-results.json), [dokončení párování a auditní stopy](api-resume-results.json), [GPC a validace](import-extra-results.json), [upomínka a webhooky](reminder-webhook-results.json), [role](role-api-results.json), [účetní](accounting-api-results.json), [registrace a obnova hesla](registration-recovery-results.json), [Esko](esko-results.json).
- [Browser kontroly](browser-followup-results.json), [OCR a provider](ocr-provider-results.json), [druhý dokument](ocr-learning-results.json), [syntetické vystavené PDF](local-issued-invoice.pdf), [report PDF](local-financial-report.pdf).

Pro opakování integračního průchodu vytvořit nový izolovaný Supabase projekt se všemi migracemi, dvě firmy s účtem a DIČ, aktivní syntetické předplatné a výchozí upomínkovou kategorii. Použít běžné účty všech rolí, samostatný aplikační port a lokální Resend endpoint. Nahrát přiložený syntetický doklad, opravit odběratele, uložit, nahrát odpovídající CSV s VS a částkou, potvrdit import a porovnat DB. Podepsané webhooky směrovat výhradně na lokální aplikaci. Ostré testovací zprávy znovu neposílat bez dalšího záměru uživatele; důkaz tohoto auditu již obsahuje oba provider identifikátory.

Produktový kód, veřejná API a produkční schéma nebyly během auditu měněny. Auditní aplikace, kontejnery a svazky byly odstraněny; dočasné účty, hesla, session cookies a klíče byly odstraněny s izolovanými daty a soubory. Původní lokální data byla zachována. [Záznam dokončení](completion.json).
