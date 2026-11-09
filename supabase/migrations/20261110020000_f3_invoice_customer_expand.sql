-- Fáze F3 přestavby databáze (expand): faktura jako doklad, procesy vedle ní,
-- odběratel jako jediný zdroj pravdy.
--
-- Nic se nepřesouvá ani nemaže. Nové tabulky se naplní ze stávajících sloupců
-- a triggerem s nimi drží krok, dokud se na ně aplikace nepřepne; pak je
-- plánovač upomínek začne psát přímo a staré sloupce odstraní contract krok.
-- Odběratel se k IČO přiřadí jen při jednoznačné shodě v rámci firmy; nikdy
-- se nezakládá ani neslučuje automaticky.

-- 1. Stav upomínek, 1:1 k faktuře.
create table public.invoice_reminder_state (
  invoice_id uuid primary key references public.invoices(id) on delete cascade,
  organization_id uuid not null references public.organizations(id) on delete cascade,
  reminders_sent integer not null default 0 check (reminders_sent >= 0),
  last_reminder_at timestamptz,
  next_reminder_at timestamptz,
  paused boolean not null default false,
  paused_at timestamptz,
  paused_by uuid references auth.users(id) on delete set null,
  reminder_days_snapshot integer[],
  plan_effective_from date,
  updated_at timestamptz not null default now()
);
create index invoice_reminder_state_due on public.invoice_reminder_state (organization_id, next_reminder_at) where not paused;
create index invoice_reminder_state_paused_by on public.invoice_reminder_state (paused_by);
alter table public.invoice_reminder_state enable row level security;
revoke all on public.invoice_reminder_state from public, anon, authenticated;
grant select, insert, update, delete on public.invoice_reminder_state to service_role;

-- 2. Dokument faktury s verzemi.
create table public.invoice_documents (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  invoice_id uuid not null references public.invoices(id) on delete cascade,
  storage_path text,
  money_evidence jsonb,
  source text not null,
  is_current boolean not null default true,
  created_at timestamptz not null default now(),
  check (storage_path is not null or money_evidence is not null)
);
create unique index invoice_documents_one_current on public.invoice_documents (invoice_id) where is_current;
create index invoice_documents_org on public.invoice_documents (organization_id, invoice_id, created_at desc);
alter table public.invoice_documents enable row level security;
revoke all on public.invoice_documents from public, anon, authenticated;
grant select, insert, update, delete on public.invoice_documents to service_role;

create or replace function private.mirror_invoice_processes() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  insert into public.invoice_reminder_state as s (invoice_id, organization_id, reminders_sent, last_reminder_at, next_reminder_at,
    paused, paused_at, paused_by, reminder_days_snapshot, plan_effective_from, updated_at)
  values (new.id, new.organization_id, new.reminders_sent, new.last_reminder_at, new.next_reminder_at,
    new.reminders_paused, new.reminders_paused_at, new.reminders_paused_by, new.reminder_days_snapshot, new.reminder_plan_effective_from, now())
  on conflict (invoice_id) do update set
    reminders_sent = excluded.reminders_sent, last_reminder_at = excluded.last_reminder_at, next_reminder_at = excluded.next_reminder_at,
    paused = excluded.paused, paused_at = excluded.paused_at, paused_by = excluded.paused_by,
    reminder_days_snapshot = excluded.reminder_days_snapshot, plan_effective_from = excluded.plan_effective_from, updated_at = now()
  where (s.reminders_sent, s.last_reminder_at, s.next_reminder_at, s.paused, s.paused_at, s.paused_by, s.reminder_days_snapshot, s.plan_effective_from)
    is distinct from (excluded.reminders_sent, excluded.last_reminder_at, excluded.next_reminder_at, excluded.paused, excluded.paused_at,
      excluded.paused_by, excluded.reminder_days_snapshot, excluded.plan_effective_from);

  if (new.file_url is not null or new.money_evidence is not null)
    and (tg_op = 'INSERT' or new.file_url is distinct from old.file_url or new.money_evidence is distinct from old.money_evidence) then
    update public.invoice_documents set is_current = false where invoice_id = new.id and is_current;
    insert into public.invoice_documents (organization_id, invoice_id, storage_path, money_evidence, source)
    values (new.organization_id, new.id, new.file_url, new.money_evidence, new.source);
  elsif tg_op = 'UPDATE' and new.file_url is null and new.money_evidence is null and (old.file_url is not null or old.money_evidence is not null) then
    update public.invoice_documents set is_current = false where invoice_id = new.id and is_current;
  end if;
  return null;
end $$;
revoke all on function private.mirror_invoice_processes() from public, anon, authenticated;

create trigger invoices_mirror_processes
  after insert or update of reminders_sent, last_reminder_at, next_reminder_at, reminders_paused, reminders_paused_at,
    reminders_paused_by, reminder_days_snapshot, reminder_plan_effective_from, file_url, money_evidence
  on public.invoices for each row execute function private.mirror_invoice_processes();

