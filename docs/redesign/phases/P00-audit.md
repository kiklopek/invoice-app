# P00 — audit aplikace a příprava redesignu

Vyplněno podle přesné kopie [phase template](../prompts/phase-template.md). Tato fáze nevytváří nové UI. Master a template jsou dodané; P00 má otevřenou screenshotovou baseline a uživatelskou revizi, nikoli povolení k P01.

## 1. Identita

- ID: P00.
- Název a routy: audit všech R01–R28 a neobrazovkových handlerů v dokumentu 03.
- Vlastník schválení: uživatel / vlastník produktu; jméno nebylo určeno.
- Závisí na: start promptu, dodaném master plánu a template, skutečném zdrojovém commitu `f0f5fcb`.
- Mockupy: v P00 se neimplementují. Stav deklarací a chybějících konkrétních verzí je v registru M01–M21.
- Screenshot původního UI: historické soubory existují v `artifacts/`; nová P00 baseline je **nepořízena**.
- Desktop/tablet/mobile reference: bezpečné nové capture plánovat na 1440×900, 820×1180 a 390×844, další přesné rozměry a stavy podle domény. To nejsou již pořízené snímky.

## 2. Význam v produktu

- Primární úkol: připravit ověřitelný podklad pro celoplošný redesign bez ztráty funkcí.
- Role auditu: veřejný návštěvník, auth stavy, zakladatel před firmou, admin/accounting/viewer, provozovatel a dočasná podpora.
- Vstupní data: zdrojový kód, routy, migrační/SQL soubory, testy, existující checklist, uživatelem dodané plánovací dokumenty.
- Výstup: inventura, kontrakty, komponenty, testovací matice, audit, rizika a návrhy malých PR P01–P18.
- Co tato fáze není: redesign, refaktor backendu, produkční bezpečnostní certifikace ani nasazení.

## 3. Invarianta funkcionality

| Oblast | Současné fungování | Co zůstává neměnné | Důkaz |
| --- | --- | --- | --- |
| Data query | RSC loadery, SWR, přímé klientské části, filtry | Všechny query a cache implementace | Audit importů, 03 a source-inventory |
| API/mutace | 64 API + 4 další route handlery | Žádný handler změněn ani spuštěna produkční mutace | Git rozsah pouze docs/redesign |
| Validace | Doménové validátory a serverové guardy | Stejné formáty, limity a finance | Unit sada stejného commitu; 03 |
| Oprávnění/tenant | Server relace/MFA, členství, role/RLS/RPC | Žádné auth nebo SQL změny | Tenant PGlite + read-only zdrojový audit |
| Error/retry | apiFetch/request_id, timeout, omezený retry a revision | Stejné rozhodování a UI workflow | apiFetch/route testy, zdrojová inventura |
| Exporty/jobs | Excel/PDF/print/mail, cron, Stripe/Resend | Výstupy zmapovány, nic nově neodesláno | Evidence zdrojů; runtime delivery neověřena |

## 4. Design mapping z mockupu

Žádné JSX/CSS úpravy. Přesný návrh tokenů a komponent patří do P01/P02. Dodaný master stanoví směr, konkrétní návrhy a schválené verze jsou samostatný vstup. Funkční a vizuální akceptace se vedou odděleně. Neexistující vlastnost z mockupu se nepřenáší do produktu bez návrhu kontraktu.

## 5. Stavový model

Empty/loading/success/validation/network-retry/forbidden/long-content/partial/concurrency jsou inventarizovány v 01 jako ST-001–189. Role, API a vedlejší účinky upřesňuje 03. Jejich nalezení v kódu není automaticky vizuální ani runtime ověření. P00 nic z těchto stavů nepřidává ani neodstraňuje.

## 6. Responzivita a a11y

Capture P00: desktop 1440–1600, tablet v rozmezí 768–1024, mobil 375–430 podle masteru; navržené konkrétní rozměry výše. Další audit pokryje 320/375/430/768/1024/1440/1600, zoom 200 %, nízkou výšku, dotyk/klávesnici, screen reader, reduced motion, focus/dialogy a nepřekrývání Eškem. Současné media queries jsou v JSON. Rozpor template u přesně 1200 px je C04; nezměnil se CSS breakpoint.

