# SPLATNO 2.0 — ŠABLONA MIKROPLÁNU PRO CODEX

> Vytvoř kopii pro každou obrazovku, například `P10-B-nejasna-platba.md`. Připoj 1–3 odpovídající mockupy a screenshot původní aplikace. Jednu iteraci drž malou.

## 1. Identita
- ID fáze/podfáze:
- Název a route(s):
- Vlastník schválení:
- Závisí na:
- Status mockupů (approved/draft) a jejich přesné cesty:
- Screenshot současného UI:
- Desktop/tablet/mobile reference:

## 2. Význam v produktu
- Jeden primární úkol uživatele:
- Typické role:
- Vstupní data:
- Výstup a návazná akce:
- Co tato obrazovka **není** (zamezení feature creep):

## 3. Invarianta funkcionality
| Oblast | Současné fungování v kódu | Co zůstane neměnné | Test |
|---|---|---|---|
| Data query | [audit] | [invariant] | [test] |
| API/mutace | [audit] | [invariant] | [test] |
| Validace | [audit] | [invariant] | [test] |
| Oprávnění/tenant | [audit] | [invariant] | [test] |
| Error/retry | [audit] | [invariant] | [test] |
| Exporty/jobs | [audit] | [invariant] | [test] |

## 4. Design mapping z mockupu
- Nová informační hierarchie:
- Co vidí uživatel hned:
- Co je skryto v menu/záložce/draweru (ale zůstává dostupné):
- Použité globální komponenty:
- Úpravy, které zasahují shared UI a dopady:
- Co na mockupu není implementované (falešný feature, zástupné hodnoty):

## 5. Stavový model
- Empty:
- Loading:
- Success:
- Validation error:
- Network error/Retry:
- Forbidden/role restriction:
- Long content/large numbers:
- Partial completion / concurrency (pokud relevantní):

## 6. Responzivita a a11y
- Desktop (> 1200 px):
- Tablet (768–1199):
- Mobil (320–767):
- Touch/keyboard/Screen reader:
- Fokus a dialogy:
- Floating Eško nesmí překrývat:

## 7. Krokový implementační plán
1. Read-only audit trasy a závislostí.
2. Napsat konkrétní akceptační scénáře a testy před úpravou.
3. Upravit / vytvořit shared komponenty bez rozbití zbytku aplikace.
4. Implementovat pouze prezentaci cílové stránky se stávající datovou vrstvou.
5. Napojit všechny původní akce, chyby a loading stavy.
6. Ověřit desktop, tablet, mobil a přístupnost.
7. Spustit regresní testy, pořídit screenshoty před/po.
8. Aktualizovat changelog, screen inventory a blockers.
9. Zastavit a vyčkat na schválení.

## 8. Testovací scénáře (vyplnit konkrétně)
- [ ] Hlavní happy path
- [ ] Validace polí / prázdný stav
- [ ] Chybový stav serveru a retry
- [ ] Oprávnění a tenant izolace
- [ ] Dlouhé názvy / velké částky / více měn
- [ ] Telefon, tablet, desktop
- [ ] Klávesnice, focus, ARIA
- [ ] Žádná regrese v související stránce

## 9. Definition of Done
- [ ] Všechny existující akce zachované
- [ ] Vizuální návrh odpovídá schválenému mockupu
- [ ] Nezměnil se backend/RLS/schema/business rules
- [ ] Testy a screenshoty doložené
- [ ] Změna je rollbackovatelná
- [ ] Uživatel schválil další pokračování

## 10. Výstup pro kontrolu
- Diff a seznam souborů:
- Test commands + výsledky:
- Screenshoty:
- Zachované contracts:
- Otevřené otázky:
- Odhad rizika:
- Doporučená další podfáze:
