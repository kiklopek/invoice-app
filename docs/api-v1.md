# Splatno Public API v1

API připojuje e-shopy a další serverové aplikace ke konkrétní firmě ve Splatnu. První verze umožňuje vystavovat faktury z cen včetně DPH, spravovat kontakty zákazníků, stahovat PDF, odeslat vystavený doklad a číst platby, upomínky, události a reporty.

Základní URL po nasazení je `https://www.splatno.com/api/v1`. Strojově čitelná smlouva je dostupná bez přihlášení na `/api/v1/openapi`. Implementace je v `src/lib/public-api-openapi.ts`. Dokument používá OpenAPI 3.1.

## Přístup a správa klíčů

Administrátor firmy otevře Nastavení → API a napojení, zadá název napojení, vybere oprávnění a případnou expiraci. Celý klíč se zobrazí jednou. Splatno ukládá SHA-256 hash a zobrazitelný prefix. Samostatný klíč pro každý e-shop nebo systém umožňuje konkrétní napojení zrušit a dohledat jeho požadavky.

Klíč posílejte v hlavičce `Authorization: Bearer <SPLATNO_API_KEY>`. Uložte jej jako serverovou proměnnou prostředí. HTTPS používejte pro všechny vzdálené požadavky. Klíč patří právě jedné firmě. Identifikátory objektů jiné firmy vracejí 404.

Platnost se kontroluje při každém požadavku. Klíč přestane fungovat po zrušení, expiraci nebo ztrátě trvalé administrátorské role jeho autora. Dočasný účet podpory klíče vytvářet nemůže. Při rotaci vytvořte nový klíč se stejnými potřebnými oprávněními, aktualizujte integraci, ověřte volání a zrušte původní klíč. Deduplikace vytvoření faktury i zákazníka je oddělená podle firmy a operace, takže pokračuje přes rotaci klíče.

| Oprávnění | Operace |
|---|---|
| `invoices:read` | Seznam, detail a PDF faktur |
| `invoices:write` | Vystavení faktury |
| `invoices:send` | Odeslání vystavené faktury |
| `customers:read` | Seznam a detail zákazníků |
| `customers:write` | Založení zákazníka a změna kontaktu |
| `payments:read` | Čtení bankovních plateb |
| `payments:write` | Kladná počáteční úhrada při vystavení faktury |
| `reminders:read` | Čtení historie upomínek |
| `reminders:write` | Pozastavení a obnovení upomínek faktury |
| `reports:read` | Čtení finančního souhrnu |
| `company:read` | Údaje a bankovní účty firmy |
| `events:read` | Průběžné načítání událostí faktur |

Výchozí limit je 120 požadavků klíče za 60 sekund. Odpovědi po úspěšné autentizaci obsahují `X-RateLimit-Limit`, `X-RateLimit-Remaining` a `X-RateLimit-Reset`, poslední jako ISO timestamp. Při 429 počkejte počet sekund v `Retry-After`. Zápis opakujte se stejným klíčem operace. Provozní historie uchovává identifikátor klíče, cestu, metodu, stav a dobu zpracování. Těla požadavků ani tajné klíče se do této historie neukládají.

## Rozhraní

| Metoda a cesta | Výsledek |
|---|---|
| `GET /invoices` | Stránkovaný seznam, filtry `status` a `variable_symbol` |
| `POST /invoices` | Vystavení faktury, případně s potvrzenou počáteční úhradou |
| `GET /invoices/{id}` | Aktuální stav, částka, úhrady a dostupný snapshot dokladu |
| `GET /invoices/{id}/pdf` | PDF, `Content-Type: application/pdf` |
| `POST /invoices/{id}/send` | První odeslání vystaveného dokladu zákazníkovi |
| `PATCH /invoices/{id}/reminders` | Nastavení `{ "paused": true }` nebo `false` |
| `GET /customers` | Stránkovaný seznam zákazníků |
| `POST /customers` | Založení zákazníka s ochranou proti opakování |
| `GET /customers/{id}` | Detail zákazníka |
| `PATCH /customers/{id}` | Změna e-mailu nebo telefonu |
| `GET /company` | Údaje firmy a její bankovní účty |
| `GET /payments` | Bankovní platby, volitelný filtr `invoice_id` |
| `GET /reminders` | Upomínky, volitelný filtr `invoice_id` |
| `GET /events` | Události, volitelné filtry `invoice_id` a `type` |
| `GET /reports` | Souhrn za `from` a `to`, jednu měnu a zvolené filtry |
| `GET /openapi` | Veřejná OpenAPI smlouva |

