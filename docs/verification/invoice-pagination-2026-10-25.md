# Vícestránkové faktury

Úprava navazuje na existující položkový PDF renderer; finanční výpočty se nemění.

- Před prvním záhlavím tabulky se rezervuje místo pro celý první řádek, včetně dlouhého popisu.
- Položky se rozdělují pouze mezi řádky. Pokračování opakuje číslo faktury a záhlaví tabulky.
- Souhrn DPH, celková částka a platební údaje s QR tvoří jeden předem změřený blok.
- Číslování stran je zarovnáno podle skutečné šířky textu.
- HTML tisk má opakování záhlaví a ochranu řádků i souhrnu před rozdělením.
- Živý HTML náhled zůstává průběžný a posuvný; přesné rozdělení A4 je ve vygenerovaném PDF přes existující akci Zobrazit PDF.

Ověření:

- `vitest run src/lib/invoice-pdf.test.ts src/lib/invoice-creation.test.ts`: 32 testů prošlo, včetně nové kontroly všech 200 různých položek právě jednou, opakovaných hlaviček, okrajů, číslování a společného závěrečného bloku.
- Typecheck a cílený ESLint prošly.
- Lokální Chromium: živý náhled obsahuje všech 200 položek a poslední je dostupná bez vodorovného přetečení při šířce 390 i 1440 px.
- `node scripts/invoice-pagination-check.mjs`: skutečná PDF se syntetickými položkami a záměrně dlouhými popisy: 30 položek / 5 stran; 200 položek / 30 stran. Počet stran závisí na délce textu, nikoli na pevném počtu produktů.
- Prohlédnuty kontaktní listy menší faktury a začátku i konce velké faktury. Kompletní PDF, jednotlivé stránky a kontaktní listy jsou v `docs/redesign/visual-validation/invoice-pagination/`.

Bez nasazení, změny produkčních faktur nebo odeslání e-mailu. Stávající limit formuláře je nejvýše 200 položek.
