# UI a UX audit Splatna pro účetní a OSVČ

Datum: 13. 10. 2026.

## Rozsah a způsob hodnocení

Audit aktuálního zdrojového kódu hlavních uživatelských obrazovek: přihlášení,
registrace a pozvánky, založení firmy, přehled, faktury a archiv, ruční zadání,
import dokumentů a CSV, detail faktury, bankovní výpisy a párování, zákazníci,
reporty, upomínky a e-mailové šablony, nastavení, předplatné a asistent Esko.
Vizuální podklady: uložené desktopové snímky v `e2e/visual-baseline.spec.ts-snapshots`
a mobilní snímky z `docs/audits/2026-10-03-release/screenshots`.
Snímky zachycují starší stav; současné chování a popisky se ověřovaly v kódu.
Neproběhl nový živý průchod přihlášenou aplikací, měření aktuálního kontrastu
ani test s cílovými uživateli. Nálezy jsou odborné hypotézy, nikoli naměřené
výsledky použitelnosti. Žádná změna rozhraní není součástí tohoto auditu.

## Hlavní doporučení

Zachovat přehledné účetní tabulky a současnou vizuální identitu. Zjednodušit
rozhodování: na každé obrazovce ukázat, co má člověk udělat, co proběhne
automaticky a jaký bude výsledek jeho kliknutí. Účetní zná účetnictví, ale
nemusí znát strukturu aplikace; OSVČ navíc potřebuje vysvětlení některých
účetních pojmů. Jeden srozumitelný výchozí postup s dostupnými pokročilými
volbami je vhodnější než dvě oddělené aplikace či povinná volba režimu.

## Priorita 1: srozumitelnost a správné rozhodnutí

1. **Upomínky: název akce musí odpovídat odesílání.** V
   `reminders/reminders-client.tsx` tlačítko „Spustit kontrolu“ volá proces,
   který může odeslat skutečné e-maily. Potvrzovací dialog už odesílání
   vysvětluje; zpřesnit i vstupní tlačítko. Oddělit „Zobrazit čekající
   upomínky“ od „Spustit odesílání“. Před odesláním ukázat konkrétní příjemce,
   faktury a počty podle výsledku serverového výpočtu. Zobrazený počet nesmí
   slibovat přesný počet doručení, pokud běh může další položky přeskočit.

2. **Přehled: oddělit lidské úkoly od automatického programu.** Sekce
   „Vyžaduje pozornost“ v `dashboard/dashboard-client.tsx` zobrazuje
   `next_reminder_at` a přidává značku „Dnešní úkol“. Naplánovaný automatický
   e-mail ale nemusí vyžadovat zásah. Zobrazit samostatně „Potřebuje vaši
   kontrolu“ (nejisté platby, chybějící údaje, nedoručené e-maily) a
   „Splatno zařídí automaticky“ (naplánované upomínky). „Celkově k úhradě“
   přejmenovat na „Zákazníci vám ještě dluží“, aby OSVČ nečetl číslo jako
   vlastní závazky. U součtů uvést období a zahrnutí částečných úhrad.

3. **Faktury: omezit výchozí filtry.** V `invoices/invoices-client.tsx`
   je hledání plus deset dalších filtrů. Na desktopu nechat hledání,
   rychlé volby „Nezaplacené / Po splatnosti / Zaplacené / Všechny“ a
   „Další filtry“. Export oddělit od hledání. Na mobilu musí být hledání
   viditelné i bez otevření „Filtry a export“. Aktivní filtry zobrazit
   jako odstranitelné štítky a nabídnout „Zrušit filtry“ při nulovém výsledku.
   Zachovat funkce pro zkušené účetní a jejich zvolená nastavení.

4. **Přidání faktury: jeden jasný vstup a méně prvních rozhodnutí.**
   Hlavní akce „Přidat fakturu“ nabídne „Nahrát PDF nebo fotku“ a „Vyplnit
   ručně“. Ruční formulář dnes začíná identifikací a povinnou kategorií
   upomínek. Výchozí plán předvybrat a prezentovat jako jednoduché shrnutí,
   změnu odsunout do pokročilých voleb. Po uložení nabídnout konkrétní další
   kroky, například „Otevřít PDF“ a „Přidat další“. Rozlišit evidenci
   existujícího dokladu a vytvoření nového, aby uživatel rozuměl, zda
   fakturu pouze přidal, nebo také někomu odeslal.

5. **Povinný e-mail a kategorie mohou blokovat samotnou evidenci.**
   `components/invoice-form.tsx` vyžaduje e-mail i aktivní kategorii.
   Prověřit produktovou změnu: dovolit uložit fakturu bez e-mailu jako
   „Upomínky čekají na doplnění e-mailu“. Taková faktura nesmí být zařazena
   do automatického odesílání, dokud se údaje nedoplní. Jde o změnu pravidel
   produktu a validace, nikoli pouze o odebrání hvězdičky u pole.