JSON zápisy vyžadují `Content-Type: application/json` a tělo do 64 KiB. Nepodporovaná pole se odmítají. Částky v odpovědích jsou desetinné řetězce se dvěma místy. V požadavcích jsou přijímána čísla i řetězce s nejvýše dvěma desetinnými místy, řetězce jsou doporučený formát pro účetní integrace. Data používají `YYYY-MM-DD`, časové údaje ISO 8601. Jednotlivé měny se nesčítají.

## Vystavení faktury z objednávky

Integrace sestaví úplnou objednávku, včetně dopravy, konečných cen a potvrzené sazby každé položky. Příklad používá syntetického zákazníka a sazbu pouze pro ilustraci API. Sazby pro konkrétní zboží, dopravu a vratné obaly určuje konfigurace napojení ověřená účetní.

```bash
curl --fail-with-body 'https://www.splatno.com/api/v1/invoices' \
  -H "Authorization: Bearer $SPLATNO_API_KEY" \
  -H 'Content-Type: application/json' \
  -H 'Idempotency-Key: order-demo-0001' \
  --data '{
    "variable_symbol": "2600001",
    "issue_date": "2026-11-14",
    "due_date": "2026-11-21",
    "currency": "CZK",
    "payment_method": "bank",
    "customer": {
      "name": "Ukázkový zákazník",
      "address": "Ukázková 1, 602 00 Brno",
      "email": "zakaznik@example.com"
    },
    "items": [
      {"description":"Ukázková položka","quantity":"2","unit":"ks","unit_price_gross":"1120.00","vat_rate":12}
    ],
    "expected_total": "2240.00",
    "public_note": "Objednávka DEMO-0001"
  }'
```

Splatno přidělí číslo ve své roční řadě a použije nastavení dodavatele, jeho účet pro danou měnu a výchozí kategorii upomínek. `tax_date` je při vynechání shodné s datem vystavení. `currency` má výchozí CZK a `payment_method` hodnotu bank. Položka má povinný popis, kladné množství do 1 000 000 se šesti desetinnými místy, jednotku, jednotkovou cenu s DPH a sazbu. Nejvýše je přijato 200 položek. `vat_rate: null` značí položku nepodléhající DPH.

Výpočet shora probíhá za skupinu sazby se zaokrouhlením na haléře. API porovná součet s `expected_total`. Nesoulad vrátí 422 s kódem `total_mismatch` a polem `computed`. Doklad se při nesouladu nevystaví.

Při nové faktuře vrací server 201 a `{ "invoice": { ... }, "replayed": false }`. Opakovaná shodná operace vrací 200 a `replayed: true`. Identifikátor a číslo faktury uložte k objednávce. Klíč operace musí být stabilní už před prvním pokusem, aby bylo možné bezpečně navázat po timeoutu.

Pro každou operaci použijte `Idempotency-Key` s 1 až 100 znaky z množiny písmen, číslic, `_`, `.`, `:`, `-`. Stejný klíč s odlišným normalizovaným obsahem vrací 409 `idempotency_conflict`. Při vystavení lze jako náhradu poslat `request_id` s UUID objednávky. Pokud použijete obě hodnoty, musí se shodovat. Diagnostický `request_id` v chybové odpovědi a hlavička `X-Request-Id` slouží k dohledání požadavku.

