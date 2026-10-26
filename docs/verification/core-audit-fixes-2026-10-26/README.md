# Opravy vybraných nálezů auditu — 26. 10. 2026

Rozsah: F2, F3, F4, F5 a F8 z [původního auditu](../core-audit-2026-10-26/README.md). Původní audit a jeho důkazy jsou zachované. Opravy aplikace jsou připravené a ověřené lokálně. **Všechny čtyři produkční migrace byly 26. 10. 2026 po výslovném souhlasu uživatele úspěšně nasazeny.** Následné metadata, oprávnění a kontroly odmítnutých volání prošly. Aplikace nebyla nasazena ani odeslána na main.

## Ruční odesílání a blokované adresy

- Sdílená kontrola `email_suppressions` těsně před každým odesláním faktury/upomínky, včetně kopií CC; kontrola je omezená na organizaci. Chyba načtení blokací odeslání zastaví.
- Nová databázová rezervace zamyká fakturu a prověřuje roli i aktuální členství. Souběžné ruční požadavky nemohou získat dvě současné rezervace.
- Klient drží identifikátor akce přes opakování po chybě; rychlé opakované kliknutí nevytvoří ani druhý potvrzovací dialog. Starší klient bez identifikátoru používá databázovou ochranu a 60sekundové přehrání poslední přijaté akce.
- Přesný obsah požadavku Resendu včetně základově kódovaných PDF příloh se uloží před předáním poskytovateli. Opakování používá stejný obsah a stejný provider key, i když nový render PDF vytvoří jiné bajty. Po přijetí poskytovatelem se obsah z DB odstraní.
- Alias identifikátoru zachovává deduplikaci i po převzetí nevyřešené akce obnoveným klientem. Přijetí zprávy je evidované nezávisle na aktivitě faktury.
- Nevyřešená akce po 23 hodinách vyžaduje kontrolu; automatické opakování po vypršení 24hodinové platnosti klíče u [Resendu](https://resend.com/docs/dashboard/emails/idempotency-keys) by mohlo vytvořit druhou zprávu. Změněný doklad/adresát oproti nevyřešené akci rovněž vyžaduje kontrolu.
- Nové servisní tabulky mají RLS, žádná klientská oprávnění; nové funkce jsou `security invoker`, s prázdným search_path a pouze pro service_role. Aplikace vyžaduje novou migraci před nasazením.

## Odběratel v OCR

- Sekce dodavatele a odběratele se u dvou sloupců skládají z původních souřadnic PDF tokenů / OCR slov. Řádky částek a celkový dokumentový layout zůstávají dostupné původnímu parseru.
- Smíšený název obsahující dodavatele se vyprázdní, označí ke kontrole a nevrací se zpět jako automaticky předvyplněný kandidát.
- Název přečtený pouze z obrázku vyžaduje potvrzení přesného znění. Rastrové OCR může zaměnit diakritiku; test ji nezakrývá stavem `verified`.
- Nové regrese používají skutečné syntetické PDF a PNG z auditu v `src/test/fixtures/ocr-two-party-columns.*`. PDF vrací `Audit odběratel B`; PNG oddělí správnou protistranu a vyžaduje potvrzení znění. Nejednoznačný případ bez geometrie nevrací ověřený smíšený název.

## Testy a chyby API

Původních 17 selhání je vyřešeno. Zastaralé kontroly nyní odpovídají rozděleným komponentám, pořadí menu, aktuálním částkám a skutečnému otevření filtru plateb. Kontroly nebyly vypnuté. Obnovený popis chybějícího zákaznického odkazu zůstává dostupný v titulku IČO.

Nové API cesty vracejí pro provozní chyby bezpečné zprávy s `request_id`; odpovídající serverové logy obsahují stejné ID. Validační zprávy vystavení mají vlastní typ `InvoiceCreationError`; neznámé výjimky parseru/PDF/databáze se neposílají uživateli. Přidané runtime testy ověřují validaci, interní chyby a selhání načtení firmy při náhledu PDF.

## Nasazený produkční balík

Potvrzený připojený projekt: `liczsygjiuaobdzytyea`. `supabase db push --linked --include-all --dry-run` úspěšně vypsal přesně tyto čtyři soubory:

1. `supabase/migrations/20261022221912_subscription_monthly_usage.sql` — měsíční počítadla a atomické limity. Doplní aktuální měsíční využití existujících předplatných.
2. `supabase/migrations/20261023210625_notification_system.sql` — oznámení, čtení, oprávnění a triggery.
3. `supabase/migrations/20261025194356_invoice_creation_document.sql` — neměnnost vystaveného dokladu a souhrny smíšených sazeb DPH.
4. `supabase/migrations/20261026155203_invoice_email_delivery_guard.sql` — rezervace, aliasy a přesné opakování odeslání.

První pokus o `supabase db push --linked --include-all --yes` odmítla automatická kontrola schválení, protože žádala výslovný souhlas s konkrétním produkčním balíkem. Po vysvětlení migrací uživatel odpověděl „ano to implementuj“. Následný suchý běh znovu potvrdil přesně uvedené čtyři migrace; skutečné nasazení prošlo se zachováním původních verzí v historii. [Log nasazení](migration-deploy.log).

Kontrola po nasazení:

- Migrační historie obsahuje všechny čtyři očekávané verze a názvy; [suchý běh po nasazení](migration-postcheck.log) potvrzuje aktuální databázi bez čekajících migrací.
- Měsíční sloupce jsou přítomné, počítadla inicializovaná a DB trigger obsahuje ochranu limitu.
- Ochranný trigger vystaveného dokladu je aktivní; reportovací funkce používá rozpis sazeb uloženého dokladu.
- Nové e-mailové tabulky mají RLS a žádné SELECT oprávnění pro anon/authenticated. Tři e-mailové a dvě notifikační servisní funkce mají prázdný search_path, security invoker a EXECUTE pouze pro service_role.
- Notifikační tabulky mají obě očekávané čtecí politiky. Volání e-mailové rezervace i notifikačního feedu s neexistujícím členstvím byla skutečně odmítnuta; potvrzení neexistující zásilky vrací false. Nevznikl žádný nový e-mail ani syntetická faktura.
- [Metadata a oprávnění](production-metadata.json), [kontroly funkcí](production-runtime-checks.json), [security advisors](production-advisors.json). Dvě nové INFO RLS bez politik odpovídají záměrně neveřejným servisním tabulkám bez klientských grantů. Dvě dřívější WARN zůstávají: [search_path existující funkce](https://supabase.com/docs/guides/database/database-linter?lint=0011_function_search_path_mutable) a [kontrola uniklých hesel](https://supabase.com/docs/guides/auth/password-security#password-strength-and-leaked-password-protection). Nová WARN nepřibyla.

Databázové předpoklady jsou nasazené. Aplikační deployment a push na main zůstávají samostatným krokem.

## Ověření

- `corepack pnpm test`: **249 souborů, 2 181 testů, vše prošlo** — [výstup](tests.log).
- `corepack pnpm lint`: prošel — [výstup](lint.log).
- `corepack pnpm typecheck`: prošel — [výstup](typecheck.log).
- `APP_BASE_URL=https://www.splatno.com corepack pnpm build`: prošel — [výstup](build.log).
- `node scripts/check-migrations.mjs`: 59 validních migrací.
- Izolovaný kompletní replay všech migrací a SQL testy: [e-mailové rezervace](email-db.log), [měsíční limity a předplatné](billing-db.log), [oznámení](notifications-db.log), [neměnnost faktur, smíšené DPH a nástěnka](invoice-creation-db.log). Testy používají PGlite s testovacím Auth/Storage schématem; nejsou vydávány za živý Supabase průchod ani test reálného souběhu více PostgreSQL spojení. Souběžné požadavky API ověřují regresní testy s kontrolovanou rezervací; SQL funkce serializuje rezervace řádkovým zámkem faktury.
- Produkce: po výslovném souhlasu aplikovány čtyři migrace, doplněna měsíční počítadla a ověřena historie, metadata, oprávnění, inicializace počítadel a odmítnutí neoprávněných volání. Stávající WARN pro `private.assistance_normalize_account` a vypnutou kontrolu uniklých hesel zůstávají mimo tento rozsah. Pro ověření se nenačítaly jednotlivé klientské faktury ani platby.
- Nebyly poslány žádné další skutečné e-maily.

Samostatné nálezy F1 (vynucení MFA při přímém čtení DB), F6 (konfigurace Gemini) a F7 (využívání OCR zpětné vazby) nejsou součástí této objednané čtveřice a zůstávají otevřené. Tato oprava není potvrzením připravenosti celého projektu k produkčnímu nasazení.
