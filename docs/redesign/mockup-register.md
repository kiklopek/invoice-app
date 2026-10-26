# Registr návrhů a screenshotů

Zdroj deklarací je master plán, část M. **Deklarované schválení směru/návrhu a dodání konkrétní verze jsou rozdílné údaje.** Dashboard byl následně dodán jako konkrétní pack SPL-DASH-001, ostatní uvedené artefakty dosud dodány nebyly. V následujících řádcích „nedodáno“ nepopírá předchozí schválení uvedené v plánu; brání záměně variant při implementaci.

| ID | Návrh / fáze | Deklarace v master plánu | Konkrétní cesta/frame/verze | Stav pro implementaci |
| --- | --- | --- | --- | --- |
| M01 | Dashboard P05 / SPL-DASH-001 | Uživatel výslovně zadal implementaci packu | `screens/dashboard/reference/assets/00-full-dashboard.png` + přesný CODEX spec | Dodáno, implementováno lokálně; čeká na vizuální revizi |
| M02 | Seznam faktur P06.A/B | Máme návrh | Nedodáno | Čeká na přesnou schválenou verzi |
| M03 | Detail faktury P07.B/C | Máme zjednodušený návrh | Nedodáno | Čeká na přesnou schválenou verzi |
| M04 | Přidání ke sledování P07.A | Máme návrh | Nedodáno | Čeká na přesnou schválenou verzi |
| M05 | OCR upload P08.A | Schválený minimalistický upload | Nedodáno | Čeká na artefakt |
| M06 | Single OCR review P08.B | Máme návrh | Nedodáno | Čeká na přesnou schválenou verzi |
| M07 | Multi OCR review P08.C | Máme návrh | Nedodáno | Čeká na přesnou schválenou verzi |
| M08 | GPC/CSV upload P09 | Schválený upload | Nedodáno | Čeká na artefakt |
| M09 | Kontrola/párování P10 | Máme zjednodušený návrh | Nedodáno | Čeká na přesnou schválenou verzi |
| M10 | Přehled upomínek P14.A/B | Máme návrh | Nedodáno | Čeká na přesnou schválenou verzi |
| M11 | Report Tržby P13.A | Máme návrh | Nedodáno | Čeká na přesnou schválenou verzi |
| M12 | Tokens/showcase/shell P01–P03 | Směr popsán v A; bez přesného komponentního návrhu | Nedodáno | Potřebuje komponentní specifikaci/schválení |
| M13 | Archiv faktur P06.C | Potřebuje vlastní schválený návrh | Nedodáno | Návrh čeká |
| M14 | Nejasná platba/split/dokončení P10 | Potřebuje vlastní schválený návrh | Nedodáno | Návrh čeká |
| M15 | Historie plateb a výpisů P11 | Potřebuje vlastní schválený návrh | Nedodáno | Návrh čeká |
| M16 | Zákazníci P12 | Potřebuje vlastní schválený návrh | Nedodáno | Návrh čeká |
| M17 | Report DPH/Pohledávky/Platby P13 | Potřebuje vlastní schválený návrh | Nedodáno | Návrh čeká |
| M18 | Kategorie a e-mailová šablona P14 | Potřebuje vlastní schválený návrh | Nedodáno | Návrh čeká |
| M19 | Firma/tým P15 | Potřebuje vlastní schválený návrh | Nedodáno | Návrh čeká |
| M20 | Billing P16 | Potřebuje vlastní schválený návrh | Nedodáno | Návrh čeká |
| M21 | Landing/auth/onboarding/provoz/system/outputs P17 | Samostatně ověřit potřebu změny a odsouhlasit specifikaci | Nedodáno | Návrh/specifikace čeká |

Ke každému dodanému artefaktu doplnit R/ST, autora/vlastníka schválení, datum, stav approved/draft, desktop/tablet/mobile a další doložené stavy. Pro implementační podfázi založit `screens/<slug>/spec.md` a `acceptance.md` podle dodané šablony; připojit 1–3 konkrétní reference. Soubor nepojmenovat `approved`, pokud není doložená příslušná verze.

## Původní UI a bezpečná baseline

`artifacts/` obsahuje starší screenshoty (např. onboarding, logo editor, reminders, GPC review). Jde o **historické UI reference**, nikoli nové schválené mockupy nebo právě pořízenou P00 baseline. Mohou zachycovat starší stav a reálné údaje; nepřebírají se automaticky do sdílené dokumentace.

Aktuální P00 baseline dosud nepořízena. Bezpečný capture potřebuje oddělené syntetické fixture účty a data a lokální/staging cíl bez reálných mail/job/charge efektů. Běžný Playwright global setup může použít recovery/service klienta, proto se nepouští proti neověřenému cíli. Plán baseline a manifest neprovedených capture jsou v [phases/P00-audit.md](phases/P00-audit.md). Před přijetím P00 doplnit screenshoty a zkontrolovat jejich obsah, ne pouze souborové názvy.

## Doplněná dashboard baseline

SPL-DASH-001 obsahuje tři before snímky a 32 after scénářů pro každý ze dvou enginů. Jsou to syntetické skutečně renderované komponenty, ne produkční tenant ani náhrada globální P00 baseline. Odkazy a meze jsou v `screens/dashboard/acceptance.md`.