Čísla se rezervují atomicky pro firmu a rok. Selhání po rezervaci může v řadě zanechat mezeru. Návrat existujícího výsledku při replayi zachová původní číslo, snapshot a úhradu. Vystavení i přes API podléhá předplatnému a jeho databázovým limitům.

Pro objednávku, u které integrace ověřila úhradu, přidejte `paid_amount` a `payment_confirmed: true`. Klíč musí mít navíc `payments:write`. Počáteční úhrada nesmí převýšit fakturu. Pouhý výběr platby kartou nebo dobírky není potvrzením úhrady. Samostatná operace na libovolnou změnu peněžního stavu není součástí této verze.

Čtení importovaných nebo starších faktur může vrátit `customer.address: null`. Položky, rozpis DPH, DUZP, způsob platby a veřejná poznámka jsou v odpovědi přítomné, pokud má faktura uložený snapshot vystaveného dokladu.

## Odeslání a upomínky

Odeslání je samostatná potvrzená akce. Integrace před voláním zobrazí adresáta a rozsah odeslání. Pak zavolá `POST /invoices/{id}/send` s `Idempotency-Key` a `{ "recipient_confirmed": true }`. Použije se e-mail na faktuře. Vystavení samo e-mail neposílá.

Úspěch vrací `{ "ok": true }`, dříve přijatá zásilka navíc `already_sent: true`. Endpoint chrání první odeslání vystavené faktury i při změně klíče operace. Potlačená adresa, právě probíhající odesílání nebo nevyřešený dřívější pokus mohou vrátit 409 s odpovídajícím `email_*` kódem. Při výpadku ověřte stav a opakujte původní operaci. Přijetí zprávy poskytovatelem a skutečné doručení jsou oddělené stavy.

`PATCH /invoices/{id}/reminders` přijímá `{ "paused": true }` nebo `false` a vrací `{ "reminders": { "invoice_id": "…", "paused": true, "next_reminder_at": null, "updated_at": "…" } }`. Pozastavení ruší čekající a neúspěšné naplánované úlohy. Při aktivním odesílání vrací 409 `reminder_in_flight`. Obnovení používá stávající pravidla plánování a respektuje uhrazené a stornované faktury.

## Zákazníci

`POST /customers` vyžaduje jméno a adresu, volitelně e-mail, IČO a DIČ. Použijte `Idempotency-Key`. Nový záznam vrací 201, opakování stejné operace 200 s `replayed: true`. Existující IČO může vrátit 409 `customer_conflict`, v takovém případě pracujte s existujícím zákazníkem.

`PATCH /customers/{id}` upravuje e-mail, telefon nebo obojí. E-mail musí být platný a nesmí směřovat upomínky na vlastní firmu. Telefon lze vymazat hodnotou `null`. Změna e-mailu používá stejnou logiku jako webové Splatno a může aktualizovat kontaktní e-mail souvisejících faktur. Odpověď obsahuje `updated_invoice_count`. Právní identitu a adresu tato operace neupravuje.

## Stránkování, platby a události

Seznamy přijímají `limit` od 1 do 100 s výchozí hodnotou 50. Odpověď má `data`, `has_more` a `next_cursor`. Pokračujte kurzorem při zachování původních filtrů. Pořadí je vzestupné podle času vytvoření a ID.

`GET /payments?invoice_id=…` zahrnuje přímou vazbu bankovní platby i její potvrzené rozdělení mezi faktury. Pole `allocations` obsahuje jednotlivé vazby `{ "invoice_id": "…", "amount": "1000.00" }`. Jedna platba může mít více alokací. Pro aktuální zůstatek a celkovou úhradu konkrétní faktury používejte `GET /invoices/{id}`.

`GET /events` slouží k pollingu změn. Typy odpovědí mají prefix `invoice.`, například `invoice.paid`, `invoice.payment_changed`, `invoice.reminders_paused` a `invoice.emailed`. Filtr `type` přijímá název bez prefixu, například `paid`.