### Baseline capture manifest — zatím neprovedeno

| Capture ID | Rozsah | Bezpečný datový scénář | Důkaz nyní |
| --- | --- | --- | --- |
| BL01 | R09–R12 landing/legal | CS/EN statická data, FAQ/video | Chybí aktuální sada snímků |
| BL02 | R01–R08 auth | Syntetické účty/pozvánky a mockované bezpečné doručení | Chybí potvrzené izolované fixture prostředí |
| BL03 | R13 onboarding | Osm kroků, validace/draft/ARES/billing návrat | Historické snímky nejsou nová baseline |
| BL04 | R15–R28 workspace | Syntetické firmy: empty/populated/long data, role, OCR/GPC/reminder/billing stavy | Chybí potvrzené izolované fixture prostředí |
| BL05 | R14 operator + společné hranice | Izolovaná support relace, forbidden/loading/error/dialog | Chybí bezpečný fixture stav a capture |
| BL06 | Mail/PDF/print | Jen syntetické firmy/účty/částky; žádné živé odeslání | Zdrojové testy existují; aktuální render capture chybí |

Pro každý pořízený snímek uložit stabilní ID, R/ST, roli/fixture, aplikační SHA, prohlížeč/verzi, viewport, čas, přesnou cestu a stav `old-ui-baseline`, nikoli `approved-design`. Při revizi ověřit, že snímek zachycuje cílový stav, nikoli redirect na login. Nezakládat prázdné PNG nebo fiktivní úspěšné manifesty.

## 7. Krokový plán a stav

1. Read-only audit a git baseline — provedeno.
2. Inventura a akceptační kontrolní scénáře — provedeno, 01/03/05.
3. Kopie masteru/template a porovnání se skutečností — provedeno; C01–C08.
4. Zachytit bezpečnou screenshotovou baseline — otevřeno B06, bez produkčních side effects.
5. Připravit malé PR a vazby na skutečné fáze — provedeno v 06; mockupy evidovány jako nedodané artefakty.
6. Zkontrolovat odkazy, rozsah změn a hashe kopií — ověření dokumentace při předání.
7. Uživatel zreviduje P00 a rozhodne o přijetí — otevřeno B07.
8. Zastavit; neimplementovat P01 automaticky.

## 8. Testovací scénáře

- [x] Všech 28 stránek a 68 handlerů má záznam.
- [x] Rozdíl deklarovaného mockupu a konkrétního dostupného artefaktu je evidován.
- [x] Kód, backend, schéma a RLS nebyly změněny.
- [x] Lokální unit/lint/typecheck/migration a tři DB runnery mají evidenci z předchozího kroku P00.
- [x] Dosud neprovedené testy a runtime zkoušky jsou výslovně odlišeny.
- [ ] Aktuální bezpečné screenshoty desktop/tablet/mobile a odpovídající fixture důkazy.
- [ ] Uživatelská revize auditu a schválení dalšího konkrétního kroku.

## 9. Definition of Done

- [x] Zachované chování: dokumentační změny nezasahují aplikaci.
- [x] Žádný redesign bez schválených konkrétních podkladů.
- [x] Master a template jsou přesné kopie se zdrojem a hashem.
- [x] Inventura a rizika, kontrakty a příkazy jsou doloženy.
- [ ] Screenshotová baseline P00 je doložena.
- [x] Dokumentační změna je samostatně rollbackovatelná.
- [ ] Uživatel schválil P00 a další pokračování.

## 10. Výstup pro kontrolu

Diff pouze `docs/redesign/**`, aplikační baseline beze změn; předchozí `next-env.d.ts` a `.DS_Store` nepřebírat do PR. Test commands/výsledky viz 05 a `evidence/local-checks.txt`. Screenshoty: mezera uvedena výše. Zachované kontrakty viz 02-design-contract a 03. Riziko dokumentace nízké; hlavní auditní omezení je chybějící runtime baseline. Navazující bezpečný krok: doplnit B06 nad potvrzenými syntetickými fixtures, zrevidovat P00 a teprve poté schválit konkrétní malé P01.A/P04.A.
