# Hlavica Dřevo — evidence pohledávek a upomínek

Interní webová aplikace pro evidenci pouze těch vydaných faktur, které mají odběratelé zaplatit společnosti R. Hlavica s.r.o. Aplikace hlídá splatnost, plánuje e-mailové upomínky, eviduje jejich průběh a poskytuje přehledy pohledávek.

## Aktuálně implementováno

- přihlášení přes Supabase Auth a firemní role `viewer`, `accounting`, `admin`,
- samostatný přehled, seznam faktur, detail faktury, import, upomínky, reporty a nastavení,
- ruční založení a úprava faktury, zápis skutečného data úhrady, vrácení mezi neuhrazené a storno,
- soukromý přímý upload PDF, JPG, PNG a WEBP do 10 MB přes jednorázový podepsaný token, následovaný serverovou kontrolou skutečného typu a velikosti,
- multimodální OCR přes OpenAI Responses API, které z PDF nebo fotografie předvyplní údaje faktury ve striktním schématu a vždy vyžaduje lidskou kontrolu,
- ochrana OCR proti dvojímu spuštění, maximálně tři pokusy na dokument, časový limit a bezpečný ruční fallback,
- hromadný CSV import až 250 faktur jako jeden databázový zápis a vzorové CSV,
- atomický import až 500 příchozích bankovních plateb, ochrana před duplicitami a automatické párování pouze při přesné shodě VS, měny a částky,
- trvalá evidence nespárovaných a nejasných plateb ke kontrole a zobrazení spárované transakce přímo v detailu faktury,
- bezpečné ruční přiřazení výjimky pouze k otevřené faktuře se stejnou částkou a měnou,
- více částečných bankovních úhrad jedné faktury, průběžný zůstatek a atomická oprava chybného přiřazení s obnovením plánování upomínek,
- export právě filtrovaných dat s ochranou před CSV formula injection,
- databázově filtrovaný a stránkovaný seznam faktur s přesnými souhrny bez načítání celé historie do prohlížeče,
- lidské nastavení termínů upomínek a čtyř e-mailových šablon,
- nepovinná adresa pro odpověď a až pět interních kopií samostatně pro každý typ upomínky,
- profesionální responzivní HTML e-maily s firemním logem, údaji k platbě, textovou zálohou a skutečným živým náhledem šablony,
- bezpečné testovací odeslání pouze na e-mail přihlášeného pracovníka,
- globální přepínač pro bezpečné pozastavení a opětovné spuštění automatických upomínek,
- pozastavení upomínek pro jedinou fakturu a bezpečné ruční opakování neúspěšného e-mailu,
- automatický denní cron, historie pokusů, ochrana proti souběžnému a duplicitnímu odeslání,
- bezpečné ruční spuštění okamžité kontroly pro účetní a administrátory, omezené pouze na jejich firmu a zapsané v provozní historii,
- podepsaný Resend webhook pro stav doručení, vrácené zprávy a spam complaint včetně automatického zablokování problémové adresy,
- automatické zastavení dalších upomínek po úhradě nebo stornu,
- provozní přehled plánovaných, úspěšných a neúspěšných upomínek včetně času a výsledku posledního běhu automatu,
- reporty podle období, typu data, měny, stavu a odběratele,
- serverově agregované reporty a dávkový CSV export bez načítání celé účetní historie do prohlížeče,
- serverově agregovaný dashboard, který do prohlížeče posílá jen součty a právě zobrazené řádky,
- správa pozvaných členů firmy a jejich rolí přímo v nastavení, včetně atomické ochrany posledního administrátora,
- provozní diagnostika databáze, úložiště, e-mailu a cronu bez zveřejnění tajných klíčů,
- databázově vynucená auditní historie založení, úprav, úhrad, storna a pozastavení faktury,
- responzivní plochý minimalistický design v zelené, bílé a krémové paletě s vlastní sadou SVG ikon,
- Row Level Security, soukromé dokumenty, krátkodobé podepsané odkazy, role na API i databázové vrstvě a bezpečnostní HTTP hlavičky.

OCR se v produkci aktivuje serverovým `OPENAI_API_KEY`; bez klíče zůstává dokument uložený a účetní může údaje doplnit ručně. Produkční běh neobsahuje ani nevrací ukázková data.

