# Struktura aplikace

```
src/
  app/
    (auth)/          přihlášení, registrace, MFA a obnova hesla
    (workspace)/     přehled, faktury, archiv, platby, reporty a nastavení
      layout.tsx     společné rozložení se zachovaným menu
      loading.tsx    načítání pouze obsahu pracovní plochy
      error.tsx      chyba obsahu se zachovaným menu
    api/             serverové HTTP endpointy členěné podle agendy
    auth/            serverové callbacky autentizace
    layout.tsx       kořen dokumentu, metadata a globální styly
  components/
    layout/
      app-shell.tsx  AppShell, AppSidebar a AppFrame
    ...              sdílené formuláře, ikony a další UI
  lib/               aplikační logika, validace a integrace
    *.test.ts        testy vedle odpovídající logiky
  types/             databázové a aplikační typy
e2e/                 prohlížečové testy
supabase/migrations/  verzované databázové změny
scripts/             build a provozní kontroly
docs/                architektura a provoz
```

Skupiny `(auth)` a `(workspace)` neovlivňují veřejné URL. Soubor `app/auth/` obsahuje serverové callbacky, nikoli přihlašovací obrazovky. Serverové tajné údaje patří pouze do serverových modulů a konfigurace prostředí.

Stránky skládají UI a volají API; sdílená pravidla patří do `lib`, nikoli do kopií na jednotlivých stránkách. Nové komponenty společného rozložení patří do `components/layout`. Testy logiky zůstávají vedle implementace, aby jejich dohledání nevyžadovalo procházení druhé paralelní struktury.

Změna struktury při auditu přesunula pouze soubory a aktualizovala importy a odkazy testů. Neobsahuje opravy nálezů, změny databáze ani změny veřejných API. Rozdělení větších existujících stránek a `lib` do dalších doménových modulů je samostatný refaktor, nikoli součást tohoto auditu.
