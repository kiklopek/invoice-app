# Post-login error screen — 21. 10. 2026

Chybový obsah navazuje na existující LoginProgress a AuthShell. Má stejnou centrální kartu jako loading. Obsahuje existující logo, kruhový SVG indikátor v systému Icon, upozornění s ikonou a bílé sekundární / zelené primární tlačítko podle dodaného mockupu. Na mobilu jsou tlačítka pod sebou. Po zvětšení textu obsah přirozeně zvětší dokument a zůstává dosažitelný svislým posunem.

## Chování

- Chyby hesla, e-mailu a MFA zůstávají ve stávajících obrazovkách. Dashboard nebyl změněn.
- Bezpečné mapování rozlišuje síť, server, firemní údaje, přístup, vypršení relace, timeout, přerušení a neznámé chyby. Pouze potvrzená síťová chyba používá text o internetovém připojení. Neznámé chyby nezobrazují interní zprávu ani stack.
- Zkusit znovu opakuje pouze neúspěšný krok inicializace. Úspěšná kontrola přístupu nebo uložení volby relace se znovu nevolá. Heslo ani MFA kód se nikdy neopakuje.
- Ref inFlight zablokuje další kliknutí synchronně, před dalším renderem. Po opakovaném selhání se zobrazí nová konkrétní chyba.
- HTTP 401/403 zachovává stávající lokální ukončení neplatného či zamítnutého přihlášení a retry se nenabízí. Síťová nebo serverová chyba sama platnou relaci neukončuje. SDK, autentizační cookies, backend session management, oprávnění, API, databáze a MFA nebyly upraveny.
- Zpět na přihlášení znovu načte současnou login adresu. Platná relace se tím neodhlašuje a případná přihlašovací pravidla zůstávají v existujícím systému.
- Dosavadní 15sekundová pomocná informace a 30sekundový timeout inicializačních fetch zůstávají. Čas neposouvá průběh a nespouští automatické opakování.

## Ověření

Existující `scripts/login-progress-check.mjs` byl rozšířen; nebyla vytvořena druhá testovací infrastruktura. Testy používají skutečné komponenty a styly, syntetický Supabase klient a řízené odpovědi API. Produkční databáze ani skutečné účty nejsou použity.

- Vitest: 71 testů prošlo v 8 souborech (auth-flow, auth-policy, auth-security, login-entry, login-session, safe-return-path, role-authorization a login-issue).
- TypeScript: tsc --noEmit bez chyb.
- ESLint dotčených auth komponent, mapování chyb, testů a browser skriptu bez chyb.
- Browser: výsledky 19 scénářů v [results.json](../../artifacts/login-progress/results.json). Zahrnují úspěšné směrování, MFA returnTo, onboarding, chybné heslo, HTTP chyby, timeout, přerušení, neznámou chybu, bezpečné opakování pouze selhaného kroku, rychlé trojí kliknutí, aktualizaci chyby po retry a kontrolu nezobrazení testovacích citlivých zpráv.
- Screenshoty a overflow kontroly při 1555×1012, 768×1024, 390×844 a 320×568; další screenshot se zvětšeným textem na mobilu. Desktopová karta při přechodu loading → error drží stejné rozměry.

## Screenshoty a porovnání

- [Chybová obrazovka 1555×1012](../../artifacts/login-progress/error-1555.png)
- [Mobil 390 px](../../artifacts/login-progress/error-390.png)
- [Mobil se zvětšeným textem](../../artifacts/login-progress/error-390-large-text.png)

Desktopový screenshot byl porovnán s referencí při shodném viewportu 1555×1012. Zachována je hierarchie, poloha obsahu, červený kruhový indikátor, panel a pořadí/barvy tlačítek. Odchylky: karta zachovává existující login rozměr 1280×760 místo přibližně 1340×812 v referenci; tím zůstává shodná s loadingem. Logo a barvy používají existující značku aplikace, pozadí sdílenou auth variantu; nejde o rasterovou kopii jemných gradientů mockupu. Testovací Vite náhled nahrazuje Next font loader; skutečná Next aplikace dál používá původní Inter z AuthShell.

Živé doručení a zadání MFA kódu, skutečné session cookies a produkční databáze nebyly testovány. Backend neumí samostatně hlásit každou chybu načtení firemních údajů; UI mapuje pouze dostupné chyby existujícího kontraktu a žádný nový signál nevymýšlí.

## Soubory této úpravy

- `src/components/auth/login-progress.tsx`
- `src/components/auth/login-progress.module.css`
- `src/components/auth/login-form.tsx`
- `src/components/auth/login-issue.ts`
- `src/components/auth/login-issue.test.ts`
- `src/components/icons.tsx` — pouze přidaná varianta alert-circle; ostatní rozpracované změny zachovány.
- `scripts/login-progress-check.mjs`
- `docs/verification/post-login-loading.md`
- `docs/verification/post-login-error.md`
- `artifacts/login-progress/` — screenshoty a výsledky.