## Lokální spuštění

Lokální aplikace vyžaduje nakonfigurovaný Supabase projekt a platný firemní účet:

```powershell
npm install
npm run dev
```

Aplikace poběží na `http://localhost:3000`.

## Produkční nastavení

### 1. Supabase

1. Založte nový Supabase projekt.
2. V SQL editoru spusťte celý soubor `supabase/schema.sql`.
   U již existující databáze místo nového schématu postupně spusťte dosud nepoužité soubory ze složky `supabase/migrations`.
   Podrobný návrh tabulek, vztahů a oprávnění je v `supabase/README.md`.
3. Založte organizaci a pozvánku prvního administrátora:

```sql
insert into organizations (
  name, ico, dic, registered_address, operating_address, data_box_id,
  phone, email, bank_account_czk, bank_account_eur
) values (
  'R. Hlavica s.r.o.', '26296039', 'CZ26296039',
  'Palackého třída 192/60, Brno-Královo Pole, 612 00',
  'Podhradní Lhota 193, Rajnochovice, 768 71',
  '87qv26b', '+420 573 500 700', 'kostihova@hlavica.cz',
  '6844160247/0100', '94-2613370257/0100'
) returning id;

insert into organization_members (organization_id, email, role)
values ('UUID_ORGANIZACE', 'EMAIL_PRVNIHO_UZIVATELE', 'admin');

insert into reminder_policies (organization_id, name, is_default)
values ('UUID_ORGANIZACE', 'Výchozí upomínky', true);
```

E-mail v `organization_members` ukládejte malými písmeny. Při prvním přihlášení se pozvánka bezpečně sváže s ID uživatele Supabase Auth.

### 2. Resend

1. Ověřte firemní odesílací doménu v Resend.
2. Vytvořte omezený API klíč.
3. Nastavte adresu odesílatele, například `upominky@hlavica.cz`.
4. V Resend vytvořte webhook na `https://VAŠE-DOMÉNA/api/webhooks/resend` pro události `email.sent`, `email.delivered`, `email.delivery_delayed`, `email.bounced`, `email.complained` a `email.failed`.
5. Signing secret webhooku vložte do `RESEND_WEBHOOK_SECRET`.

### 3. OpenAI OCR

1. V OpenAI API projektu vytvořte serverový API klíč s omezeným rozpočtem.
2. Nastavte `OPENAI_API_KEY`; volitelně lze přepsat `OPENAI_OCR_MODEL`.
3. Dokument se do OpenAI posílá pouze po ověření přihlášeného člena, organizace, role, typu a velikosti souboru.
4. OCR je pomocné předvyplnění: žádná faktura se neuloží bez kontroly a potvrzení účetním.

### 4. Proměnné prostředí

Zkopírujte `.env.example` do `.env.local` a vyplňte:

```dotenv
NEXT_PUBLIC_SUPABASE_URL=https://PROJECT.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=...
SUPABASE_SERVICE_ROLE_KEY=...
RESEND_API_KEY=...
REMINDER_EMAIL_FROM=R. Hlavica <upominky@hlavica.cz>
AUTH_EMAIL_FROM=Splatno.cz <prihlaseni@splatno.cz>
RESEND_WEBHOOK_SECRET=...
EMAIL_MFA_SECRET=nahodny-tajny-retezec-alespon-32-znaku
# Pouze dočasné testování; před ostrým provozem musí zůstat prázdné.
EMAIL_MFA_BYPASS_EMAILS=
APP_BASE_URL=https://VAŠE-DOMÉNA
# Volitelné; jinak se použije /brand/drevohlavica.png z APP_BASE_URL.
REMINDER_LOGO_URL=
CRON_SECRET=dlouhy-nahodny-tajny-retezec
OPENAI_API_KEY=...
OPENAI_OCR_MODEL=gpt-5.6-sol
```

`SUPABASE_SERVICE_ROLE_KEY`, `RESEND_API_KEY`, `RESEND_WEBHOOK_SECRET`, `OPENAI_API_KEY` ani `CRON_SECRET` nikdy nevkládejte do proměnné začínající `NEXT_PUBLIC_` a necommitujte `.env.local`.

### 5. Supabase Auth

