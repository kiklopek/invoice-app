# Splatno Síť — propojení firem a vzájemná fakturace

Síť firem ve stylu „LinkedIn pro faktury“: bez příspěvků a feedu, jen propojení a faktury mezi propojenými firmami.

## Co funkce umí

- **Propojení firma↔firma.** Admin najde firmu podle IČO a pošle žádost; druhý admin ji přijme nebo odmítne.
  - Firmě, která Splatno nepoužívá, pošle pozvánku e-mailem.
  - Po registraci ji přijme na `/pripojeni/[token]`.
- **Vzájemná bilance** (`/partneri`, `/partneri/[id]`): kdo komu kolik dluží, čistá pozice, částky po splatnosti a platební morálka za 12 měsíců.
  - Vše se počítá zvlášť pro každou měnu, nic se nepřepočítává.
- **Přijaté faktury** (`/partneri/prijate`): faktury od všech partnerů na jednom místě.
  - PDF s QR platbou je jen u nezaplacených faktur.
- **Připomínky k fakturám:** rozpor s důvodem nebo „už jsme zaplatili“.
  - Jsou to jen viditelné záznamy.
  - Stav ani peníze faktury nemění, rozhoduje vystavitel.
- **Růst sítě:**
  - návrhy firem, se kterými už obchodujete;
  - seznam odběratelů bez Splatna s pozvánkou;
  - atribuce `organizations.referred_by_org` pro budoucí odměny za doporučení.

## Pravidla, na kterých to stojí

| Pravidlo | Kde |
|---|---|
| Nic se nekopíruje. Partner čte faktury vystavitele přes aktivní propojení. | `private.network_shared_invoices` |
| Viditelné jsou faktury otevřené v okamžiku propojení (`open_snapshot`) a faktury založené po něm. Importovaná zaplacená historie a dřívější zaplacené faktury jsou vidět jen se souhlasem vystavitele (`*_share_history`). | totéž |
| IČO obou stran se zapíše při vzniku propojení. Změna IČO propojení zruší (trigger `organizations_network_ico_change`). | migrace |
| Nejednoznačné IČO (více firem) se nikdy nepřiřadí. | `private.network_org_ready` |
| Návrh „fakturují vám“ se zobrazí jen u faktur adresovaných na e-mail člena nebo firmy. Samotné IČO nestačí. | `network_overview` |
| Tabulky nemají žádnou policy pro klienty. Vše jde přes funkce `network_*` (jen `service_role`), které berou organizaci z identity a samy ověřují roli. | migrace, API |
| Role: síť vidí účetní a admin, spravuje jen admin, čtenář nic. | `canViewNetwork`, `canManageNetwork` |
| Pozvánka je věcná a navázaná na existující vztah, bez pobídek. Obsahuje odesílatele a zdroj adresy (čl. 14 GDPR). Na adresu odejde jedna pozvánka a nejvýš jedna připomínka. Odhlášení platí pro všechny firmy a každý vydaný odkaz dál funguje. | `network-invitations.ts`, `network_invitation_tokens` |

## Testy

- `node scripts/test-partner-network-db.mjs` (PGlite, přehraje všechny migrace a spustí `supabase/tests/partner_network.sql`). Pokrývá:
  - izolaci dat mezi firmami,
  - bilanci z obou stran,
  - změnu IČO,
  - platbu se zpětným datem,
  - importovanou historii,
  - připomínky,
  - pozvánky a opt-out,
  - práva.

  Jednorázová příprava: `npm install --prefix .cache/reconciliation-tools --no-save --package-lock=false @electric-sql/pglite@0.3.14`.
- Vitest:
  - `partner-network.test.ts`
  - `network-invitations.test.ts`
  - `partner-network-access.test.ts`
  - `invoice-pdf.test.ts` (PDF bez QR)

## Nasazení

Migraci `20261013120000_partner_network.sql` nejdřív aplikujte na Supabase Preview nebo staging. Po `apply_migration` přejmenujte lokální soubor podle skutečné verze (`list_migrations`). Pak spusťte advisors (security a performance).

## Další fáze (podle rešerše)

1. **Ověřená firma.** Přidat jednu z možností:
   - účet zveřejněný v registru plátců DPH (mikroplatba z firemního účtu),
   - Bank iD + statutár v ARES VR,
   - kód do datové schránky.

   Podle stavu ověření zobrazovat odznak a zpřísnit vyhledávání podle IČO.
2. **Varování podle §109 ZDPH** u přijatých faktur: nespolehlivý plátce, účet nezveřejněný v registru.
3. **Odkaz „Zobrazit fakturu online“ v upomínkách.** Cron `check-due` je chráněná cesta, proto jen s testy předem.
4. **Odsouhlasení salda k datu** (PDF pro auditora), potom návrh zápočtu dohodou (§1991 OZ). Zápočet nikdy na spornou fakturu.
5. **Odměna za doporučení:** měsíc zdarma pro obě strany po první zaplacené fakturaci doporučené firmy. Jedna odměna na IČO a kontrola zneužití.
6. **Export ISDOC** a Peppol ID v profilu (Slovensko od roku 2027, ViDA od roku 2030).
