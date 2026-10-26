# Responzivní zobrazení částek

25. 10. 2026 – navazující úprava podle požadavku uživatele.

Společné komponenty ExactMoney a SummaryMoney nyní měří skutečný dostupný prostor. Nejprve zobrazí přesnou částku, při nedostatku místa použijí tis., mil., mld. nebo bil. a podle potřeby sníží počet desetinných míst zkratky. Po rozšíření prostoru obnoví přesnou hodnotu. U výjimečně úzkého sloupce se text přizpůsobí velikostí (nejméně 12 px) a může se zalomit.

Přesná částka včetně haléřů zůstává v popisku a přístupném názvu; zkrácený údaj ji ukáže také po klepnutí, najetí myší nebo klávesnicovém fokusu. Popisek nepřesahuje obrazovku. Tisk společné komponenty zobrazí přesnou hodnotu. Číselné vstupy, nativní možnosti selectů, finanční výpočty a exporty nejsou zaokrouhleny.

Změna se uplatňuje ve stávajících společných finančních readoutech nástěnky, faktur, detailů a archivů, zákazníků, předplatného a párování plateb. Doplněna je i do tabulek reportů, provozního přehledu upomínek, potvrzení úhrady a návrhů plateb. Opravena byla rovněž částka v návrhu párování, která byla omylem součástí doslovného řetězce s JSX.

Ověření:

- 52 cílených testů v pěti souborech; zahrnují pravidla jednotek, přechody po zaokrouhlení, záporné částky, měny a neplatné hodnoty.
- Chromium a WebKit: částky při šířkách 320, 390, 768 a 1536 px; hover, dotyk/kliknutí, fokus, Escape, přesná hodnota v popisku, změna šířky sloupce 260 → 110 → 260 px a návrat k přesnému zápisu.
- Šest skutečných pracovních sekcí při 320, 390, 767, 768, 1023, 1024 a 1440 px bez horizontálního přetečení dokumentu a bez runtime chyb. Vnitřní posouvání tabulek a grafů zůstává možné.
- 16 normálních/zátěžových scénářů karet nástěnky a 17 funkčních kontrol seznamu faktur + 5 rozměrových kontrol; výběr, filtry, řazení i export zachovány.
- Lint, typecheck a produkční build prošly. Bez nasazení a změny veřejných API.

Prohlížečové scénáře používají skutečné komponenty se syntetickými daty, nikoli produkční finanční zápisy. Snímky stránek a měření jsou v `docs/design-audit/2026-10-25/responsive-money`; cílené finanční scénáře v `docs/redesign/visual-validation/money-display`.
