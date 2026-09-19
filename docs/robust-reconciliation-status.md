# Robustní párování – stav ověření 18. 9. 2026

## Dokončené pojistky

- Desetinná aritmetika na vstupu, zachování OCR součtu a výslovné potvrzení každého rozdílu (včetně 0,18 Kč).
- OCR peněžní snapshot na serveru; klient nemůže nahradit původní součet. Staré faktury nemají domyšlený snapshot.
- Potvrzené počáteční úhrady v platební evidenci, včetně plné úhrady. Jejich editace přes fakturu je zakázaná.
- Editace uhrazené faktury nesmí vytvářet další úhradu. Opravy peněžních hodnot mají neměnnou historii.
- Párování celé dávky, kontrola konfliktu identifikátorů a potvrzeného účtu, omezení velkých skupin kandidátů.
- V4 databázová kontrola aktuálních kandidátů před automatickým zápisem; změna po náhledu přesune položku ke kontrole.
- Samostatné chyby položek, idempotence dokončených položek, obnovitelné zpracování uloženého náhledu po 100 položkách.
- Serverové počty a průběh v UI; automatické obnovení nezahazuje rozpracované ruční volby.
- Zrušen úklid starých importů ve stavu `review`: mohou již obsahovat zaúčtované úhrady. Ani chyba konkurenčního nahrání nemaže sdílený originál.

## Ověřeno

- `corepack pnpm test`: 344 testů / 66 souborů.
- `corepack pnpm typecheck`, `corepack pnpm lint`, `corepack pnpm check:migrations`.
- V lokálním Postgresu, s rollbackem testovacích dat:
  - `supabase/tests/robust_reconciliation.sql`: shadow, opakované potvrzení, překryv výpisu, soulad ledgeru.
  - `supabase/tests/reconciliation_integrity_guards.sql`: plná počáteční úhrada, neměnnost OCR původu, audit změny částky, konflikt vzniklý po náhledu a nezávislé dokončení druhé úhrady.
- Dávky 10 000 položek ověřeny v JS párování: odlišné VS a patologicky shodné částky. Nejde o zátěžový test celé databázové pipeline.

## Nasazení

1. Záloha a aplikace všech dosud nenasazených migrací ve jmenném pořadí. Poslední je `20260918190000_reconciliation_integrity_guards.sql`; navazuje na v4 z `20260918180000`.
2. Nasadit aplikaci se `PAYMENT_RECONCILIATION_MODE=shadow` a ověřit cron `/api/cron/reconcile-payments` a jeho `CRON_SECRET`.
3. Jako účetní/admin provést read-only `GET /api/payments/audit`. Chybějící původní OCR součty nelze tímto auditem porovnat; musí se dohledat v dokumentech.
4. Porovnat shadow výsledky na skutečných anonymizovaných výpisech. Automatiku nepovolovat jen na základě úspěšných unit testů.
5. Teprve po schválení výsledků přepnout nové importy na `automatic`. Již uložené importy uchovávají svůj režim.

V této úpravě nebyla měněna produkční databáze ani zapnuta automatika.

## Co ještě brání prohlášení celého původního plánu za hotový

- Automatická shoda podle přesného jména plátce a přesné zbývající částky je záměrně povolená rozhodnutím vlastníka. Pokud stejnému jménu a částce odpovídá více faktur nebo existuje konflikt, položka zůstane k ruční kontrole.
- Obnovitelnost nyní začíná uloženým náhledem. Samotné parsování a sestavení náhledu stále běží v HTTP požadavku, nikoli v trvalé ingest frontě.
- Upomínky znovu čtou dluh, ale stále chybí úplná koordinace okamžiku externího odeslání se souběžnou úhradou. Jedna databázová transakce sama nemůže atomicky zahrnout e-mailového poskytovatele.
- Chybí integrační test dvou souběžných databázových klientů a end-to-end zátěžový test 10 000 transakcí, včetně přerušení procesu.
- Audit produkčních dat a reprezentativní sada variant skutečných bankovních výpisů zatím nebyly provedeny. Lokální testy je nenahrazují.

Předchozí body jsou skutečné zbývající práce, ne tvrzení, že samotné nasazení migrace dokončí celý plán.
