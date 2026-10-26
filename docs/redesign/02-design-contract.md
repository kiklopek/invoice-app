# Splatno 2.0 — kontrakt designu a zachované funkcionality

Zdroj pravidel: [dodaný master plán](00-master-plan.md), zejména A–D, I a M. Jde o sjednocení dokumentace P00, nikoli implementaci vzhledu nebo schválení konkrétního screenshotu.

## Produkt a vzhled

Produkt sleduje již vydané faktury, pohledávky, přijaté platby a upomínky. `/invoices/new` znamená ruční přidání faktury ke sledování. Návrh nemá bez samostatné specifikace zavést nový proces vystavování daňových dokladů nebo povinné položky faktury. Současný PDF a e-mailový výstup existují a zachovají se; jejich existence sama nedokazuje účetní či právní platnost vystavovacího modulu.

Master plán schvaluje směr: jemné organické světle zelené pozadí, téměř bílé povrchy, střídmá primární zelená, tenké linky, decentní stíny, srozumitelná hierarchie a přiměřeně kompaktní data. Světlý sidebar a profil vlevo dole; žádný druhý profil v topbaru. Eško vpravo dole nesmí překrýt save, export, toast nebo navigaci. Progressive disclosure zachová dostupnost každé existující akce.

Směr není přesná komponentová specifikace: konkrétní tokeny, rozměry, breakpointy a stavové návrhy se musí doložit v P01/P02. Přesné barvy se neodvozují odhadem z JPEG. Žádná nová UI knihovna bez doložené potřeby a schválení. Aktuální CSS kaskáda a moduly jsou zdokumentované v inventuře, ne libovolně zakázané historickým briefem.

## Funkční invarianta

| Oblast | Zachovat | Zdroj a ověření |
| --- | --- | --- |
| Data | Stejné serverové loadery, query semantics, filtry, souhrny, cache invalidace a deep links | Dokument 03, JSON inventura, doménové unit/API testy |
| Identita a firma | Login-session, MFA/OTP, recovery, pozvánky, role admin/accounting/viewer, organization ownership, RLS a server guards | Dokument 03, auth/role testy, izolované tenant SQL testy |
| Finance | Částky, zaokrouhlení, měny, datumové zóny, DPH a partial/split úhrady | Stávající validátory, výpočty a reconciliation testy |
| Mutace | Revize, idempotence, potvrzení, validační/error odpovědi; žádné nové účtování/odesílání při pouhém výběru UI | API/RPC mapa, concurrency/negative scénáře |
| OCR a soubory | Typ/velikost/signatura, ownership a private preview, přesné/nejisté zdroje, queue, provider konfigurace | OCR/upload testy a bezpečná browser baseline |
| Upomínky | Frekvence/scheduler/recipient safety, suppression, doručení; dva view nad společným versionovaným save, logo ukládané zvlášť | Reminders a e-mail testy, pouze bezpečný testovací recipient |
| Billing | Backendové ceny/limity/trial, entitlement gate, webhook podpisy, preview/confirm a externí checkout | Unit/SQL + Stripe sandbox; žádná ostrá platba |
| Výstupy | Excel, PDF, print, HTML/text e-maily, proměnné, QR, logo a fonty | Výstupní testy + vizuální porovnání dle fáze |

Žádné backend/schema/RLS/auth/API/business změny v prezentačním PR. Pokud je návrh potřebuje, zastavit dotčený krok a připravit samostatný návrh. Mockupové hodnoty a tlačítka nejsou oprávnění vytvořit novou funkci.

## Oddělená akceptace

**Funkční akceptace:** všechny skutečné akce, validace, role, error/retry, loading/empty, souběh a výstupy zachovány a ověřeny testy odpovídajícími změně. **Vizuální akceptace:** konkrétní schválený mockup, reference pro desktop/tablet/mobil a doložené screenshoty před/po. Jedno schválení nenahrazuje druhé. P00 zatím nemá novou aktuální screenshotovou baseline.

## Rozdíly plánu a kódu — nerozhodovat změnou chování

| ID | Rozdíl / důkaz | Postup |
| --- | --- | --- |
| C01 | P04/P07 zmiňují negativní částky/vratky; `invoice-validation.ts` odmítá `amount <= 0`. | Záporný vstup testovat jako nepovolený podle baseline. Podporu dobropisů nepřidávat při redesignu; případný business požadavek zvlášť. |
| C02 | P08.D popisuje mapování CSV a partial success. Import stránka mapuje známé názvy hlaviček automaticky; API validuje dávku a vkládá ji atomicky. UI výslovně říká „celý, nebo nic“. | Zachovat all-or-nothing. Nevymýšlet interaktivní mapování ani částečný zápis bez schváleného samostatného kontraktu. OCR multi-queue má jiný stavový model než CSV batch. |
| C03 | P15 gate používá owner/admin/member/view-only. Reálné role jsou `admin`, `accounting`, `viewer`, provozovatel/support zvlášť. | Testovací matrix mapovat na skutečné role, nezavádět owner/member jako nové oprávnění. |
| C04 | Template vymezuje desktop `>1200`, tablet 768–1199; šířka přesně 1200 zůstává neurčená. | Pro testovací plán evidovat desktop ≥1200, tablet 768–1199, mobil 320–767 jako navržené doplnění, nikoli změnu současného CSS. P01/P03 musí hranici výslovně potvrdit. |
| C05 | Master odkazuje na „18 kapitol inventáře“, repo checklist má 16 tematických sekcí plus průřezovou kontrolu. | Zachovat všech 28 rout/189 ST a doplnit mapování na P00–P18. Nevyrábět dvě fiktivní sekce jen kvůli počtu. |
| C06 | P06 zmiňuje bulk actions/confirm dialogy jako rozsah. V seznamu jsou doložené jednotlivé akce; samotný text plánu nepotvrzuje konkrétní implementované hromadné akce. | Před podfází ověřit konkrétní akci a endpoint. Chybějící ovladač nevytvořit automaticky podle mockupu. |
| C07 | Plán deklaruje schválené dashboard/OCR/GPC aj. návrhy, nepřikládá ale jejich soubory/verze. | Zaznamenat deklaraci; konkrétní artefakt zůstává nedodaný. Staré UI screenshoty nepovýšit na nový návrh. |
| C08 | P00 vyžaduje aktuální screenshoty se seedovanými bezpečnými daty. Historické artefakty ani Vitest toto nedokládají. | Založit baseline manifest, označit stav neprovedeno. Nepoužít produkční auth/recovery a data jako zkratku. |

Rozpory C01/C02/C03 se vztahují jen k dotčeným krokům; neblokují další dokumentaci. Žádný nebyl „opraven“ v kódu. Přechod k implementaci nadále vyžaduje P00 review a konkrétní návrh.
