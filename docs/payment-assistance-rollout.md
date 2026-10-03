# Doplňkové párování plateb

Nový engine `assistance-v1` je oddělený od stávajícího `v5`. Nenavrhuje automatické
účtování: úhrady zapíše pouze účetní/admin po potvrzení přesného rozdělení částek.
Původní párování a rozpracované importy pokračují původní cestou.

## Nasazení

1. Zálohovat databázi a nejprve ověřit nové migrace v odděleném prostředí.
   Aplikovat `20261003101756_payment_assistance.sql` a
   `20261003103140_camt_statement_evidence.sql` až po předchozích migracích.
   Historické migrace nejsou měněné. Nové tabulky nejsou dostupné anonymním ani
   běžným přihlášeným klientům; API ověřuje firmu a roli a používá serverový klient.
2. Nasadit aplikaci se všemi novými přepínači vypnutými. Bez allowlistu firem se
   nečtou nové tabulky, nezobrazí nový panel ani nezpracuje nová fronta.
3. Nastavit `PAYMENT_ASSISTANCE_ORGANIZATIONS` na UUID testovací firmy a
   `PAYMENT_ASSISTANCE_MODE=shadow`. Archiv plateb nabídne „Znovu vyhodnotit“.
   Návrhy se uloží pro porovnání, nejsou zobrazované jako úhrady a nejdou potvrdit.
4. Na reprezentativních anonymizovaných výpisech nezávisle označit správné
   alokace, včetně negativních případů. Porovnat chybná přiřazení a pokrytí vůči v5.
   Nulové chyby na syntetických případech nejsou dokladem produkční přesnosti.
5. Po vyhodnocení přepnout zvolenou firmu do `review`. Volitelně povolit
   `PAYMENT_PAYER_MEMORY_ENABLED=true` a `PAYMENT_REEVALUATION_ENABLED=true`.
   Nové úhrady vždy potvrzuje člověk. Staré automatické shody podle jména se nemění.

## Paměť, fronta a audit

„Zapamatovat pro příště“ je samostatná akce v novém panelu po ručním přiřazení.
Vazba má zdrojové platby, IČO, potvrzujícího uživatele, revizi a historii změn.
Nevzniká převodem staré tabulky účtů ani učením z automatických návrhů.
Reference v první verzi znamená přesný opakující se text zprávy, nikoli regulární
výraz či automaticky odvozené pravidlo. Sdílené vazby zůstávají nejednoznačné.

„Čeká na fakturu“ je pomocný příznak, který nemění dluh ani upomínky. Návrhy
zpracovávají již evidované nepřiřazené zůstatky, ne rozpracované importní alokace.
Platby kompletně přiřazené, zrušené výpisy a nesouvisející položky se nevyhodnocují.

Změny vstupů zneplatní návrhy; automatické přeřazení neexistuje. Fronta má jeden
deduplikovaný požadavek na firmu, generaci vstupů, dvouminutový pronájem a opakování
po chybě. Denní stávající cron nejprve dokončí v5, potom zpracuje novou frontu.
Tlačítko umožňuje okamžité zpracování; po pádu se požadavek obnoví po vypršení pronájmu.
Pokud je automatické přehodnocování vypnuté, změny návrhy stále zneplatní, ale nový
výpočet musí vyžádat uživatel. Limity: 10 000 vstupních plateb/faktur, na skupinu
32 faktur, 12 plateb a 100 000 stavů. Překročení nikdy nevytvoří jednoznačný návrh.

Před potvrzením se zamykají zdrojové platby a faktury a znovu ověřují identity,
měny, datum a zůstatky. Změna vrátí konflikt. Potvrzení je transakční a idempotentní.
Úhrady jsou v současné tabulce alokací, takže stávající historie a uvolnění dál fungují.
Uvolnění zdrojové alokace deaktivuje novou paměť. Audit je v
`payment_assistance_events`; stav fronty v `payment_assistance_jobs` obsahuje chyby,
počet pokusů a dobu výpočtu. Panel ukazuje počty potvrzení a odmítnutí.

## CAMT z KB: ověření ještě vyžaduje reálný vzorek

