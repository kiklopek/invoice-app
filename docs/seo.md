# SEO Splatna

Ve vyhledávačích se mají zobrazovat publikované produktové stránky `/` a `/en`.
Firemní data, přihlášení, pozvánky, API a zatím pracovní právní texty mají
`noindex`. Nové stránky tuto ochranu dědí z kořenového layoutu; publikovaná
produktová stránka musí mít vlastní metadata a být přidaná do sitemapu.

## Implementace

- `src/lib/seo.ts`: kanonická doména z `APP_BASE_URL`, metadata CZ/EN,
  vzájemné `hreflang`, náhledy Open Graph a Twitter, strukturovaná data.
- `src/app/robots.ts`: veřejné stránky a jejich soubory jsou crawlable.
  Soukromé HTML není blokované v robots.txt, aby vyhledávač mohl přečíst `noindex`.
  Přístup k firemním datům chrání stávající autentizace.
- `src/app/sitemap.ts`: jen kanonické produktové stránky. Neuvádí umělé
  datum poslední změny, neveřejné stránky ani právní návrhy.
- `next.config.js`: `X-Robots-Tag` vylučuje soukromé a neznámé cesty včetně
  přesměrování a odpovědí API. Produkční veřejné stránky a jejich obrázky
  tento zákaz nedostávají. Preview a development mají zákaz indexace i na `/`.
- `/og/cs` a `/og/en`: předgenerované PNG 1200 × 630 s lokálním fontem,
  bez externí služby a bez osobních dat.
- FAQ je v serverovém HTML, ovládá se nativními `details` a nepotřebuje JavaScript.
  Zkušební limity vycházejí ze společného `src/lib/plans.ts`.

Indexace se povolí jen při `NODE_ENV=production` a `VERCEL_ENV=production`
(nebo bez `VERCEL_ENV` při hostování mimo Vercel). `APP_BASE_URL` musí být
veřejná HTTPS doména; neplatná, lokální či Vercel preview adresa použije
výchozí `https://www.splatno.com`. Kanonická adresa se neodvozuje z požadavku.
Všechny varianty Splatna (`splatno.cz`, `www.splatno.cz`, `splatno.com`,
`www.splatno.com`) se pro metadata normalizují na `https://www.splatno.com`,
i když konfigurace prostředí stále obsahuje starší doménu. Next.js přesměruje
obě `.cz` varianty i apex `.com` na `www.splatno.com` s HTTP 308 a zachováním
cesty, parametrů a metody požadavku.

## Ověření

```powershell
corepack pnpm exec vitest run src/lib/seo.test.ts src/lib/landing-static.test.ts src/i18n/dictionaries.test.ts
corepack pnpm lint
corepack pnpm build
corepack pnpm start --hostname 127.0.0.1 --port 3100
# V druhém terminálu:
corepack pnpm check:seo
```

Build a start vyžadují platnou lokální konfiguraci podle produkčního validátoru.
`check:seo` je pouze čtecí kontrola, nepotřebuje přihlášení a nezapisuje do databáze.
Kontroluje i HTML před spuštěním JavaScriptu, indexaci, kanonické adresy,
jazyky, sitemapu, PNG a funkční FAQ na mobilu a desktopu. Obrázky ukládá
do ignorované `.artifacts/seo/`. Jinou adresu lze nastavit pomocí
`SEO_CHECK_BASE_URL`; při vlastní kanonické doméně nastavte též `APP_BASE_URL`.

## Po nasazení

1. Ověřit, že skutečná produkce vrací na `/` a `/en` HTTP 200 bez `noindex`.
2. V Google Search Console ověřit doménovou službu `splatno.com`; stávající
   ověření `splatno.cz` se na jinou doménu automaticky nevztahuje.
3. Odeslat `https://www.splatno.com/sitemap.xml`.
4. V Search Console zkontrolovat obě veřejné URL, živou odpověď a Googlem
   vybranou kanonickou adresu; potom požádat o indexaci.
5. Právní texty přidat do veřejné indexace až po dokončení a schválení obsahu.

### Přechod na .com — připravený k nasazení 22. 10. 2026

Uživatel zvolil `www.splatno.com` jako hlavní doménu. V projektu Vercel
`invoice-app` (`prj_JfDfhBKx5lyiluLO5c4wVUnTTAJz`, tým
`team_WrYh8HxKpWtmy4tMh9Y36iXy`) byly čtecím konektorem ověřeny všechny
čtyři domény. Aktuální produkce stále vrací canonical na `.cz`.
`www.splatno.com` nemá platformní přesměrování, apex `.com` míří 308 na
`www.splatno.com`; apex `.cz` zatím míří 308 na `www.splatno.cz`.

