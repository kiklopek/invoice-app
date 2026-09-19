-- Durable customer/debtor registry keyed by IČO, kept in sync with invoices
-- via a BEFORE trigger (unlike the AFTER-trigger counterparty_reminder_preferences
-- precedent, this must set NEW.customer_id on the row being written).

create table customers (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  name text not null,
  ico text check (ico is null or ico ~ '^[0-9]{8}$'),
  dic text,
  email text,
  phone text,
  notes text,
  created_by uuid references auth.users(id) on delete set null,
  updated_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, ico)
);

create index customers_org_name_idx on customers (organization_id, name);

alter table customers enable row level security;
revoke all on table customers from public, anon, authenticated;
grant select, insert, update, delete on table customers to service_role;

comment on table customers is
  'Durable customer/debtor registry keyed by normalized Czech ICO, kept in sync from invoices via remember_customer_from_invoice().';

alter table invoices add column if not exists customer_id uuid references customers(id) on delete set null;
create index invoices_org_customer_idx on invoices (organization_id, customer_id);

create or replace function remember_customer_from_invoice()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
declare
  normalized_ico text := regexp_replace(coalesce(new.counterparty_ico, ''), '[^0-9]', '', 'g');
  matched_customer_id uuid;
begin
  if normalized_ico ~ '^[0-9]{8}$' then
    insert into public.customers (
      organization_id, ico, name, dic, email, created_by, updated_by
    ) values (
      new.organization_id, normalized_ico, new.counterparty_name, new.counterparty_dic, new.counterparty_email,
      coalesce(new.created_by, new.updated_by), coalesce(new.updated_by, new.created_by)
    )
    on conflict (organization_id, ico) do update
    set name = excluded.name,
        dic = excluded.dic,
        email = excluded.email,
        updated_by = excluded.updated_by,
        updated_at = now()
    returning id into matched_customer_id;
    new.customer_id := matched_customer_id;
  else
    new.customer_id := null;
  end if;

  return new;
end;
$$;

revoke all on function remember_customer_from_invoice() from public, anon, authenticated;
grant execute on function remember_customer_from_invoice() to service_role;

create trigger remember_customer_from_invoice_trigger
before insert or update on invoices
for each row execute function remember_customer_from_invoice();

-- One-time backfill: touch existing rows so the new BEFORE trigger runs
-- against them and populates customer_id from their existing IČO.
update invoices set counterparty_name = counterparty_name
where customer_id is null and counterparty_ico ~ '^[0-9]{8}$';
