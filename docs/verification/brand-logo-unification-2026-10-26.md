# Sjednocení loga Splatna — 26. 10. 2026

- Jediný aktuální znak: zelená stuha S podle existujícího `RibbonMark`; hlavní vektor je `public/brand/splatno-mark.svg`.
- Webový SVG/PNG fallback, přihlašovací/e-mailový/PDF PNG, profil odesílatele i browser/Apple ikony se generují ze stejného zdroje příkazem `node scripts/generate-favicons.mjs`.
- Žluté, modré a vyřazené dokumentové varianty i nepoužívané veřejné koncepty odstraněny. Firemní loga a maskoti zachováni. Historické auditní důkazy se nemění.
- Znak se nedeformuje do čtverce; malý produktový obrázek používá `object-fit: contain`.
- 97 cílených testů v 9 souborech prošlo: CompanyLogo, branding, odesílání, šablony, pozvánky, přihlašovací kódy, MFA, PDF logo a SEO.
- Cílený ESLint a typecheck prošly. Kontrola assetů ověřila shodu všech tří SVG cest/barvy s inline komponentou, přesnou shodu pixelů e-mailového/PDF PNG s hlavním SVG, čtvercové browser ikony a odstranění vyřazených variant.
- Produkční build s `APP_BASE_URL=https://www.splatno.com` prošel.
- Nasazení aplikace ani nastavení externího profilového obrázku/BIMI se tímto krokem neprovádělo.