insert into public.invoice_reminder_state (invoice_id, organization_id, reminders_sent, last_reminder_at, next_reminder_at,
  paused, paused_at, paused_by, reminder_days_snapshot, plan_effective_from)
select id, organization_id, reminders_sent, last_reminder_at, next_reminder_at, reminders_paused, reminders_paused_at,
  reminders_paused_by, reminder_days_snapshot, reminder_plan_effective_from
from public.invoices
on conflict (invoice_id) do nothing;

insert into public.invoice_documents (organization_id, invoice_id, storage_path, money_evidence, source, created_at)
select organization_id, id, file_url, money_evidence, source, created_at
from public.invoices i
where (file_url is not null or money_evidence is not null)
  and not exists (select 1 from public.invoice_documents d where d.invoice_id = i.id);

-- 3. Odběratel: customer_id vedle IČO.
alter table public.counterparty_payment_accounts add column customer_id uuid references public.customers(id) on delete set null;
alter table public.counterparty_reminder_preferences add column customer_id uuid references public.customers(id) on delete set null;
alter table public.payment_payer_memory add column customer_id uuid references public.customers(id) on delete set null;
create index counterparty_payment_accounts_customer on public.counterparty_payment_accounts (customer_id);
create index counterparty_reminder_preferences_customer on public.counterparty_reminder_preferences (customer_id);
create index payment_payer_memory_customer on public.payment_payer_memory (customer_id);

-- Jen jednoznačná shoda: právě jeden odběratel s tím IČO v té firmě.
create or replace function private.customer_for_ico(org uuid, ico_value text) returns uuid
language sql stable security definer set search_path = '' as $$
  select case when count(*) = 1 then min(c.id::text)::uuid end
  from public.customers c
  where c.organization_id = org and c.ico = nullif(btrim(ico_value), '');
$$;
revoke all on function private.customer_for_ico(uuid, text) from public, anon, authenticated;

create or replace function private.link_counterparty_customer() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'INSERT' or new.counterparty_ico is distinct from old.counterparty_ico then
    new.customer_id := private.customer_for_ico(new.organization_id, new.counterparty_ico);
  end if;
  return new;
end $$;
revoke all on function private.link_counterparty_customer() from public, anon, authenticated;

create trigger counterparty_payment_accounts_customer before insert or update of counterparty_ico on public.counterparty_payment_accounts
  for each row execute function private.link_counterparty_customer();
create trigger counterparty_reminder_preferences_customer before insert or update of counterparty_ico on public.counterparty_reminder_preferences
  for each row execute function private.link_counterparty_customer();
create trigger payment_payer_memory_customer before insert or update of counterparty_ico on public.payment_payer_memory
  for each row execute function private.link_counterparty_customer();

update public.counterparty_payment_accounts set customer_id = private.customer_for_ico(organization_id, counterparty_ico);
update public.counterparty_reminder_preferences set customer_id = private.customer_for_ico(organization_id, counterparty_ico);
update public.payment_payer_memory set customer_id = private.customer_for_ico(organization_id, counterparty_ico);

-- 4. Pohledy ve tvaru, do kterého se aplikace přepne.
create view public.ocr_jobs with (security_invoker = true) as
select u.id as upload_id, u.organization_id, u.invoice_id, u.ocr_status as status, u.ocr_attempt_count as attempts,
       u.ocr_started_at as started_at, u.ocr_completed_at as completed_at, u.ocr_error as last_error, u.ocr_model as model,
       u.ocr_provider_response_id as provider_response_id, u.ocr_vocabulary_version as vocabulary_version, u.created_at
from public.invoice_uploads u;

create view public.invoice_list_v with (security_invoker = true) as
select i.id, i.organization_id, i.invoice_number, i.status, i.source, i.currency, i.amount, i.amount_without_vat, i.vat_rate,
       i.issue_date, i.due_date, i.variable_symbol,
       i.customer_id, coalesce(c.name, i.counterparty_name) as customer_name, i.counterparty_name, i.counterparty_ico, i.counterparty_email,
       b.allocated as paid_amount, b.remaining, b.payment_state, i.paid_at,
       s.reminders_sent, s.last_reminder_at, s.next_reminder_at, s.paused as reminders_paused,
       d.storage_path as document_path,
       i.created_at, i.updated_at
from public.invoices i
join public.invoice_balances b on b.invoice_id = i.id
left join public.invoice_reminder_state s on s.invoice_id = i.id
left join public.customers c on c.id = i.customer_id
left join public.invoice_documents d on d.invoice_id = i.id and d.is_current;

revoke all on public.ocr_jobs, public.invoice_list_v from public, anon, authenticated;
grant select on public.ocr_jobs, public.invoice_list_v to service_role;
