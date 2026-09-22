@AGENTS.md

# Bankovní výpisy: čti specifikaci, nehádej z obsahu souboru

Před jakoukoli prací na parsování bankovních výpisů, párování plateb nebo číslech
účtů si **vždy** načti [docs/bank-formats/kb-gpc-km.md](docs/bank-formats/kb-gpc-km.md)
a v případě pochybností původní specifikaci
[docs/bank-formats/kb-klientsky-format-km.pdf](docs/bank-formats/kb-klientsky-format-km.pdf)
od Komerční banky.

Důvod je konkrétní: formát obsahuje dvě věci, které z obsahu souboru nelze
odvodit a obě se už jednou tiše rozbily.

- **Čísla účtů jsou permutovaná** (tzv. vnitřní formát). Čtená tak, jak leží, to
  nejsou čísla účtů, ale jejich přesmyčky. Dlouho se takhle ukládala, kvůli čemuž
  každý import hlásil neshodu účtu a blokoval automatické zaúčtování.
- **Kód banky protiúčtu leží uvnitř pole konstantního symbolu** (pozice 74–77),
  ne ve vlastním poli.

Každé dekódované číslo účtu musí projít českou váženou mod-11 kontrolní číslicí.
Když neprojde, čte se formát špatně — je to nejrychlejší způsob, jak tu třídu
chyb odhalit.

# Chráněné cesty: tichá chyba tady stojí peníze nebo data

Na těchhle místech se pracuje opatrně bez ohledu na to, jak jednoduše úkol
vypadá. Když se práce rozděluje mezi agenty, patří sem vždy ten nejsilnější
(`risk`); eskalovat nahoru je vždy v pořádku, degradovat dolů nikdy.

```
supabase/migrations/**
src/lib/gpc-parser.ts, statement-assignment.ts, payment-*.ts
src/app/api/cron/**
src/proxy.ts, src/lib/auth*.ts, role-access.ts
src/lib/invoice-pdf.ts, invoice-ocr*.ts
```

Co z toho plyne konkrétně:

- **Nikdy needituj historickou migraci.** Přidej novou s
  `create or replace function` pro stejnou signaturu — zachová GRANT/REVOKE.
  Než tak učiníš, dohledej, **která migrace drží aktuální tělo funkce**;
  funkce tu bývají předefinované a přejmenované napříč historií
  (`reconcile_bank_statement` má v grafu čtyři různé definice).
- **Po `apply_migration` přes Supabase MCP přejmenuj lokální soubor podle
  skutečně zapsané verze.** Nástroj si časové razítko generuje sám podle
  okamžiku spuštění, ne podle jména, které zvolíš v `supabase/migrations/`.
  Rozejde-li se to, GitHubí check „Supabase Preview“ selže hlášením „Remote
  migration versions not found in local migrations directory“ — přesně tenhle
  incident nastal 22. 9. u pěti migrací. Oprav to hned (`mcp__claude_ai_Supabase__list_migrations`
  a přejmenovat), ne až to někdo nahlásí.
- **Bezpečnostní síť se píše PŘED změnou.** Test, který dnes selže a po změně
  projde. Bez něj neexistuje důkaz, že se změna povedla.
- **Automatika nesmí tiše přepsat peněžní ani identitní údaj.** Při rozporu
  dvou zdrojů patří viditelné varování, ne tiché rozhodnutí.
- **Akce, která odesílá e-mail třetí straně nebo mění peněžní stav, vyžaduje
  potvrzení** s uvedením rozsahu dopadu („Odeslat 14 upomínek 9 zákazníkům?“).

Globální PreToolUse hook (`~/.claude/scripts/guard-protected-paths.mjs`) na
tyhle cesty upozorní sám, ale neblokuje — zodpovědnost zůstává na tom, kdo píše.
