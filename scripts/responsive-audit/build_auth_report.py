"""Build the auth-specific report and synthetic screenshot gallery."""
from pathlib import Path
import json, html

root=Path.cwd()
out=root/'artifacts/responsive-audit/2026-11-02/auth-onboarding'
rows=[]
for path in sorted(out.glob('results-*.json')):
    rows.extend(json.loads(path.read_text()))
ok=[r for r in rows if r['status']=='observed']
failed=[r for r in rows if r['status']!='observed']
summary={'cases':len(rows),'observed':len(ok),'failed':len(failed),'documentOverflows':sum(r.get('metrics',{}).get('documentOverflow',False) for r in rows),'engines':sorted({r['engine'] for r in rows}),'onboardingSteps':list(range(1,9)),'syntheticOnly':True,'approvedProductionBaseline':False}
(out/'summary.json').write_text(json.dumps(summary,indent=2)+'\n')
report='''# Login, registrace, onboarding a související vstupy

**Navazující změna:** tento dokument zachycuje původní audit. Později uživatel schválil [lokální implementaci vstupních stránek a onboardingu](../verification/auth-entry-responsive.md); její výsledky a změny jsou vedeny odděleně.

Samostatná část responzivního auditu. Vzhled a aplikační autentizace nebyly měněny. Všechny nové scénáře používají skutečné komponenty izolovaného produkčního commitu `26defdcc90f9ebaf979d40d23a6c5c7648dd0e0f` a syntetická data.

## Rozsah a důkazy

Základní audit už obsahoval login, registraci, obnovu hesla a první krok onboardingu v šířkové matici 320–3840 px. Toto doplnění přidává jednotlivé pracovní stavy a pozvánky, nikoliv pouze další snímek výchozího formuláře.

'''
report+=f"Doplňující běh: **{len(ok)} z {len(rows)} případů pozorováno**, {len(failed)} neúspěšných kontrol, {summary['documentOverflows']} horizontálních přesahů dokumentu. Prohlížeče: {', '.join(summary['engines'])}.\n\n"
report+='''- [Galerie auth a onboardingu](../../artifacts/responsive-audit/2026-11-02/auth-onboarding/index.html)
- [Chromium: podrobné výsledky a geometrie](../../artifacts/responsive-audit/2026-11-02/auth-onboarding/results-chromium.json)
- [WebKit: podrobné výsledky a geometrie](../../artifacts/responsive-audit/2026-11-02/auth-onboarding/results-webkit.json)
- [Živá veřejná produkce: login a registrace při diagnostických 1440×900](../../artifacts/responsive-audit/2026-11-02/production-live/observations.json)

## Kontrakty jednotlivých stránek

`W` označuje dostupnou CSS šířku. Uvedené přechody jsou současná pravidla nebo explicitně označený budoucí návrh. Nejde o nově implementované breakpointy. Referenční screenshoty jsou kandidátní: skutečné běžné okno MacBooku není uzamčené.

| Stránka / část | Reference a minimální prostor | Režimy a spouštěč | Dlouhý obsah a výška | Interakce a akceptace |
| --- | --- | --- | --- | --- |
| Login | Živý veřejný snímek a source kandidáti; kontrola od W=320 | Současná změna shellu na 900 px; kompozice není svázaná se sidebarovým workspace | E-mail zůstává v editovatelném poli; karta se centruje, pokud se vejde; při nedostatku výšky musí být dostupný celý obsah | Zobrazení hesla, chybné přihlášení, zachovaná adresa a reset odkaz; skutečné přihlášení není testováno |
| Registrace — formulář | Samostatný `registration` layout; od W=320 | Dva sloupce polí podle současné šířky; na 480 px jeden sloupec; samostatný kompaktní režim při H≤800 | Formulářový obsah má vlastní vertikální scroll, branding zůstává samostatný; souhlas a hlavní akce musí být dosažitelné | Validní syntetické vyplnění přejde na kód; neztratit hodnoty při návratu; nevytvářet účet v produkci |
| Registrace — kód | Stejná karta a šířkové pravidlo jako formulář | OTP respektuje počet polí určený komponentou; žádná změna auth kontraktu | Dlouhý potvrzovaný e-mail se zalomí; chyba nesmí zakrýt odeslání ani návrat ke změně údajů | Vyplnění celého kódu, viditelná chyba, stav opětovného odeslání; kontrolováno 390/1024 px |
| MFA | Současný AuthShell a OTP komponenta; od W=320 v základním auditu | Vlastní loading/send/verify/resend režimy, bez změny navigace | Dlouhý e-mail a chyba rostou přirozeně; všechna pole i ukončení přihlášení dostupná | Syntetické odeslání a chybný kód při 390/1024; reálné doručení, session expiry a cooldown vyžadují staging ověření |
| Zapomenuté heslo | AuthShell; od W=320 | Formulář a potvrzení jsou dva stavy stejné kompozice | Dlouhý e-mail v potvrzení se zalomí; zpětný odkaz zůstane dostupný | Syntetické odeslání přepne formulář na potvrzení; není to skutečně odeslaný e-mail |
| Nové heslo | AuthShell; od W=320 | Checking / formulář / chyba podle stávajícího klienta | Obě pole, pravidla hesla a validační text přirozeně rostou | Kontrolovaná chyba změny hesla; nezměněna skutečná session ani heslo; expirace odkazu ověřit mimo produkční data |
| Firemní vstup | Skutečný `brand=hlavica` na stejných komponentách; v testu využity aliasy login/register | Stejné responsivní pravidlo, ale jiný řádek log a vstupní texty | Dvě značky a zpětný odkaz se nesmí překrýt; nepřenášet firemní logo na obecný vstup | Vykresleno 390/1024; serverové přesměrování skutečné tenant URL není tímto testem ověřené |
| Pozvánka — nový účet | Skutečný InvitationClient; testovací alias `/pozvanka/audit`, nikoliv produktová route | Nový/existující účet podle skutečných stavů komponenty | Dlouhá firma, e-mail a platnost pozvánky se zalamují; celý formulář dosažitelný | Doplňující běh ověřil nový účet jako UI; přepínání režimů a skutečné přijetí zůstávají funkčním staging scénářem |
| Pozvánka — prošlá / jiný účet | Stejný komponent a shell | Stav určuje pozvánka/signedInAs, nikoliv šířka | Chybová zpráva ani cizí účet nesmějí vytlačit návrat/odhlášení | Prošlá pozvánka a dosažitelné odhlášení jiného účtu při 390/1024; odhlášení se v testu neprovádí |

## Onboarding: všech osm kroků

Každý krok má kandidátní snímek a geometrii při **320×600, 768×800, 1440×800 a 2560×800**, v Chromium a WebKit. Kroky 1–7 jsou otevřeny existujícím `initialDraft` kontraktem; krok 8 existujícím `payment` kontextem. Test nevytváří firmu ani fakturaci, neodesílá pozvánky a nepřechází na Stripe.

| Krok | Prvky a obsah | Pravidlo uspořádání / zachování výšky | Akceptace pro následné změny |
| --- | --- | --- | --- |
| 1. Firma | IČO, název, adresa, DIČ / plátce | Dlouhý název a adresa v přirozené šířce polí; rail a obsah samostatně | Pole/validace dostupné při 320px a nízké výšce; ARES loading/not-found/error doplnit jako samostatné interakce |
| 2. Kontakt | E-mail, telefon, datová schránka, provozovna | Udržet existující skupiny polí a jejich lokální rozpad | Přechod 2→3→2 i změna šířky zachovají upravený e-mail; přímo ověřeno 390/1024 v obou enginech |
| 3. Banka | CZK a EUR účet | Dlouhé číslo účtu neovlivňuje šířku celé stránky | Kontrola dostupnosti formulářové akce; neplatná kontrolní číslice a IBAN patří do další funkční akceptace |
| 4. Upomínky | Volba dnů, odpovědní adresa a kopie | Volby se zalamují jako skupina; dlouhé adresy nemění šířku panelu | Všechny volby a CTA dostupné; nezapínat automatizaci změnou layoutu |
| 5. Logo | Upload a nápověda / přeskočení | Dropzone zůstává uvnitř vlastního panelu | Dosažitelnost přeskočení přímo ověřena; chybný typ/velikost a preview loga jsou další samostatné scénáře |
| 6. Tým | Pozvánka, role, seznam kolegů | Dlouhý e-mail nesmí schovat roli nebo odebrání; seznam přirozeně roste | Vykreslen dlouhý kontakt; přidání/odebrání a chyba uložení patří do funkčního staging testu |
| 7. Shrnutí | Souhrn zadaných údajů a založení | Výška roste podle souhrnu ve scrollovatelném panelu | Ověřit celý souhrn a finální akci bez odeslání produkčních dat; založení firmy nebylo spuštěno |
| 8. Tarif a karta | Období, tarify, cena, karta | Tarify mají vlastní pravidlo šířky a zalomení; neškálovat celou stránku podle monitoru | Výběr/CTA musí být dosažitelné; potvrzení, zamítnutí trialu a Stripe návrat nejsou tímto statickým stavem ověřeny |

## Kompozice, centrování a mírný růst

- Login/default AuthShell: současná karta má maximum **1280 px** a dvě části. Tento horní limit se nepřevádí na násobek šířky monitoru. Na 900 px se přepíná mobilní kompozice; současný vzhled má přednost před novou univerzální představou „form-only“.
- Registrace: vlastní `registration` layout s kartou nejvýše **1280×960 px**. V omezené výšce se posouvá tělo formuláře, nikoliv libovolně zvětšená celá stránka. Při textovém zvětšení musí zůstat přístupné souhlasy, validační zprávy i tlačítka.
- Onboarding: karta nejvýše **1440×1000 px**, pracovní obsah nejvýše **560 px**. Současné přechody 1180 a 760 px koordinují rail, pracovní panel a ilustraci; tarifní skupina má další vlastní pravidla. Desktopový workspace sidebar se na tuto rodinu nepoužívá.
- Vysoké okno: centrovat kartu, pokud její přirozená/minimální výška dovolí bezpečný prostor nad i pod. Nízké okno: použít současný definovaný scroll a dostupný footer. Nevynucovat svislé centrování vysokého formuláře pomocí transformace nebo záporné polohy.
- Expanded návrh: zachovat maxima a přidat prostor vně karty; nepoužít plošný `zoom`. Návrh neodstraňuje ani neimplementuje současné lokální úpravy AuthShellu.

### Naměřené příklady (produkční zdroj, Chromium, kandidáti)

| Prostředí | Karta / obsah | Text / ovládání |
| --- | --- | --- |
| Login 1024×800 | Karta 976 px | Nadpis 36.864 px; pole 52 px, CTA 56 px, text pole/CTA 16 px |
| Registrace 1024×800, kód | Karta 992 px, tělo má vlastní svislý scroll | Nadpis 32 px; CTA 50 px |
| Onboarding 320×600 | Karta 320 px | Nadpis 25 px; pole 46 px, formulářové CTA 50 px |
| Onboarding 1440×800 | Karta 1408 px | Nadpis 37.44 px; pole 52 px, CTA 56 px |
| Onboarding 2560×800 | Karta 1440 px | Nadpis 38 px; pole 52 px, CTA 56 px |

Hodnoty se nemají před schválením desktopu zaokrouhlovat ani vydávat za nový tokenový kontrakt. Rozdíl mezi 1440 a 2560 už dokládá omezený růst, nikoliv potřebu exponenciálního zmenšování celé kompozice.

## Meze důkazu a další akceptace

Auth/font adaptér nenahrazuje skutečné Next/font prostředí. Izolované screenshoty dokládají stavy a geometrii, nikoliv schválenou pixelovou shodu s živou produkcí. Měřené běhy nepředstavují průchod skutečným přihlášením, doručováním kódu, obnovou hesla, vytvořením organizace nebo platbou. Všechny API odpovědi jsou řízené v browserovém testu a externí požadavky blokované.

Nativní softwarová klávesnice, autofill správce hesel, safe-area na fyzickém Safari, browser zoom a zachování focusu při klávesnici vyžadují fyzické ověření. Zvlášť doplnit autentizované stavy skutečného serverového Next prostředí, loading/retry po ověření hesla, chyby ARES/uploadu a platební recovery. Nejsou označeny jako již úspěšně otestované.

Spuštění: `node scripts/responsive-audit/auth-onboarding.mjs` a následně `node scripts/responsive-audit/auth-onboarding.mjs --engine=webkit`. Opakovaný běh používá `--resume`; `--only=onboarding-step-8` omezí výběr. Ne-resume běh přepisuje výsledkový soubor daného enginu. Report a galerie: `python3 scripts/responsive-audit/build_auth_report.py`.
'''
(root/'docs/responsive-audit/AUTH_ONBOARDING.md').write_text(report)
items=[{'id':r['id'],'engine':r['engine'],'width':r['width'],'screenshot':r['screenshot']} for r in ok]
page='''<!doctype html><html lang="cs"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Auth a onboarding — audit</title><style>body{margin:0;padding:24px;background:#f4f7f4;color:#13231b;font:16px system-ui}header{max-width:1100px;margin:auto}select{font:inherit;padding:10px;border:1px solid #aabeb0;border-radius:8px}#shots{display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,560px),1fr));gap:20px;margin-top:24px}figure{margin:0;background:white;padding:12px;border-radius:12px}img{width:100%;height:auto;border:1px solid #dde5df}figcaption{padding-bottom:8px}a{color:#17613f}</style><header><h1>Login, registrace, onboarding a pozvánky</h1><p>Skutečné komponenty produkčního zdroje se syntetickými daty. Kandidátní snímky; nikoliv schválená produkční reference.</p><label>Stav <select id="case"></select></label></header><div id="shots"></div><script>const items=__ITEMS__;const select=document.getElementById('case');for(const id of [...new Set(items.map(i=>i.id))]){const o=document.createElement('option');o.value=id;o.textContent=id;select.append(o)}function render(){const grid=document.getElementById('shots');grid.replaceChildren();for(const r of items.filter(i=>i.id===select.value)){const f=document.createElement('figure'),c=document.createElement('figcaption'),a=document.createElement('a'),im=document.createElement('img');c.textContent=r.engine+' · '+r.width+' CSS px';a.href=r.screenshot;im.src=r.screenshot;im.alt=c.textContent;im.loading='lazy';a.append(im);f.append(c,a);grid.append(f)}}select.onchange=render;render();</script></html>'''.replace('__ITEMS__',json.dumps(items))
(out/'index.html').write_text(page)
print(json.dumps(summary))
