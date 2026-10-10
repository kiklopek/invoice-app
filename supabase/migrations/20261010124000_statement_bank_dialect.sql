-- Z jaké banky a jakým „klíčem“ (dialektem formátu) se výpis četl.
-- Audit k registru bank (src/lib/bank-formats/registry.ts): když se dialekt
-- některé banky ukáže jako špatně přečtený, jde dohledat, kterých výpisů se
-- to týká. Plní aplikace po uložení náhledu; staré výpisy zůstanou null.
alter table public.bank_statement_imports
  add column if not exists bank_code text check (bank_code is null or bank_code ~ '^[0-9]{4}$'),
  add column if not exists format_dialect text check (format_dialect is null or format_dialect in ('km','edition','csv','camt053'));