Ukládejte poslední `next_cursor` i při `has_more: false`. Po vyčerpání stránek počkejte a zopakujte požadavek s tímto kurzorem. Prázdná stránka zachová vstupní kurzor. Události deduplikujte podle ID a pro aktuální stav načtěte detail faktury. Pozdně potvrzené souběžné transakce mohou vyžadovat pravidelné srovnání stavů faktur, takže samotný časový polling nepoužívejte jako jediný podklad účetního zůstatku. Tato verze poskytuje polling událostí, odchozí podepsané webhooky jsou samostatné další rozšíření.

## Chyby a kompatibilita

Chybová odpověď obsahuje `error`, strojový `code` a diagnostický `request_id`. Klient rozhoduje podle HTTP stavu a kódu, text může být zpřesňován. Pro podporu uchovejte `X-Request-Id`.

| HTTP | Význam |
|---|---|
| 400 | Validace dat, chybějící klíč operace nebo neplatný kurzor |
| 401 | Neplatný přístupový klíč nebo oprávnění jeho autora |
| 402 | Omezení předplatného |
| 403 | Chybějící scope |
| 404 | Objekt není dostupný ve firmě |
| 409 | Konflikt opakování nebo stavu objektu |
| 413 | Tělo přesáhlo 64 KiB |
| 415 | Chybějící nebo nesprávný Content-Type |
| 422 | Součet faktury neodpovídá očekávanému součtu |
| 429 | Limit klíče, respektujte Retry-After |
| 500, 502, 503 | Chyba zpracování nebo dočasná nedostupnost |

Zápisy po síťové chybě a dočasných chybách opakujte s původním klíčem operace a postupným prodlužováním prodlevy. Po 409 ověřte popsaný konflikt. Při nezměněných datech zachovejte původní klíč. V rámci `/v1` zachovávejte význam existujících polí, nové volitelné informace může odpověď přidat. Klienti mají tolerovat doplnění polí. Změna povinných vstupů nebo významu existujících polí patří do nové hlavní verze API.

## Lokální ověření a nasazení

Nové API potřebuje migrace přidané touto větví. Hlavní balík vytváří klíče, oprávnění, audit požadavků a číselné řady. Další migrace zajišťují zákaznickou idempotenci a atomické ovládání upomínek. Schéma a aplikaci nasazujte jako jeden ověřený release se schématem připraveným před zpřístupněním endpointů.

Při této implementaci byla známá odchylka devíti produkčních migrací oproti výchozímu hlavnímu checkoutu. Před nasazením porovnejte přesnou historii cílové databáze a sjednoťte chybějící podklady do kanonické migrační historie. Nové migrace ověřte na aktuálním staging schématu. Historické změny znovu slepě nespouštějte.

Doporučený lokální průchod používá izolovanou testovací firmu se správným plátcovstvím DPH, bankovním účtem, výchozí kategorií upomínek a testovacím předplatným.

1. Přehrajte migrace a spusťte `node scripts/check-migrations.mjs`.
2. Spusťte `node scripts/test-public-api-db.mjs` a ostatní přidané zákaznické a upomínkové SQL sady.
3. Spusťte unit testy API, `corepack pnpm typecheck`, lint a produkční build.
4. Přes Nastavení vytvořte klíč testovací firmy. Zkontrolujte seznam, expiraci a zrušení.
5. Vystavte syntetickou fakturu, opakujte stejný požadavek, ověřte 409 při jiném obsahu a 422 při nesprávné částce.
6. Ověřte PDF, cizí firmu, chybějící scope, limit požadavků, zákaznický kontakt, polling událostí a upomínky.
7. Odeslání ověřte s testovacím poskytovatelem nebo předem zvolenou testovací adresou a potvrzením. Ověřte opakování a stav doručení.
8. Připojte e-shop, uložte ID a číslo dokladu k objednávce a ověřte obnovení po timeoutu bez druhé faktury.

API kód nevytváří samočinně napojení v repozitáři e-shopu. E-shop nastaví serverové `SPLATNO_API_URL=https://www.splatno.com` a `SPLATNO_API_KEY`, sestaví údaje objednávky a provede volání po autorizované akci správce.
