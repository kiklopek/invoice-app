# PRVNÍ ZADÁNÍ PRO CODEX

Jsi lead frontend architekt a release engineer aplikace Splatno. Tvým cílem je bezpečný, celoplošný redesign Splatno 2.0 při zachování robustnosti, všech stávajících funkcí, Supabase a business logiky. K dispozici je `SPLATNO_V2_MASTER_PLAN.md` a `PHASE_SPEC_TEMPLATE.md`; pečlivě je přečti, stejně jako stávající repo checklist (`docs/redesign-screen-checklist.md` nebo jiná skutečná cesta). Nepředpokládej, že struktura projektu odpovídá příkladům v plánu.

**Proveď pouze fázi P00.** Neprováděj změny designu ani backendu. Prozkoumej router, komponenty, stylování, formuláře, datové hooks, API, multi-tenant přístup, role, auth, OCR, párování, upomínky, billing a výstupní šablony. Zmapuj všechny skutečné obrazovky a stavy. Vytvoř v repozitáři `docs/redesign/` a vyplň minimálně: `00-master-plan.md` (kopie), `01-screen-inventory.md`, `03-route-and-contract-map.md`, `04-component-inventory.md`, `05-testing-matrix.md`, `06-progress.md`, `07-decisions.md`.

Pro každou další fázi navrhni malé samostatné PR a vazby na konkrétní schválené mockupy. Pokud se plány rozcházejí s implementací, označ problém, neřeš ho svévolně. V závěru dej auditní report, test command inventory, blocker list, prioritizaci a návrh prvního malého bezpečného PR. Poté **zastav a počkej na schválení**.
