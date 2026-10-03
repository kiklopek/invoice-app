# Nálezy a stav oprav

P1 znamená blokátor požadovaného vydání nebo pilotu. P2 vyžaduje vyřešení či doložené rozhodnutí o riziku před vydáním. „Lokálně opraveno“ neznamená nasazeno.

| ID | Priorita | Nález a reprodukce | Stav / další ověření |
|---|---|---|---|
| AUTH-01 | P1 | RLS faktur kontroluje členství, ne aplikační e-mailové MFA. Lokální skutečný PostgreSQL s JWT kontextem člena před MFA vrací vlastní fakturu; cizí organizaci správně odmítá. Main metadata potvrzují členství jako podmínku SELECT. `database-scale.json`, `remote-metadata.json`. | Otevřeno. Je třeba navrhnout vynucení MFA i pro přímé Data API, včetně bezpečného obnovení relace. Následně ověřit skutečným tokenem přes PostgREST na stagingu. |
| SEC-01 | P1 | Authenticated má v hlavním projektu TRUNCATE na podnikových tabulkách. Oprávnění k obcházení běžného řádkového mazání je nevhodné i bez prokázané dosažitelnosti přes aktuální HTTP API. | Nová migrace lokálně ověřena; hlavní projekt neopravován. Před nasazením otestovat přesná oprávnění na odděleném Supabase. |
| SEC-02 | P2 | Tři privátní pomocné funkce mají měnitelný search_path. | Pevný search_path lokálně opraven migrací, databázový test prošel. Do hlavního projektu neaplikováno. |
| AUTH-02 | P1 ověření | Testovací MFA výjimka vychází z identity e-mailu; audit neprokázal omezení výjimky na testovací organizace. | Neukazovat jako prokázaný útok. Ověřit členství, zákaz přístupu do produkčních organizací a běžného uživatele v izolovaném Auth prostředí. |
| AUTH-03 | P2 | API provoz neprochází stejným obnovením zapamatování jako stránkové navigace; třicetidenní posouvání při pouze API aktivitě není doloženo. | Otevřeno. Ověřit cookies, MFA a refresh po restartu prohlížeče, více záložkách, odhlášení a výhradně API aktivitě. |
| AUTH-04 | P2 | Supabase advisor hlásí vypnutou ochranu proti kompromitovaným heslům. | Konfigurace hlavního projektu potvrzena čtením; změna a ověření čekají na bezpečné testovací prostředí. |
| CAP-01 | P1 | `src/app/api/reports/route.ts` odmítá export nad 20 000 řádků (413). Požadovaných 100 000 řádků tedy nepodporuje. | Otevřeno. Trvalá exportní úloha, úplnost a stažení po zavření stránky; samotné navýšení limitu nestačí. |
| CAP-02 | P1 pilotu | Nová vrstva párování odmítla velkou množinu vstupů s `assistance_input_limit`. Nevydala falešně jednoznačný návrh. | Bezpečné odmítnutí potvrzeno; pilot při požadované kapacitě blokován. Doplnit úplné zpracování po kohortách/stránkách, ověřit nepřeskočení záznamů. |
| PERF-01 | P1 ověření | P95 seznamové SQL zátěže na lokální sadě je 2 587 ms. Plán využívá paralelní sekvenční scan a řazení. | Požadavek p95 API ≤ 2 s není doložen. Měřit skutečné endpointy na pevném stagingu; vhodný index určit podle skutečného filtru a řazení. |
| DEP-01 | P2 | Po opravě Next zůstává 7 high a 4 moderate advisory. Původní critical je odstraněno. | Otevřeno. Zmapovat dosažitelnost jednotlivých cest a aktualizovat dotčené knihovny s regresí; výpis `dependencies-after.json`. |
| ENV-01 | P1 ověření | Produkční validace šla obejít chybějícím NODE_ENV před spuštěním Next. | Wrapper a regrese lokálně opraveny. Build prošel pouze se syntetickou konfigurací; skutečné deployment env není ověřeno. |
| CI-01 | P1 ověření | Obecné CI umožňuje část přihlášených testů vynechat; storageState se dříve rozhodoval před global setup. | StorageState opraven, samostatný přísný workflow přidán. Běžné CI není zaměněno za release gate; zapojení povinného workflow a jeho skutečné úspěšné spuštění zbývá. |
| OPS-01 | P1 | Neexistuje oddělený staging; nelze bezpečně doložit přihlášené E2E, doručování, plné HTTP zatížení a obnovu. | Potvrzeno uživatelem. Připravit oddělený projekt a HTTPS aplikaci; hlavní projekt nepoužít pro destruktivní testy. |
| OPS-02 | P1 | RTO 4 h / RPO 24 h včetně dokumentů, monitoring a rollback nejsou prakticky ověřené. | Otevřeno. Nacvičit obnovu do odděleného prostředí a doložit časy, stáří záloh a úplnost souborů. |
| UI-01 | P1 ověření | Chromium fixture prověrky pokrývají jen vybrané obrazovky. Firefox/WebKit, fyzický iPhone/Android, mobilní klávesnice a všechny autentizované postupy neproběhly. | Částečně ověřeno. Úspěšná geometrie fixture není plný E2E důkaz. |

## Znovuposouzení historických nálezů

Historická označení nejsou sama důkazem aktuální chyby. MFA/RLS a nadbytečná oprávnění jsou nyní znovu reprodukovaná či potvrzená metadaty. Produkční wrapper je lokálně opraven. Původní tři selhávající zdrojové UI testy prošly po aktualizaci očekávání podle současného designu. Neuložené formuláře, dvojklik upomínek, konkrétní dialogy a nejednoznačné navigační selektory nejsou touto lokální prověrkou prohlášeny za opravené: vyžadují aktuální přihlášenou reprodukci. Celá historie původních auditů nebyla znovu přehrána.