6. **Onboarding zkrátit a sladit s pozdějšími nastaveními.** Současný
   průvodce má osm kroků včetně loga a týmu. Logo i tým jsou přeskočitelné,
   ale stále prodlužují dojem celého procesu. Doporučený postup: firma a
   kontakt → účet a výchozí upomínky → shrnutí a tarif. Logo a kolegy
   nabídnout po vstupu do aplikace. Výslovně zachovat informaci, že automat
   je při založení vypnutý. Před kartou ukázat dnešní cenu, podmínky konce
   zkušební doby a datum další platby, pokud je lze přesně určit.

7. **Logo: slíbené nastavení musí být skutečně dostupné.** Onboarding
   říká „Přidáte kdykoli v Nastavení → Firma“. V aktuálním
   `settings/settings-client.tsx` není ovládání pro nahrání loga, ačkoli
   `/api/settings/logo` existuje. Doplnit do firemních nastavení náhled,
   „Nahrát logo / Změnit logo / Odebrat logo“ a vysvětlení, že logo sdílejí
   všichni kolegové i e-mailové šablony. Při přeskočení místo „Bez loga“
   ukázat „Použije se logo Splatna“.

8. **Zákazník musí otevřít přesně své faktury.** Celý řádek je již klikací,
   ale odkaz v `customers/customers-client.tsx` předává hledání podle názvu.
   Po rozšíření vyhledávání je to textový filtr, nikoli přesná vazba.
   Použít samostatný filtr podle `customer_id` a zobrazit štítek
   „Faktury zákazníka Novák“. Zabrání to promíchání podobně pojmenovaných
   zákazníků. Zachovat samostatné úpravy telefonu a e-mailu.

## Priorita 2: snazší každodenní práce

- **Import dokumentů:** místo „OCR 87 %“ použít „Zkontrolujte 3 údaje“
  pouze tam, kde máme skutečný počet nejistých polí. Vysvětlit nejistotu
  u konkrétního údaje. Technické podrobnosti ponechat rozbalitelné.
  U dávky ukázat „Doklad 2 z 8“, hotové a problematické doklady a jasnou
  nabídku pokračovat po chybě. Současné kontroly před uložením zachovat.
- **Částky a DPH:** podle nastavení firmy přizpůsobit výchozí formulář;
  u neplátce nevysvětlovat, že je předvyplněno 21 %, když kód nastavuje 0 %.
  Jednoznačně ukázat částku, kterou zadávám, a částku, která se počítá.
  Ověřit zadání „1 250,50“ a vložení částek s mezerami; nynější HTML
  `type=number` samo o sobě nezaručuje stejnou zkušenost ve všech prohlížečích.
- **Detail faktury:** nahoru stav, celková částka, zbývající úhrada,
  splatnost a další plánovaná upomínka. Časté akce „PDF“, „Upravit“ a
  „Zapsat platbu“ zpřístupnit podle situace. Mazání je dnes v hlavních
  akcích; přesunout do „Další akce“. U částečné úhrady vždy ukázat částku
  platby a zůstatek. Storno a smazání jasně rozlišit.
- **Bankovní výpisy:** doplnit návody „Kde získám výpis z banky?“ s
  podporovanými bankami a skutečně podporovanými formáty. Zachovat současný
  postup nahrání → kontrola → potvrzení. Před zápisem zobrazit souhrn
  „12 plateb přiřazeno, 2 potřebují kontrolu, 5 nesouvisí s fakturami“.
  Formulace „Uložit kontrolu a potvrdit import“ zkrátit a její dopad
  vysvětlit vedle tlačítka. Důvod nejisté shody napsat běžným jazykem.
- **Archiv plateb:** rozlišit „Nahrané výpisy“, „Přijaté platby“ a
  „Platby k přiřazení“. „Paměť zákazníků“ vysvětlit jako „Příště poznat
  tohoto plátce podle účtu“. Hlášku „Fronta zachovala požadavek“ změnit na
  „Zpracování se nepodařilo. Zkusíme ho znovu automaticky“.
- **Reporty:** zachovat již existující předvolby období a záložky.
  Základní pohled zodpoví „Kolik jsem vyfakturoval, kolik přišlo a kolik
  chybí“. Pokročilé grafy a metriky ponechat ve vedlejších pohledech.
  „Období podle“ vysvětlit příklady vystavení vs. splatnosti; ukázat,
  jestli přijaté úhrady patří k vybraným fakturám, nebo k platbám v období.
- **Nastavení a tým:** rozdělit firmu, účty, logo, kolegy a předplatné do
  jasných sekcí. U dlouhých formulářů mít uložení také na konci nebo
  v dostupném panelu. Vedle rolí uvést oprávnění, například „Účetní —
  upravuje faktury a platby“. Nezobrazovat samotné neaktivní ovládání
  bez vysvětlení, pokud daný uživatel nemá oprávnění.
