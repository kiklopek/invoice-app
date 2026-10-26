# Příprava sloučení design-rebuild do main — 26. 10. 2026

Uživatel výslovně požádal o sloučení všech aplikačních změn větve do main a jejich nasazení na běžnou ostrou verzi. Vzdálený main byl před sloučením načten pomocí git fetch; odpovídal výchozímu commitu f0f5fcb. Ověřený Vercel projekt invoice-app (`prj_JfDfhBKx5lyiluLO5c4wVUnTTAJz`, tým `team_WrYh8HxKpWtmy4tMh9Y36iXy`) nasazuje main na https://www.splatno.com.

Součástí vydání je aplikační kód, statické prostředky, migrace, regresní testy, návrhové specifikace a auditní protokoly. Generované pracovní screenshoty v artifacts a docs/redesign/visual-validation a snímky původního designového auditu zůstávají zachované lokálně a jsou ignorované Gitem. Zdrojové kontrolní skripty a textové výsledky jsou zahrnuté. Před stagingem proběhla kontrola textových souborů a auditních logů na přítomnost skutečných lokálních tajných klíčů; nic nebylo nalezeno.

## Bezpečnostní aktualizace nutné pro CI

Před vydáním kontrola audit:ci odhalila kritické a vysoké nálezy v dosavadních závislostech. Aktualizace:

- Next.js 16.3.8 → 16.4.1 a eslint-config-next 16.3.0 → 16.4.1. Viz [opravené Image Optimization RCE](https://github.com/advisories/GHSA-2464-fhr4-w9xw), [use-cache RCE](https://github.com/advisories/GHSA-673q-mjm6-r5xr).
- Vitest 4.1.11 → 4.1.12 a výslovně připnuté Vite 8.2.4 pro jeho peer dependency.
- Připnuté opravené transitive zod 4.6.6, undici 8.12.2 a brace-expansion řady 2 na 2.1.7.
- Aktualizovaný pnpm-lock.yaml; existující bezpečnostní záplata braces zůstala zachovaná a jejích 8 testů prošlo.

## Ověření výsledné kombinace závislostí

- [Testy](tests.log): 249 souborů / 2 181 testů prošlo.
- [Lint](lint.log), [typecheck](typecheck.log) a [produkční build](build.log) prošly.
- [audit:ci](dependency-audit.log) prošel bez kritických a vysokých nálezů; zůstává jeden stávající moderate nález v uuid používaném přes ExcelJS.
- Všechny čtyři doobjednané produkční migrace byly před tímto vydáním nasazeny a ověřeny. [Protokol](../core-audit-fixes-2026-10-26/README.md).

Toto vydání neřeší samostatné otevřené nálezy F1/F6/F7 z [původního auditu](../core-audit-2026-10-26/README.md); uživatel byl o nich informován před výslovným požadavkem na vydání.
