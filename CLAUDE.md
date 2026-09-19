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