KB zveřejňuje [specifikaci XML výpisu](https://mojebanka.kb.cz/file/cs/KB-podminky_format_XML_vypis.pdf)
pro `camt.053.001.02`. Kandidátní parser podporuje tuto jmennou oblast,
UTF-8 a jeden účet/výpis. Skutečný výpis KB/KB+ v repozitáři zatím není.
**Nezapínat `PAYMENT_CAMT_KB_SAMPLE_VERIFIED`, dokud se neověří skutečný export
z používaného bankovního kanálu**, jeho zůstatky, účty, zprávy a reference.
Dokument z roku 2016 sám neprokazuje aktuální formát exportu KB+.

Import XML vyžaduje oba přepínače `PAYMENT_CAMT_ENABLED=true` a
`PAYMENT_CAMT_KB_SAMPLE_VERIFIED=true`, allowlist firmy a stávající oprávnění k importu.
Všechny CAMT importy zůstávají v režimu ruční kontroly i při zapnuté v5 automatice.
Původ údajů se uchovává u položky. DTD a externí entity se odmítají. Dávky se dělí
pouze při přesné shodě jednotlivých částek se zaúčtovaným součtem.

Bankovní `AcctSvcrRef` se používá pro identitu pohybu v rámci účtu; EndToEndId
není spolehlivým ID transakce. Opakovaná bankovní reference se vyřadí jako duplicita,
rozpor částky/měny/data se označí jako chyba. Shoda účtu, data a částky napříč
formáty vyvolá kontrolu. Bez samostatného potvrzení „jde o další platbu“ se položka
nezaúčtuje ani ručně. Toto potvrzení se zapisuje do auditu.

## Kontroly a návrat

Implementace je lokální; migrace nebyly aplikovány na vzdálenou databázi a
funkce nebyly zapnuty v produkci. Typová kontrola, lint, kontrola 33 migrací,
produkční build, 28 cílených testů nové vrstvy a oba databázové harnessy prošly.
V prohlížeči byla ověřena skupina dvou splátek, potvrzovací dialog, následné
samostatné zapamatování zákazníka a mobilní šířka 390 px bez přetékání a JS chyb.
Jde o syntetický náhled, nikoli o test produkčního přihlášení.

Celá sada stále obsahuje tři selhání původních testů textové podoby rozhraní:
`import-ui-regressions.test.ts` očekává dřívější wizard `aria-current`, dva
případy `mobile-responsive.test.ts` očekávají původní CSS mřížku faktur.
Tyto části byly rozpracované před implementací a nebyly přepsány kvůli testům.
Podmínky vydání tedy zatím nejsou splněné: před pilotem vyřešit tyto nesoulady,
ověřit migrace a autentizaci ve stagingu a porovnat návrhy na označených skutečných
datech. CAMT navíc vyžaduje skutečný anonymizovaný export KB.

```text
corepack pnpm test
corepack pnpm typecheck
corepack pnpm lint
corepack pnpm check:migrations
npm install --prefix .cache/reconciliation-tools --no-save --package-lock=false @electric-sql/pglite@0.3.14 embedded-postgres@17.10.0-beta.17 pg@8.16.3
node scripts/test-payment-assistance-db.mjs
node scripts/test-payment-assistance-concurrency.mjs
node scripts/preview-payment-assistance.mjs
```

Lokální SQL harness přehrává všechny migrace a staré i nové testy v PostgreSQL
ve WASM. Supabase Auth a Storage nahrazuje prázdným schématem pro testování.
Samostatný concurrency harness spouští skutečný izolovaný PostgreSQL 17 na
loopbacku, přehraje stejné migrace a SQL testy a navíc dvěma nezávislými spojeními
ověří souběžné potvrzení, konflikt s editací faktury a souběh workeru s potvrzením.
Oba harnessy prošly. Preview používá skutečnou komponentu, engine a testovací
databázi se syntetickými platbami; nahrazuje přihlašování testovací identitou.
Tyto kontroly nenahrazují ověření skutečného Supabase prostředí, přihlášení
v nasazené aplikaci ani porovnání na ručně označených reálných datech.

Nouzově nastavit `PAYMENT_ASSISTANCE_MODE=off`, vypnout ostatní nové přepínače
a vyprázdnit allowlist. API pak nové změny nepovolí a worker se nespustí. Pro úplné
zastavení databázové instrumentace nastavit také režim všech řádků
`payment_assistance_settings` na `off` a `reevaluation_enabled=false` serverovým
admin postupem. Potvrzené úhrady zůstávají v ledgeru a opravují se standardním
auditovaným uvolněním, ne mazáním tabulek nebo plošným rollbackem.
