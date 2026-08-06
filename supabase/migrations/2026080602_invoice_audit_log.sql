-- Nezávislá, databázově vynucená historie změn faktur.
alter table invoices
  add column if not exists updated_by uuid references auth.users(id) on delete set null;

create table if not exists invoice_events (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  invoice_id uuid not null references invoices(id) on delete cascade,
  actor_user_id uuid references auth.users(id) on delete set null,
  event_type text not null check (event_type in (
    'created', 'updated', 'paid', 'reopened', 'cancelled', 'overdue',
    'reminders_paused', 'reminders_resumed'
  )),
  details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists invoice_events_invoice on invoice_events (invoice_id, created_at desc);

create or replace function audit_invoice_change()
returns trigger language plpgsql security definer set search_path = public
as $$
declare
  fields text[];
  status_event text;
begin
  if tg_op = 'INSERT' then
    insert into invoice_events (organization_id, invoice_id, actor_user_id, event_type)
    values (new.organization_id, new.id, new.created_by, 'created');
    return new;
  end if;

  if new.status is distinct from old.status then
    status_event := case
      when new.status = 'paid' then 'paid'
      when old.status = 'paid' and new.status in ('pending', 'overdue') then 'reopened'
      when new.status = 'cancelled' then 'cancelled'
      when new.status = 'overdue' then 'overdue'
      else 'updated'
    end;
    insert into invoice_events (organization_id, invoice_id, actor_user_id, event_type, details)
    values (
      new.organization_id, new.id,
      case when status_event = 'overdue' then null else new.updated_by end,
      status_event,
      jsonb_build_object('from', old.status, 'to', new.status, 'paid_at', new.paid_at)
    );
  elsif new.paid_at is distinct from old.paid_at and new.status = 'paid' then
    insert into invoice_events (organization_id, invoice_id, actor_user_id, event_type, details)
    values (new.organization_id, new.id, new.updated_by, 'paid', jsonb_build_object('paid_at', new.paid_at, 'corrected', true));
  end if;

  if new.reminders_paused is distinct from old.reminders_paused then
    insert into invoice_events (organization_id, invoice_id, actor_user_id, event_type)
    values (
      new.organization_id, new.id, coalesce(new.reminders_paused_by, new.updated_by),
      case when new.reminders_paused then 'reminders_paused' else 'reminders_resumed' end
    );
  end if;

  fields := array_remove(array[
    case when new.invoice_number is distinct from old.invoice_number then 'invoice_number' end,
    case when new.counterparty_name is distinct from old.counterparty_name then 'counterparty_name' end,
    case when new.counterparty_ico is distinct from old.counterparty_ico then 'counterparty_ico' end,
    case when new.counterparty_dic is distinct from old.counterparty_dic then 'counterparty_dic' end,
    case when new.counterparty_email is distinct from old.counterparty_email then 'counterparty_email' end,
    case when new.variable_symbol is distinct from old.variable_symbol then 'variable_symbol' end,
    case when new.amount is distinct from old.amount then 'amount' end,
    case when new.currency is distinct from old.currency then 'currency' end,
    case when new.issue_date is distinct from old.issue_date then 'issue_date' end,
    case when new.due_date is distinct from old.due_date then 'due_date' end,
    case when new.notes is distinct from old.notes then 'notes' end
  ]::text[], null);
  if cardinality(fields) > 0 then
    insert into invoice_events (organization_id, invoice_id, actor_user_id, event_type, details)
    values (new.organization_id, new.id, new.updated_by, 'updated', jsonb_build_object('fields', fields));
  end if;
  return new;
end;
$$;

drop trigger if exists invoices_audit_change on invoices;
create trigger invoices_audit_change
after insert or update on invoices
for each row execute function audit_invoice_change();

revoke all on function audit_invoice_change() from public, anon, authenticated;
alter table invoice_events enable row level security;
revoke insert, update, delete on invoice_events from anon, authenticated;

drop policy if exists "members can view invoice events" on invoice_events;
create policy "members can view invoice events" on invoice_events for select
  using (is_org_member(organization_id));
