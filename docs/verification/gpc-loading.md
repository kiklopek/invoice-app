# Načítání bankovního výpisu

Při odesílání GPC (a dalších podporovaných výpisů) se místo původní změny
textu v dropzoně zobrazuje společný `ImportProcessingView`, který nyní
používá i OCR import. Obsahuje zelený neurčitý průběh, kroky a informaci
o následné kontrole. Ilustrace, dlouhý název souboru a procenta se nezobrazují.

- Výběr souboru je dokončený krok. Načítání a párování je jedna probíhající
  fáze, protože jediný POST zahrnuje upload, validaci i sestavení návrhů.
- Údaj „Výpis 1 z 2“ vyjadřuje skutečnou pozici ve stávající frontě.
- Panel je viditelný jen během uploadu, nikoli při potvrzování či úpravách
  již otevřeného náhledu. Po odpovědi se otevře náhled; chyba obnoví výběr
  souboru s původní chybovou zprávou.
- Párování, automatické zaúčtování, oprávnění, API a potvrzování se nemění.
- Vzhled a reduced-motion pravidla sdílejí GPC a OCR přes
  `src/components/import-processing.module.css`.

Ověření: 18 testů pro GPC, OCR a platební flow; TypeScript a cílený ESLint.
`scripts/gpc-loading-check.mjs` ověřil skutečný PaymentsClient se zadrženou
testovací API odpovědí při šířkách 320, 390, 768 a 1440 px, včetně načítání,
přechodu do kontroly, reduced motion a absence vodorovného přetečení.
Výsledky a screenshoty jsou v `artifacts/gpc-loading/`.
Regrese OCR proběhla přes `scripts/ocr-review-design-check.mjs --processing`.
Prohlížečové kontroly používají API fixtures; skutečné bankovní výpisy ani
finanční zápisy nebyly při ověřování odesílány.
