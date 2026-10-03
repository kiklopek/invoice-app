# Audit připravenosti Splatno – 3. října 2026

**Rozhodnutí: NENASADIT.** Lokální část auditu proběhla; celý audit není dokončen. Existuje pouze hlavní Supabase projekt. Přihlášené testy na HTTPS stagingu, skutečné doručování, mobilní zařízení, provozní monitoring a obnova záloh nejsou ověřené. Hlavní databáze nebyla tímto auditem měněna, testovací zprávy zákazníkům nebyly odesílány.

## Verze a rozsah důkazů

Výchozí revizi, rozpracované změny a otisky souborů zachycují [baseline.json](baseline.json), [baseline-status.txt](baseline-status.txt) a [baseline.patch](baseline.patch). Audit pracuje s necommitnutým pracovním stromem, nikoli s již nasazenou verzí. Inventář obrazovek, API, deklarací SQL funkcí, rolí a služeb je v [inventory.json](inventory.json). Před dalšími změnami nebo vydáním je nutné důkazy znovu vytvořit a svázat s konkrétním commitem.

## Ověřeno

- Závěrečná regrese: **1 050 / 1 050 testů PASS**, TypeScript, ESLint a kontrola migrací PASS: [checks.json](checks.json), [unit-results.json](unit-results.json). Jednotkové a zdrojové testy nejsou vydávány za přihlášené E2E. Otisky konečného pracovního stromu: [final-state/baseline.json](final-state/baseline.json), [dependency-hashes.json](final-state/dependency-hashes.json).
- Produkční build Next.js 16.3.6 se syntetickou konfigurací: [build.log](build.log). Nepotvrzuje konfiguraci skutečného nasazení.
- Skutečný izolovaný PostgreSQL: finanční regrese, integrita, návrhy, bankovní důkazy, oprávnění, souběžná potvrzení, zastaralý návrh a souběh pracovníka s potvrzením: [database.log](database.log).
- 300 000 faktur, 300 000 plateb, 600 000 alokací; nezávislé ověření počtu a součtu alokací. Padesát souběžných SQL relací, dvacet nezávislých SQL zápisů: [database-scale.json](database-scale.json). Nejde o padesát přihlášených HTTP relací. Fixture záměrně obsahuje neuhrazenou cache faktur proti zapsanému ledgeru; test nedokládá jejich vzájemné odsouhlasení.
- Chromium: 150 variant dashboardu, 20 variant seznamu faktur, rozložení plateb a importu. Skutečné komponenty se syntetickými daty, částečně nahrazeným shellem: [dashboard-layouts.json](dashboard-layouts.json), [invoice-layouts.json](invoice-layouts.json), soubory `*-ui.log`. Screenshoty jsou v [screenshots](screenshots). Nejde o plné pracovní postupy s databází.
- Skutečný lokální produkční server se syntetickou konfigurací: přihlašovací formulář při 320 px, přístupné popisky a nezaškrtnuté „Zapamatovat si mě“: [login-320.png](screenshots/login-320.png). Životnost relace tím ověřena není.
- Čtení metadat hlavního Supabase projektu bez čtení účetních záznamů: [remote-metadata.json](remote-metadata.json).

## Provedené opravy

1. Tři původně selhávající UI regrese aktualizovány podle současného schváleného rozložení; žádný test nebyl smazán.
2. Wrapper Next nyní před build/start načte konfiguraci a vynutí produkční validaci i bez původního `NODE_ENV`. Přidána regrese. Testovací náhled používá výslovně falešné služby.
3. Next opraven z 16.3.5 na 16.3.6 kvůli kritickému bezpečnostnímu advisory. Po opravě zůstává 7 vysokých a 4 střední nálezy závislostí; nejsou prohlášeny za vyřešené. Viz [dependencies-after.json](dependencies-after.json).
4. Připravena nová bezpečnostní migrace odebrání TRUNCATE/REFERENCES/TRIGGER klientským rolím a pevného search_path tří privátních funkcí. Regrese před opravou selhala, po opravě prošla: [security-before.log](security-before.log), [security-after.log](security-after.log). **Migrace není aplikována do hlavního projektu.**
5. Přidán samostatný release workflow: explicitní HTTPS staging, oddělený Supabase, dvě přihlášení včetně běžného uživatele bez MFA výjimky, zákaz tichého vynechávání a náhradního admin přihlášení, žádné opakování zakrývající nestabilitu. Opraveno předčasné rozhodnutí o existenci storageState. Release kontrola musí být ještě připojena jako povinná podmínka skutečného nasazení.

## Zbývající práce

Konkrétní reprodukce a dopad: [findings.md](findings.md). Pokrytí jednotlivých oblastí: [scenarios.md](scenarios.md). Postup dalšího ověření, obnovy a vydání: [operations.md](operations.md).

CAMT zůstává vypnuté bez skutečného anonymizovaného exportu KB. Nové párování zůstává vypnuté do vyřešení blokátorů a ověření pilotu. Měsíční, čtvrtletní a roční účetní audit zůstává budoucím rozšířením.

Úspěch testů není zárukou bezchybnosti budoucích dat. Výsledek tohoto auditu neopravňuje k ostrému nasazení.
