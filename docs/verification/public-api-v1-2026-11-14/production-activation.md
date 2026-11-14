# Aktivace API v připojené databázi — 14. 11. 2026

Po výslovném souhlasu uživatele byly v Supabase projektu `liczsygjiuaobdzytyea` úspěšně aplikovány tři připravené migrace:

| Skutečná verze v databázi | Název |
|---|---|
| `20261114181840` | `organization_public_api` |
| `20261114181846` | `public_api_customers` |
| `20261114181857` | `api_invoice_reminders` |

MCP přidělilo verze v okamžiku nasazení. Soubory v této větvi i v původním lokálním checkoutu byly přejmenovány podle zaznamenané historie. SQL obsah se nezměnil. Původní verze v `real-postgres.json` jsou historickým důkazem předchozího izolovaného testu stejného SQL.

## Ověřené výsledky

- Před nasazením nebyla přítomná tabulka `organization_api_keys` ani funkce pro vytvoření klíče. To byla potvrzená příčina chyby načítání.
- Po nasazení načtení stejného explicitního seznamu metadat jako v nastavení přes skutečné Supabase HTTP API vrací **200**.
- Pod skutečnou rolí `service_role` prošel živý test vytvoření klíče, jeho načtení, autentizace pro povolené oprávnění, odmítnutí nepovoleného oprávnění, zrušení a odmítnutí zrušeného klíče.
- Tento test proběhl v transakci zakončené `ROLLBACK`; nezůstal po něm aktivní klíč ani testovací auditní záznam.
- Přímý anonymní HTTP přístup k tabulce byl odmítnut (`42501`), neplatný hash klíče vrací stav `invalid`.
- Všech sedm nových veřejných databázových funkcí je `security invoker`; EXECUTE má pouze `service_role`, nikoli `anon` nebo `authenticated`.
- Všech pět nových tabulek má RLS, čtení pro `service_role` a nemá SELECT grant pro `anon` ani `authenticated`.
- Lokální kontrola 69 migrací a všechny čtyři API SQL sady po přejmenování prošly.
- Bezpečnostní advisory nepřidalo žádné WARN/ERROR. Pět nových INFO „RLS bez politik“ odpovídá záměrně serverovým tabulkám bez klientských grantů. Dřívější WARN pro vypnutou kontrolu uniklých hesel zůstává mimo tuto aktivaci: [Supabase password security](https://supabase.com/docs/guides/auth/password-security#password-strength-and-leaked-password-protection).

Nebyl proveden merge do `main` ani produkční deployment aplikace. Nebyl vystaven zákaznický doklad, změněna úhrada nebo odeslán e-mail. Authentizovaná browser session uživatele se při kontrole nepoužívala; HTTP ověření se týká přímo připojeného Supabase a skutečných serverových oprávnění.

Sekce „API a napojení“ byla přesunuta pod „Přístupy účetního oddělení“, před historii přístupů. V již otevřeném nastavení stačí použít „Načíst znovu“ nebo stránku obnovit.
