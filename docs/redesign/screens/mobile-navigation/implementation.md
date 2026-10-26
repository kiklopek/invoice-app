# Mobilní záhlaví a navigace

Nový vzhled platí výhradně do **767 px**. Od **768 px** zůstává původní tabletové a desktopové rozložení.

## Změněné soubory a komponenty

- `src/components/layout/app-shell.tsx`: `AppSidebar` a `AppShell`; mobilní logo, iniciály, horní profil, sdílené navigační odkazy, drawer a zachované odhlášení. Stejný profilový blok se na telefonu vykreslí před navigací a na původním tabletu za ní.
- `src/components/layout/mobile-header-slot.tsx`: `MobileHeaderProvider`, `MobileNotificationSlot`, `useSmallMobile`. Jeden existující zvonek se pomocí portálu přesune do mobilního záhlaví. Nedochází k dvojímu načítání oznámení.
- `src/components/layout/small-mobile-navigation.css`: pouze mobilní prezentace, 60px záhlaví, 44px ovládací plochy, drawer zprava, safe areas, animace a reduced motion. Otevřené panely jsou nad plovoucím asistentem.
- `src/components/layout/workspace-notifications.tsx`: stejná oznámení, stav a akce; mobilní číselný indikátor, zavírací tlačítko a překryv pozadí.
- `src/components/layout/workspace-topbar.module.css`: vyhledávání na mobilu využije celou šířku; mobilní panel oznámení má omezené rozměry a samostatné rolování. Izolace od starých stylů odkazů sidebaru zabraňuje překrývání dlouhých zpráv.
- `scripts/mobile-header-design-check.mjs`: lokální prohlížečová kontrola rozměrů, overflow, fokusu, zavírání, rolí, odhlášení a oznámení.

## Zachované chování

Navigace nadále používá původní konfiguraci, oprávnění, routy a aktuální počet faktur. Aktivní vnořená stránka zvýrazní příslušnou hlavní sekci. Velký mobilní badge faktur se zobrazí jako `999+`; původní číslo je v atributu title. Odhlášení používá původní potvrzení a handler. Nepřidává se přepínání organizací ani nová účtová funkce.

Oznámení používají původní feed, intervaly načítání, označování jako přečtené a odkazy na konkrétní objekty. Mobilní nepřečtený počet je omezen na `99+`; při nule zmizí. Import, nová faktura a vyhledávání zůstávají ve stránkovém toolbaru. Databáze, API a obchodní logika se nemění.

Drawer zamkne pozadí, převezme fokus, zachytí Tab a Shift+Tab a po zavření vrátí fokus na vyvolávací tlačítko. Zavře jej X, překryv, Escape, výběr odkazu, změna routy i přechod mezi breakpointy. Původní nativní potvrzovací dialog odhlášení má při otevření přednost před klávesovým ovládáním draweru.

## Ověření

- Mobilní šířky: **320, 360, 375, 390, 414, 430, 480, 600, 767 px**.
- Původní tablet/desktop: **768, 800, 1023, 1024, 1280, 1440, 1920 px**. Rozměry sidebaru, navigační lišty a toolbaru se shodují s výchozími hodnotami. Pixelové srovnání samotného záhlaví je shodné. Baseline vznikl před změnou aplikace.
- Mobilní testy zahrnují dlouhé názvy bez mezer, všechny tři role, jeden profil, potvrzení a zrušení odhlášení, skutečné směrování oznámení, čtení, reset indikátoru, fokus a reduced motion.
- 71 cílených unit testů prošlo; TypeScript a ESLint upravených komponent prošly.
- 57 scénářů nástěnky, 23 scénářů detailu faktury a 14 scénářů oznámení prošlo.
- Izolovaný produkční Next.js build úspěšně dokončil kompilaci a generování 86 stránek.

Prohlížečové kontroly používají skutečné React komponenty a CSS se syntetickými lokálními HTTP odpověďmi. Nejsou ověřením produkčního přihlášení nebo produkční databáze. V této změně nebylo nic nasazeno ani aplikováno na vzdálenou databázi.

Snímky a podrobné výsledky: `docs/redesign/visual-validation/mobile-header/`.

## Doplnění mobilní lupy a zarovnání

V mobilním záhlaví mají logo i všechny ovládací prvky společnou svislou osu a 44px plochu. Logo již nepřebírá 52px výšku původní tabletové varianty. Mezi logo a profil přibyla lupa (`MobileHeaderSearch` v `mobile-header-search.tsx` a samostatné CSS module). Otevře nativní dialog přes existující `Modal` a `WorkspaceSearch`, automaticky zaostří vstup a při zavření vrátí fokus na lupu. Na mobilu je hledání dostupné pouze přes lupu v záhlaví; samostatné pole v obsahu bylo na přání uživatele odstraněno. Desktopové vyhledávací pole zůstává dostupné.

`WorkspaceSearch` má dvě volitelné prezentační vlastnosti: vlastní `inputId` zabraňuje duplicitnímu ID a `inlineResults` umístí výsledky do toku dialogu, aby se vešly na malý displej. Výchozí podoba stávajícího vyhledávání i API zůstávají stejné. Prohlížečová kontrola ověřuje shodný svislý střed, všechny mobilní šířky, automatický fokus, Escape, zavření křížkem, výsledky a přechod na konkrétní fakturu.
