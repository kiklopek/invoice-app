# Vyhledávání faktur a zákazníků

Hledání nerozlišuje velikost písmen ani diakritiku. Každé zadané slovo musí
odpovídat některému údaji záznamu, ale pořadí slov a sloupec nehrají roli.
`novak 2026` proto najde faktury firmy Novák s číslem obsahujícím 2026.
`brno novak` najde zákazníka Novák s adresou v Brně.

Telefony a identifikátory lze hledat bez mezer a oddělovačů: `777123456`
odpovídá `777 123 456`, `FV2026001` odpovídá `FV-2026/001`.
Znaky `%` a `_` nejsou SQL zástupné znaky. Neprovádí se oprava překlepů.

- Faktury: číslo, odběratel, IČO, DIČ, e-mail, variabilní symbol, poznámky.
- Seznam zákazníků: název, IČO, DIČ, e-mail, telefon, adresa, poznámky, kategorie upomínek.
- Našeptávání zákazníků při zadávání faktury: název, IČO, DIČ, e-mail, telefon, adresa.

Normalizace zákazníků se ukládá do lokálního indexu při načtení dat.
Databázové vyhledávání používá trigramové indexy normalizovaných údajů.
Vyhledávání faktur probíhá v databázi před stránkováním a výpočtem součtů;
archiv a export používají stejný filtr. Našeptávání vrací nejvýše 10 výsledků
a upřednostňuje přesný název a shodu začátku názvu.

## Nasazení

Před nasazením API aplikujte migraci
`supabase/migrations/20261012233239_comprehensive_search.sql` běžným postupem
projektu. Přidává RPC `search_customers` a mění filtr stávajícího RPC
`list_invoices_page_filtered`. Migrace je otestovaná lokálně a automaticky
se neaplikuje na vzdálenou databázi.

## Ověření

```sh
corepack pnpm exec vitest run src/lib/text-search.test.ts src/lib/customer-search-query.test.ts src/lib/invoice-list-query.test.ts
npm install --prefix .cache/reconciliation-tools --no-save --package-lock=false @electric-sql/pglite@0.3.14
node scripts/test-search-db.mjs
```

Databázový test přehraje migrace v dočasném PostgreSQL a ověří hledání,
stránkování, součty, oprávnění a izolaci firem. Nepřipojuje se k produkci.

Do nasazení migrace používá našeptávání zákazníků při chybě chybějícího RPC
původní vyhledávání s allowlistem a filtrem organizace. Selhání oprávnění ani
ostatní databázové chyby se tímto fallbackem nezakrývají. Rozšířené databázové
hledání se aktivuje až aplikováním migrace; samotný push ji nenasazuje.