- **E-mailové šablony:** zachovat náhled a tlačítka pro vložení údajů;
  nabídnout doporučená znění a uživateli vysvětlit, že značky v textu
  se při odeslání doplní skutečnými hodnotami. Ukázat, komu jde testovací
  e-mail a které kategorie změna ovlivní. Logo, platební údaje a podpis
  prezentovat jako společné firemní údaje.
- **Předplatné:** odlišit platby zákazníků od placení za Splatno.
  Ukázat „Váš tarif“, další platbu, cenu včetně příslušného daňového
  vysvětlení a dopad změny či zrušení. Uživatel bez práv dostane jasnou
  informaci, že změnu provede administrátor firmy.
- **Přihlášení, MFA a pozvánky:** zachovat obnovení hesla, možnost
  ukázat heslo a návrat na původní stránku. Sjednotit označení přihlašovacího
  e-mailu i pro OSVČ s běžnou adresou. Prověřit vložení šestimístného kódu,
  vypršení a opětovné zaslání. Pozvanému ukázat firmu a roli, nikoli
  průvodce zakládáním nové firmy.
- **Esko:** zachovat návrhy otázek; „Faktury z OCR“ přejmenovat na
  „Faktury načtené ze souboru“. Doplnit pomoc vztahující se k právě
  otevřené obrazovce. Asistent má pomoci najít postup, nemá být nutný
  k pochopení základních akcí aplikace.

## Priorita 3: čitelnost a konzistence

Důležité popisky a instrukce nezmenšovat na pomocný text 10–12 px.
Jako návrhový cíl použít běžný text přibližně 16 px, tabulky kolem 14 px
s přepnutelnou hustotou a podpůrné instrukce 13–14 px. Jde o doporučení,
ne o naměřený nedostatek všech prvků. Kontrast a čitelnost ověřit na
aktuálně vykresleném rozhraní, i při 200% zvětšení.

Na mobilu trvale zpřístupnit hledání a hlavní akci; dlouhé formuláře
neukončovat tlačítkem, které uživatel musí hledat. Celé řádky mohou být
klikací, ale mají zachovat samostatné odkazy, ovládání klávesnicí a
oddělená tlačítka. Stav má obsahovat slovo i barvu. Nativní date inputy
otestovat v českém prostředí; starý screenshot s anglickým datem sám
neprokazuje chybu aktuální lokalizace.

## Co už funguje a má zůstat

Postranní navigace má srozumitelné hlavní oblasti. Import dokumentů má
náhled a potvrzení. Formulář faktury vypisuje důvody, proč nejde uložit.
K dispozici je ochrana neuložených změn, rozepsané formuláře, prázdné
stavy s další akcí, vysvětlení rolí a potvrzení nevratných akcí.
Upomínky mají lidsky formulovaný časový plán, e-maily živý náhled.
Chybová oznámení nezmizí automaticky. Nově sjednocené firemní logo a
vyhledávání není potřeba znovu navrhovat; je třeba navázat konzistentním
použitím a přesným filtrem konkrétního zákazníka.

## Doporučené pořadí implementace

1. Zpřesnit odesílání upomínek, dashboardové úkoly a dostupnost loga.
2. Zjednodušit filtry a vstup „Přidat fakturu“, upravit mobilní hledání.
3. Zkrátit založení firmy a dotáhnout přechod k první faktuře.
4. Zlepšit kontrolu importů a párování, navázat detail faktury a zákazníka.
5. Sjednotit nastavení, reporty, předplatné, typografii a pomocné texty.

## Jak ověřit intuitivnost

Uspořádat krátký test se skutečnými účetními a OSVČ, kteří Splatno neznají.
Dát jim testovací firmu se syntetickými daty; nic se neodesílá skutečným
zákazníkům. Nechat bez nápovědy přidat PDF fakturu, najít dlužníka,
zapsat částečnou platbu, přiřadit bankovní platbu, zobrazit chystanou
upomínku a změnit logo nebo kontakt firmy. Sledovat dokončení bez pomoci,
první nesprávné kliknutí, neporozumění popisku a pochopení výsledku akce.
Především ověřit, že účastník správně pozná, které kliknutí posílá e-mail.
Teprve z výsledků určit, které návrhy opravdu zkracují a usnadňují práci.

## Opora návrhu

Pokročilé možnosti odkrývat postupně:
[Nielsen Norman Group — Progressive Disclosure](https://www.nngroup.com/articles/progressive-disclosure/).
Formuláře doplnit jasnými instrukcemi a chyby navázat na konkrétní pole:
[W3C WAI — User Notification](https://www.w3.org/WAI/tutorials/forms/notifications/).