- v Auth URL Configuration nastavte produkční `Site URL`,
- přidejte `https://VAŠE-DOMÉNA/auth/callback` mezi povolené redirect URL,
- zapněte potvrzení e-mailu pro nové registrace a nakonfigurujte firemní SMTP šablony pro potvrzení účtu a obnovu hesla,
- uživatel se přihlašuje heslem a následně šestimístným kódem zaslaným na firemní e-mail; registrace je funkční pouze pro e-mail předem pozvaný v `organization_members`,
- e-mailový kód platí 10 minut, lze jej použít pouze jednou a po pěti chybných pokusech se zablokuje,
- povoleny jsou pouze adresy `@hlavica.cz`, které zároveň existují v `organization_members`,
- nevytvářejte veřejnou registraci bez odpovídající pozvánky v `organization_members`,

V režimech `development` a `test` aplikace kvůli lokálnímu testování přijme i platný e-mail mimo `@hlavica.cz`. Produkční sestavení omezení vždy znovu vynutí; uživatel však i při vývoji musí mít odpovídající záznam v `organization_members`.

Pokud při lokálním vývoji není Supabase nakonfigurovaný, aplikace se automaticky spustí v demo režimu: autentizaci přeskočí a API používají ukázková data. Tato větev je podmíněná `NODE_ENV !== "production"`, takže v produkčním sestavení není dostupná.
- `EMAIL_MFA_BYPASS_EMAILS` je pouze dočasná testovací výjimka a před ostrým provozem musí být prázdná.

### 6. Cron a nasazení

`vercel.json` volá každé ráno v 06:00 UTC trasu `/api/cron/check-due`. Vercel odešle `CRON_SECRET` jako Bearer token. Před ostrým provozem ověřte, že zvolený tarif podporuje požadovanou četnost a délku běhu.

Prvotní upload dokumentu nejde přes Vercel Function: prohlížeč jej přenese podepsaným jednorázovým tokenem přímo do soukromého Supabase Storage a API následně ověří jeho skutečný obsah. Až chráněná OCR route ověřený dokument serverově načte a odešle do OpenAI.

## Ověření před nasazením

```powershell
npm run typecheck
npm test
npm run build
```

Poté v testovací organizaci proveďte celý scénář: přihlášení, OCR z PDF i fotografie, kontrola předvyplněných údajů, vytvoření faktury, změna splatnosti, testovací odeslání na interní adresu, ověření doručovacího webhooku, import bankovní platby se shodným VS, kontrola úhrady a historie a export reportu.

## Bezpečnostní zásady

- API vždy ověřuje aktivní session, členství i roli; UI není bezpečnostní hranice.
- Service role se importuje pouze v serverových modulech označených `server-only`.
- Dokumenty nejsou veřejné; detail vytváří odkaz platný pět minut.
- Stejná upomínka používá databázový zámek a Resend idempotency key.
- Každá změna termínů nebo textů automatických upomínek se atomicky uloží s uživatelem a úplným snapshotem nastavení.
- Správa uživatelských přístupů má neměnnou historii a každá změna role proběhne atomicky s auditním záznamem.
- Složené cizí klíče nedovolí propojit fakturu, přílohu, upomínku ani platbu s jinou firmou.
- Databázové RPC určené pro cron lze spustit pouze rolí `service_role`.
- Viewer může data číst, ale databázová RLS mu nedovolí faktury měnit ani přímým dotazem.
- Produkční databázi zálohujte a zapněte obnovu do bodu v čase podle možností zvoleného tarifu.


## Ostré spuštění

Před přepnutím DNS a zahájením ostrého provozu:

1. spusťte všechny migrace včetně `2026080619_corporate_email_domain.sql`,
2. ověřte, že v `organization_members` nejsou adresy mimo `@hlavica.cz`,
3. nastavte produkční URL v Supabase Auth a povolený callback,
4. nastavte všechny tajné proměnné prostředí ve Vercelu,
5. proveďte přihlášení heslem, doručení e-mailového kódu a druhé přihlášení s novým jednorázovým kódem,
6. ověřte cron, Resend webhook, OCR, import plateb a obnovu databáze ze zálohy,
7. spusťte `npm run typecheck`, `npm test` a `npm run build` v čistém CI prostředí.
