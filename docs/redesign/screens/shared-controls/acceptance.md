# Šipky a zavírací ikony — sjednocení

Příčina: textové znaky ⌄ a × používaly textovou baseline, zatímco část komponent
měla vlastní SVG a různé podmínky otáčení. Export reportu ani výběr OCR neměly
navázanou animaci na skutečný stav rozbalení. Některé křížky neměly centrování
uvnitř svého tlačítka.

- Společný `ChevronDown` zachovává vlastní className a přidává `ui-chevron`.
- Nový `CloseIcon` nahrazuje vlastní UI znaky i duplicitní SVG v reportech a
  párování plateb. Všechna tlačítka zachovávají původní callbacky a aria-label.
- `control-icons.css`: blokové SVG, bez vlivu textové baseline, pevná geometrie
  a střed transformace, žádné zachytávání kliknutí dekorativním SVG. Rodičovská
  tlačítka s křížkem mají centrování oběma osami bez paddingu.
- Otáčení šipky dle `details[open] > summary` nebo `button[aria-expanded=true]`,
  180ms oběma směry. Respektuje `prefers-reduced-motion`; nereaguje falešně jen
  na focus. Stávající nastavení velikosti, barvy, ovládání a oprávnění zachováno.
- Opraveny export reportů, výběr OCR dokumentu, změna přiřazení plateb a rozbalení
  kontroly bankovního účtu. Společný Chevron pokrývá i nastavení, upomínky,
  mobilní filtry a FAQ. Exportní šipka zůstává viditelná také na mobilu.
- Společné křížky: potvrzování plateb a detail faktury, zákaznické hledání a
  zrušení editace e-mailu, odebrání pravidla upomínek, oznámení, Esko, video,
  dialog odběratelů a reset filtru, popovery a dropdown párování.
- Nativní indikátory prohlížeče v selectech nejsou předstírané otáčením na focus;
  jejich dosavadní centrování pozadí a nativní ovládání zachováno. Značky násobení
  v textech a částkách nebyly zaměněny za UI ikony.

## Ověření

- TypeScript, cílený ESLint, produkční sestavení Next.js úspěšné.
- 73 relevantních Vitest testů v 7 souborech: Esko, AppShell, toast kontrakt,
  faktura/úhrada, workspace párování, oznámení a tisk reportů.
- `scripts/control-icons-check.mjs`: reálné sdílené komponenty, 1536/390/320px a
  mobil s omezenými animacemi. Měří střed SVG vůči tlačítku (tolerance1.1px),
  skutečnou matici otočení, délku transition, kliknutí myší na souřadnice šipky
  a křížku, otevření/zavření, OCR výběr a toast. Bez externích mutací.
- `scripts/reports-design-check.mjs`: doplněna skutečná šipka Exportovat a
  zavírání dialogu odběratelů na desktopu i mobilu. Prošlo27scénářů.
- `scripts/payment-matching-check.mjs`: všech12scénářů včetně umístění dropdownu,
  vyhledávání, přiřazení/odebrání, detailu, chyb a oprávnění.

Artefakty: `docs/redesign/visual-validation/control-icons/validation.json`,
`reports/validation.json` a `payment-matching/validation.json` a screenshoty.
Nevytvořeny změny DB/API, finanční operace, push ani nasazení.

## Doplnění šipek ve všech výběrových polích

- Společné `styles/select-controls.css` obnovuje indikátor nativních selectů,
  který lokální deklarace `background` mazaly. Chrání jen vzhled šipky a místo
  napravo; barvy, výška a nativní ovládání zůstávají zachovány.
- Šipka je svisle vystředěná; OCR pole ponechává prostor pro stavovou ikonu.
  Kompaktní volby dashboardu používají menší šipku. Viditelné seznamy s více
  řádky ani vícenásobné selecty nedostávají zavádějící rozbalovací indikátor.
  Režim forced-colors používá nativní indikátor prohlížeče.
- Ověřeno 14 variant polí s reálnými CSS moduly na desktopu, 390px, 320px
  a s omezenými animacemi: přítomnost, centrování, prostor pro text a změna
  vybrané hodnoty. Dále prošlo 27 scénářů reportů, 48 testů ve 4 souborech,
  cílený ESLint, TypeScript a produkční sestavení Next.js.
