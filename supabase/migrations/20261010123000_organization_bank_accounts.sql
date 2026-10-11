-- Další bankovní účty firmy.
--
-- Hlavní účet pro CZK a EUR zůstává v organizations (bank_account_czk /
-- bank_account_eur) -- jde na faktury a do QR. Firma ale často má víc účtů:
-- R. Hlavica nahrává výpisy i z druhého účtu u KB a každý výpis hlásil
-- „neshodu účtu“ (a s obnovenou blokací by se automaticky nic nezaúčtovalo).
-- Tady jsou další účty: podle nich se pozná výpis, jeho měna, vlastní
-- převody a účet pro fakturu v měně, která nemá hlavní účet.
--
-- Zápis jen přes API (service_role, administrátor firmy); členové čtou.

create table if not exists public.organization_bank_accounts (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  account text not null check (length(account) between 6 and 64 and account !~ '\s'),
  -- Jednotný tvar (IBAN) pro porovnání a unikátnost; počítá aplikace
  -- (src/lib/bank-accounts.ts canonicalAccount).
  canonical text not null check (canonical ~ '^[A-Z]{2}[0-9]{2}[A-Z0-9]{10,30}$'),
  currency text not null check (currency ~ '^[A-Z]{3}$'),
  label text check (label is null or length(label) <= 80),
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  unique (organization_id, canonical)
);
create index if not exists organization_bank_accounts_org on public.organization_bank_accounts (organization_id);

alter table public.organization_bank_accounts enable row level security;
revoke all on public.organization_bank_accounts from anon, authenticated;
grant select on public.organization_bank_accounts to authenticated;
grant select, insert, update, delete on public.organization_bank_accounts to service_role;

drop policy if exists "members can view bank accounts" on public.organization_bank_accounts;
create policy "members can view bank accounts" on public.organization_bank_accounts
  for select to authenticated using (private.is_org_member(organization_id));
