# Přihlášení: jeden přípravný požadavek

## Následná oprava zrušené relace (22. 10. 2026)

Při skutečném pokusu v 12:28 UTC Auth přijal heslo (`/token` 200), ale při
přípravě prostředí vrátil `/user` 403 `session_not_found`. Ve stejném okně
je zaznamenán `/logout` 204. Lokální diagnostika zaznamenala odmítnutí
bearer relace (`auth_user_rejected`, `AuthSessionMissingError`).

Proxy dříve prováděla odhlášení také při RSC refreshi, přednačtení nebo HEAD
požadavku. Pokud tento požadavek přišel mezi vydáním JWT a nastavením
aplikační session cookie, vyhodnotila právě vytvořenou relaci jako starou
a zrušila ji. Proxy nyní u těchto čtení zachovává stejná přesměrování
a kontroly přístupu, ale nevolá logout a nemaže přihlašovací cookies.
Skutečná návštěva dokumentu se starou relací nadále provede původní úklid.
Výslovné odhlášení přes POST se nemění.

Nový integrační test používá skutečné moduly proxy, bootstrap routy,
podepisování cookies a nainstalovaný Supabase SDK se simulovaným HTTP Auth
a PostgREST. Dočasná kopie původní proxy ve stejném testu způsobila dvě
selhání ze tří, včetně bootstrap odpovědi 401 po přednačtení registrace.
Opravená proxy prochází všemi třemi scénáři: běžné přihlášení do MFA,
důvěryhodné zařízení do onboardingu a odmítnutí skutečně zrušené relace.
Dalších 141 testů ověřilo proxy, přístupové stavy, auth bezpečnost,
bootstrap a důvěryhodná zařízení. Oprava neobchází serverové `getUser`.
Živé přihlášení po opravě zatím nebylo ověřeno.

## Sloučení přípravných požadavků

Po úspěšném `signInWithPassword` formulář pošle `POST /api/auth/access`
s bearer tokenem a JSON `{ remember: boolean }`. Server jednou ověří účet
a členství, uloží přihlašovací preference a potom vyhodnotí důvěryhodné
zařízení. Nastavení MFA cookie tak již při první odpovědi respektuje novou
volbu zapamatování. Ověřování účtu a pravidla přístupu se nemění.

| Práce po ověření hesla | Před změnou | Po změně |
| --- | --- | --- |
| Přípravné HTTP požadavky | 2 souběžné | 1 |
| Volání `getAuthenticatedSession` | 2 | 1 |
| Ověření `getClaims` + `getUser` | 2 sady | 1 sada |
| Načtení vázaného členství | 2 | 1 |

Počet vychází z původní implementace a z kontrol požadavků v prohlížeči.
Původní požadavky běžely paralelně, takže odstranění poloviny požadavků
neznamená poloviční čas přihlášení.

## Kompatibilita a chyby

- Volitelný `remember` mění přihlašovací cookies pouze při explicitním booleanu.
  Volání bez těla a `{}` nadále fungují pro načtení profilu.
- Původní `/api/auth/session-preference` zůstává dostupný beze změn.
- Chyba sítě nebo serveru umožní opakovat sloučený požadavek se stejným
  ověřeným tokenem. Heslo se znovu neposílá. 401/403 zruší lokální relaci.
- Běžný účet pokračuje na MFA, důvěryhodné zařízení podle existujících pravidel
  přímo na cíl a nový zakladatel na onboarding po případném MFA.
- Žádná nová sdílená cache, databázová migrace ani změna testovacích dat.

## Měření

DevTools Performance obsahuje lokální measures `splatno:login:credentials`
a `splatno:login:environment`. Poslední pokus přepíše předchozí measure stejné
fáze. Před `location.assign` vznikne mark `splatno:login:redirect`.
Na cílové stránce použijte Navigation Timing (`responseStart`,
`domContentLoadedEventEnd`, `loadEventEnd`) pro dobu následující navigace.
Mark sám nemá dobu trvání. Tato diagnostika neposílá telemetrii a neobsahuje
hesla, tokeny ani identifikátory účtů.

Přípravný endpoint zachovává existující `Server-Timing` pro `claims`,
`auth_user`, `membership` a HTTP/DB operace. Odpověď je `private, no-store`.

`node scripts/login-progress-check.mjs` vykresluje skutečný formulář, ale
nahrazuje Supabase a API testovacími odpověďmi. Výstup
`artifacts/login-progress/results.json` zaznamenává počty požadavků, fáze
a čas navigace. Například při tomto ověření byla příprava prostředí u
úspěšného zapamatovaného přihlášení 4,3 ms a navigace 91,9 ms. **Tyto údaje
nejsou rychlost skutečného Supabase ani měření zrychlení proti původní verzi.**

Pro porovnání skutečné latence použijte stejné prostředí, účet, MFA režim
a stav důvěryhodného zařízení před změnou a po ní. Ve vývojovém režimu
zaznamenejte první přihlášení s kompilací odděleně od dalších pokusů.
V produkčním sestavení porovnejte více opakování a medián každé fáze.
Skutečné přihlášení k Supabase ani nasazení touto kontrolou neproběhlo;
procentuální zrychlení tedy není stanoveno.

## Provedené kontroly

- 62 testů v šesti souborech: sloučený endpoint, skutečně podepisované login
  a MFA cookies, platnost podle remember, onboarding, starší volající,
  neplatné vstupy, session a origin, opakování po výpadku, auth flow.
- Dalších 68 testů v osmi souborech (část se překrývá): důvěryhodná zařízení,
  auth bezpečnost, proxy, role, request timing a workspace přístup.
- 18 prohlížečových scénářů na čtyřech velikostech okna: jeden přípravný
  požadavek, remember payload, MFA/onboarding, neplatné heslo, 401/403,
  chyby serveru/sítě, timeout a sériové retry bez opětovného odeslání hesla.
- TypeScript a cílený ESLint bez chyb.
- Izolované produkční sestavení `.cache/invoices-build` dokončeno úspěšně.
  Kompilace trvala 14,2 s; tato hodnota není latence přihlášení.
