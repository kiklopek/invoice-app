create table public.counterparty_reminder_preferences (
  organization_id uuid not null references public.organizations(id) on delete cascade,
  counterparty_ico text not null check (counterparty_ico ~ '^[0-9]{8}$'),
  reminder_policy_id uuid not null,
  last_invoice_id uuid,
  updated_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (organization_id, counterparty_ico),
  constraint counterparty_reminder_preferences_policy_same_org_fkey
    foreign key (organization_id, reminder_policy_id)
    references public.reminder_policies (organization_id, id),
  constraint counterparty_reminder_preferences_invoice_same_org_fkey
    foreign key (organization_id, last_invoice_id)
    references public.invoices (organization_id, id) on delete set null (last_invoice_id)
);

create index counterparty_reminder_preferences_policy_idx
  on public.counterparty_reminder_preferences (organization_id, reminder_policy_id);

alter table public.counterparty_reminder_preferences enable row level security;
revoke all on table public.counterparty_reminder_preferences from public, anon, authenticated;
grant select, insert, update, delete on table public.counterparty_reminder_preferences to service_role;

comment on table public.counterparty_reminder_preferences is
  'Internal per-organization OCR reminder policy preference keyed by normalized Czech ICO.';

create or replace function public.remember_ocr_reminder_policy()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
declare
  normalized_ico text := regexp_replace(coalesce(new.counterparty_ico, ''), '[^0-9]', '', 'g');
  previous_ico text;
begin
  if tg_op = 'UPDATE' then
    previous_ico := regexp_replace(coalesce(old.counterparty_ico, ''), '[^0-9]', '', 'g');
    if previous_ico ~ '^[0-9]{8}$' and previous_ico is distinct from normalized_ico then
      delete from public.counterparty_reminder_preferences
      where organization_id = old.organization_id
        and counterparty_ico = previous_ico
        and last_invoice_id = old.id;
    end if;
  end if;

  if new.source = 'ocr'
    and normalized_ico ~ '^[0-9]{8}$'
    and new.reminder_policy_id is not null then
    insert into public.counterparty_reminder_preferences (
      organization_id,
      counterparty_ico,
      reminder_policy_id,
      last_invoice_id,
      updated_by
    ) values (
      new.organization_id,
      normalized_ico,
      new.reminder_policy_id,
      new.id,
      coalesce(new.updated_by, new.created_by)
    )
    on conflict (organization_id, counterparty_ico) do update
    set reminder_policy_id = excluded.reminder_policy_id,
        last_invoice_id = excluded.last_invoice_id,
        updated_by = excluded.updated_by,
        updated_at = now();
  end if;

  return new;
end;
$$;

revoke all on function public.remember_ocr_reminder_policy() from public, anon, authenticated;
grant execute on function public.remember_ocr_reminder_policy() to service_role;

create trigger remember_ocr_invoice_reminder_policy
after insert or update of reminder_policy_id, counterparty_ico on public.invoices
for each row execute function public.remember_ocr_reminder_policy();
