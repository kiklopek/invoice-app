# Příprava faktury pro tisk — 26. 10. 2026

Faktura používá skutečné A4 PDF s vloženým českým fontem, přibližně 15mm bočními okraji, opakováním záhlaví položek a automatickým číslováním. PDF nově obsahuje preferenci tisku ve skutečné velikosti (`PrintScaling.None`). Konečná volba měřítka a papíru závisí na PDF prohlížeči a tiskárně.

Vytvoření faktury → **Zobrazit PDF → Vytisknout fakturu**. Náhled zobrazuje stejné PDF pomocí sdíleného PDF.js vieweru se stránkami a zoomem. Tisk předává stejné byty nativnímu PDF prohlížeči přes samostatný iframe; dostupný je i odkaz pro otevření PDF v nové kartě. Při zamítnutí přímého tisku se zobrazí konkrétní alternativa. Ctrl/Cmd+P z editoru otevře aktuální PDF, místo tisku formuláře; při fokusu uvnitř PDF platí ovládání jeho prohlížeče.

Při běžném tisku HTML stránky se skryje formulář i ovládání. Samostatný pojmenovaný styl A4 na výšku používá 15mm okraje, tiskové velikosti textu, opakování tabulkového záhlaví a ochranu řádků před rozdělením. Sticky náhled je omezen na obrazovku. Hlavní doporučená cesta je tisk PDF.

QR platba má nově bílý okraj o čtyřech modulech a zdrojový rastr 512 px pro PDF. HTML náhled používá stejný bílý okraj; při HTML tisku má QR velikost 28 mm.

Dotčené soubory: `src/lib/issued-invoice-pdf.ts`, `src/lib/invoice-pdf.test.ts`, `src/components/invoice-creation/invoice-creation.tsx`, `invoice-document.tsx`, `invoice-creation.module.css`, `src/components/document-preview.tsx`, `scripts/invoice-print-check.mjs`. Kontext `invoice` ve sdíleném vieweru pouze upravuje popisky, původní OCR funkce zůstávají zachovány.

Provedené ověření:

- 52 testů ve třech souborech: `invoice-pdf`, `invoice-creation`, `czech-payment`. Včetně A4, preference skutečné velikosti, bezpečných okrajů, všech 200 položek, stránkování a finančního obsahu.
- Typecheck a cílený ESLint prošly.
- Produkční build prošel s `APP_BASE_URL=https://www.splatno.com`; bez nasazení.
- Chromium i WebKit při 390 × 844 a 1440 × 844: skutečný pěti­stránkový PDF náhled, dostupnost tisku, bezpečné rozměry dialogu, otevření stejného blob souboru, vyvolání tiskové funkce, simulované zamítnutí tisku a klávesová zkratka.
- Chromium vytvořil také A4 PDF z tiskových HTML stylů. Kontrola textu potvrdila údaje zákazníka a položky, bez záhlaví formuláře či akce Uložit koncept.
- Vygenerovány a vizuálně prohlédnuty skutečné ukázky PDF; QR byl úspěšně načten z vyrenderované standardní faktury a obsahoval správnou částku 60 500,00 CZK.

Artefakty jsou v `docs/redesign/visual-validation/invoice-creation/`, včetně screenshotů tiskového dialogu a souborů `browser-print-390.pdf` a `browser-print-1440.pdf`. Skript tiskového ověření používá syntetická data a ukázku z `scripts/invoice-pagination-check.mjs`; nespouští produkční zápisy ani e-maily.

Automatizace ověřuje náhled, skutečné PDF, rozložení a předání do tiskové funkce. Ovládání systémového tiskového dialogu a fyzický tisk na konkrétní tiskárně ověřeny nebyly. Nebyla provedena migrace ani nasazení.
