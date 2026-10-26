# Přihlášení: načítací a chybová obrazovka

Implementace podle zadání z 21. 10. 2026. Backend, Supabase Auth, MFA, cookies, oprávnění, onboarding a pravidla přesměrování zůstávají ve stávajícím systému.

## Skutečný průběh

1. **Ověření přihlašovacích údajů:** existující `signInWithPassword`. Chybná hesla a přihlašovací validace zůstávají ve formuláři.
2. **Načítání vašeho prostředí:** existující souběžné POST požadavky `/api/auth/access` (uživatel, firma, přístup, rozhodnutí o MFA/onboardingu) a `/api/auth/session-preference` (volba zapamatování). Nezavádí se samostatné načítání dat firmy.
3. **Příprava aplikace:** předání řízení existujícímu `window.location.assign`. Cíl stále určuje `needsOnboarding`, `safeReturnPath`, `mfaBypassed` a `withEntry`.

Žádný časovač neposouvá kroky. Nejsou zde fiktivní časy, procenta ani minimální doba zobrazení. Běžná navigace a dashboardové skeletony zůstávají beze změny.

Po 15 sekundách v jedné fázi se zobrazí informace o dlouhém čekání a návrat na přihlášení. Ověření Supabase se nepřerušuje ani souběžně neopakuje. Dva navazující frontendové požadavky mají 30sekundový AbortSignal timeout. Obě operace se ukončí před povolením opakování. HTTP 401/403 zachovává lokální odhlášení při neplatné relaci či zamítnutí přístupu; v těchto stavech se retry nenabízí. Při serverové nebo síťové chybě se opakuje pouze neúspěšná inicializační operace s tokenem v paměti komponenty. Úspěšné výsledky se uchovají, heslo ani MFA kód se znovu neodesílá. Neprobíhá automatické opakování.

Chybová obrazovka rozlišuje síť, timeout, server, neplatnou relaci, oprávnění a chybu načtení prostředí. U vypršelé relace a chybějících oprávnění nabízí návrat do formuláře. Návrat znovu načte stávající přihlašovací adresu.

## Vzhled

Varianta `progress` sdílí původní AuthShell, jeho šířku 1280 px, desktopovou minimální výšku a responzivní breakpointy. Obsah je vycentrovaný, používá existující RibbonMark a nemá maskota. Na nízkém mobilu může obsah zvětšit výšku dokumentu, aby se nic neořezávalo. Reduced motion vypíná rotaci spinneru.

Reference má trochu jiné rozměry karty; přednost má výslovný požadavek zachovat existující login kontejner. Chybová varianta byla následně upravena podle dodaného samostatného error mockupu; podrobnosti jsou v post-login-error.md.

## Ověření

- TypeScript: `node node_modules/typescript/bin/tsc --noEmit` — bez chyb.
- ESLint: tři dotčené TSX soubory a ověřovací skript — bez chyb.
- Vitest: auth-flow, auth-policy, auth-security, login-entry, login-session, safe-return-path, role-authorization — **71 testů prošlo** (včetně nového login-issue.test.ts).
- Playwright: `node scripts/login-progress-check.mjs` — **19 scénářů prošlo**. Výsledky: [results.json](../../artifacts/login-progress/results.json).
- Scénáře: desktop/tablet/mobily 1555/768/390/320 px, absence maskota a vodorovného scrollu, rozměry sdílené karty, reduced motion, síťové chyby a opakování, MFA s returnTo, onboarding, chybná hesla, HTTP 401/403/422/500, uložení relace, pomalá autentizace bez simulace kroků, timeout.
- Prohlížeč používá skutečný LoginForm a skutečné styly s nahrazeným Supabase klientem a řízenými API odpověďmi. Timeout test používá skutečný AbortSignal s čekajícím testovacím fetch. Neověřuje živé Supabase účty, vydání skutečných cookies ani doručení a zadání MFA kódu. MFA obrazovka a backend nebyly změněny.

Screenshoty byly vizuálně zkontrolovány:

- [Načítání desktop](../../artifacts/login-progress/loading-1555.png)
- [Chyba desktop](../../artifacts/login-progress/error-1555.png)
- [Načítání mobil](../../artifacts/login-progress/loading-390.png)
- [Chyba mobil](../../artifacts/login-progress/error-390.png)

## Změněné soubory této implementace

- `src/components/auth/auth-shell.tsx` — sdílená varianta progress.
- `src/components/auth/auth-shell.module.css` — karta a pozadí progress.
- `src/components/auth/login-form.tsx` — napojení na operace, chyby, timeout a bezpečné opakování.
- `src/components/auth/login-progress.tsx` — načítací a chybový obsah.
- `src/components/auth/login-progress.module.css` — spinner, kroky, responzivita a reduced motion.
- `scripts/login-progress-check.mjs` — prohlížečové scénáře a screenshoty.
- `docs/verification/post-login-loading.md` — tento záznam.
- `artifacts/login-progress/` — screenshoty a výsledky.

Ostatní rozpracované změny v pracovním stromu nebyly součástí této úpravy.
