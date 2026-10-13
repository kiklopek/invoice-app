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
výchozí `https://www.splatno.cz`. Kanonická adresa se neodvozuje z požadavku.
U `splatno.cz` se vždy použije kanonická varianta `www.splatno.cz`, v souladu
s přesměrováním domény ve Vercelu. Next.js obsahuje stejné přesměrování jako
zálohu, včetně zachování cesty, parametrů a metody požadavku.

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
2. V Google Search Console používat doménovou službu `splatno.cz`, která
   zahrnuje `www`, ostatní subdomény a HTTP/HTTPS. Uživatel potvrdil, že tato
   služba už je ověřená. Přímá kontrola účtu vyžaduje jeho propojení.
3. Odeslat `https://www.splatno.cz/sitemap.xml` (nebo sitemap na nakonfigurované doméně).
4. V Search Console zkontrolovat obě jazykové URL a následně indexaci a hledané dotazy.
5. Právní texty přidat do veřejné indexace až po dokončení a schválení obsahu.

Obě domény jsou v projektu Vercel `invoice-app` ověřené. `splatno.cz` má
nastavené trvalé přesměrování 308 na `www.splatno.cz`. Autoritativní DNS je
u WEDOSu; Vercel u obou domén hlásí `misconfigured=false`.
Pro kontrolu skutečné produkce spusťte `corepack pnpm check:domains`.
Přesměrování apex domény je v Search Console očekávaný stav; indexovat se
má výsledná kanonická stránka na `www`, ne její přesměrovaná kopie.

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
