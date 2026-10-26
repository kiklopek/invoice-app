# Předplatné — audit před implementací, 23. 10. 2026

| Funkce | Existuje | Zdroj pravdy | Doplnění |
| --- | --- | --- | --- |
| Aktuální tarif a stav | Ano | subscriptions, loadSubscription, Stripe mirror | Chybu čtení zobrazit jako chybu; nesimulovat aktivní tarif |
| Nabídka tarifů | Ano | src/lib/plans.ts: Start/Profi/Business, 790/1590/2990 Kč bez DPH | Stejná konfigurace, ročně deset měsíčních cen |
| Změna tarifu | Ano | previewChange/changePlan, serverové ověření rolí a ceny | Zachovat náhled, potvrzení a poměrné účtování; zabránit dvojkliku |
| Karta a historie | Ano, hostované | billingPortalUrl, Stripe | Bezpečná čtecí metadata karty, aktuální cena a poslední doklady |
| Využití | Částečně | trial_invoices_used, DB trigger | Trial má limit; placené limity z nabídky se dosud nevynucují |
| Zrušení/obnovení | Ano | setCancelAtPeriodEnd | Zachovat konec období a potvrzení, stav ověřit opětovným načtením |
| Navigace | Ano | /predplatne, Nastavení → Předplatné | Použít AppFrame a sdílený AppShell |
| Oprávnění | Ano | canManageMembers: pouze admin | Účetní vidí tarif; karta/historie a mutace pouze admin; firma z identity |
| Webhook | Ano | podepsaný Stripe payload, record_stripe_event a čerstvé retrieve | Zachovat, testovat opakované/opožděné doručení |

## Navržená kompatibilní migrace

Nevzniká nový billing systém ani tabulka. Dva sloupce subscriptions budou
uchovávat měsíc a monotónní počet nově uložených faktur. Obdobím je kalendářní
měsíc UTC; faktura se započítá při INSERT bez ohledu na vystavení/splatnost,
stav nebo archivaci. Smazání spotřebu nevrací. Backfill pokryje existující
faktury aktuálního měsíce; již smazané historické faktury nelze rekonstruovat.
Zámek řádku subscriptions serializuje INSERTy. Existující trial počítadlo,
trvalý přístup a kontroly ukončeného předplatného zůstávají. Nový měsíc
počítadlo obnoví při prvním INSERT. Start 100, Profi 500, Business bez limitu,
přesně podle stávající nabídky. Test porovná SQL limity s konfigurací.

Migraci je nutné nasadit před novým serverovým čtením těchto sloupců. Při
nedostupném počítadle UI zobrazí chybu metriky, nikoli falešnou nulu. Produkční
migrace, Stripe operace, push ani deployment se v tomto úkolu neprovádějí.
Testování používá izolovaný PostgreSQL/PGlite a napodobené Stripe odpovědi.

Zákazníci, platby a uživatelé nemají v konfiguraci číselný limit: zobrazí se
pouze skutečný počet jako informativní metrika bez falešného progress baru.
Neexistující Enterprise ani ilustrační karta 4242 se do produktu nepřidají.