Připravená změna zahrnuje metadata, sitemapu, robots odkaz, strukturovaná
data, doménu v OG obrázku, aplikační přesměrování, příklad APP_BASE_URL a
ověřovací skripty. Historické výsledky níže popisují stav před tímto přechodem.

Při produkčním přechodu:

- Nasadit tuto SEO změnu odděleně od rozpracovaného redesignu.
- Nastavit obě `.cz` domény ve Vercelu přímo na 308 `www.splatno.com`.
  Aplikační přesměrování funguje i jako záloha; bez platformní změny může
  apex `.cz` absolvovat jeden přesměrovací krok navíc.
- Nastavit produkční APP_BASE_URL na `https://www.splatno.com`. Před změnou
  ověřit povolené návratové adresy autentizace pro `.com`, protože APP_BASE_URL
  slouží i e-mailovým odkazům. Samotná změna SEO nepřepisuje nastavení Auth.
- Spustit `node scripts/domain-seo-check.mjs`: očekává HTTP/HTTPS obou TLD,
  hlavní `.com` canonical, sitemapu a zachovanou ochranu přihlášení.
- V Search Console ověřit `.com`, odeslat novou sitemapu a zkontrolovat URL.
  Pokud jde o přesun již indexovaného webu, využít nástroj Změna adresy
  ve staré službě `.cz` až po funkčním nasazení a přesměrováních.

Produkční nastavení, prostředí ani deployment během přípravy nebyly změněny.

Technická připravenost sama nezaručuje pořadí ani zařazení do výsledků.
Strukturovaná data popisují skutečný produkt; neobsahují vymyšlená hodnocení.

## Výsledek lokální kontroly 13. 10. 2026

- 24 cílených testů prošlo (SEO, statická landing page, slovníky).
- ESLint a TypeScript prošly; produkční build předgeneroval `/`, `/en`,
  `/robots.txt`, `/sitemap.xml` a oba náhledové obrázky.
- `check:seo` prošel proti lokálnímu produkčnímu serveru: obě jazykové verze,
  mobil a desktop, nativní FAQ, metadata v serverovém HTML, veřejná indexace
  a `noindex` na soukromých odpovědích a právních návrzích.
- Build a server použily dočasný lokální MFA klíč a prázdnou lokální výjimku
  MFA. Stávající `.env.local` tyto produkční požadavky nesplňoval; soubor ani
  konfigurace nasazené služby nebyly změněny. Kontrola potvrzuje implementaci,
  nikoliv aktuální produkční konfiguraci nebo skutečnou indexaci.

Podklady: [Google: robots a noindex](https://developers.google.com/search/docs/crawling-indexing/robots-meta-tag),
[Google: sitemap](https://developers.google.com/search/docs/crawling-indexing/sitemaps/build-sitemap),
[Google: jazykové verze](https://developers.google.com/search/docs/specialty/international/localized-versions).

## Čtecí kontrola produkce 22. 10. 2026

`node scripts/domain-seo-check.mjs` prošel proti skutečné produkci bez
přihlášení, změn konfigurace a nasazení. Výsledek je uložený v ignorované
`.artifacts/seo/domain-check.json`. Také prošlo 25 testů `src/lib/seo.test.ts`.

- `/` a `/en` na `https://www.splatno.cz` vracejí HTTP 200, index/follow,
  odpovídající canonical a žádnou hlavičku X-Robots-Tag s noindex.
- HTTP i HTTPS varianty obou hostů přecházejí trvalými přesměrováními
  na HTTPS www; zachovávají cestu a parametry. Kontrola s User-Agent Googlebot
  vrací obě veřejné stránky s HTTP 200 a povolenou indexací.
- `/robots.txt` a `/sitemap.xml` vracejí HTTP 200. Sitemap obsahuje pouze
  českou a anglickou veřejnou stránku a odpovídá kanonické doméně.
- Anonymní `/invoices` přesměruje na přihlášení; přihlášení včetně varianty
  `?returnTo=/invoices` vrací noindex v metadatech i hlavičce.

Tyto kontroly nepotvrzují zařazení do indexu ani stav ověření v účtu Search
Console. Screenshot obsahuje historickou chybu 5xx, ale ne její konkrétní URL;
bez detailu této chyby nelze určit příčinu ani označit incident za vyřešený.
U přihlášení je noindex očekávaný. Alternativní stránka se správným canonical
je v pořádku, pokud Google vybral odpovídající veřejnou URL na HTTPS www.

Další postup v Search Console: zkontrolovat živou hlavní URL a `/en`, ověřit
uživatelem a Googlem zvolenou kanonickou adresu, požádat o indexaci těchto
veřejných URL a ověřit úspěšné zpracování produkční sitemapy. Konkrétní URL
5xx nejprve otestovat a až po odstranění příčiny spustit ověření opravy.
