-- Fáze F1b přestavby databáze (expand): jedna neměnná auditní kniha.
--
-- Stávajících 7 tabulek událostí zůstává beze změny a dál je plní stejné
-- funkce; každý nový řádek se triggerem zrcadlí sem a dosavadní řádky se
-- převedou jednorázově. Kniha nemá cizí klíč na fakturu ani firmu, takže
-- přežije smazání faktury. Původní tabulky se nahradí pohledy až po bráně
-- (contract), samostatnou migrací.
--
-- Zároveň: smazat jde jen fakturu bez peněz a bez odeslané zprávy. Faktura
-- s přiřazenou platbou, odeslanou upomínkou nebo odeslaná e-mailem se
-- stornuje (rozhodnutí uživatele 9. 11. 2026).

create table public.audit_events (
  id bigint generated always as identity primary key,
  organization_id uuid,
  entity_type text not null check (entity_type in ('invoice', 'payment_allocation', 'payment_assistance', 'member', 'reminder_settings', 'organization', 'billing_order')),
  entity_id uuid,
  action text not null check (length(action) between 1 and 80),
  actor_user_id uuid,
  actor_kind text not null check (actor_kind in ('user', 'system', 'operator')),
  before jsonb,
  after jsonb,
  details jsonb not null default '{}'::jsonb,
  recorded_at timestamptz not null default now(),
  source_table text not null,
  source_id text not null,
  unique (source_table, source_id)
);
create index audit_events_entity on public.audit_events (organization_id, entity_type, entity_id, recorded_at desc);
create index audit_events_recorded on public.audit_events (organization_id, recorded_at desc);
alter table public.audit_events enable row level security;
revoke all on public.audit_events from public, anon, authenticated;
grant select, insert on public.audit_events to service_role;

create or replace function private.audit_events_immutable() returns trigger
language plpgsql set search_path = '' as $$
begin
  raise exception 'audit_events_immutable';
end $$;
revoke all on function private.audit_events_immutable() from public, anon, authenticated;
create trigger audit_events_no_update before update or delete on public.audit_events
  for each row execute function private.audit_events_immutable();
create trigger audit_events_no_truncate before truncate on public.audit_events
  for each statement execute function private.audit_events_immutable();

-- Převod řádku ze staré tabulky do tvaru knihy. Jedno místo pro trigger i
-- jednorázový převod; opakované volání pro týž řádek nic nezdvojí.
create or replace function private.record_legacy_audit(source text, r jsonb) returns void
language plpgsql security definer set search_path = '' as $$
declare
  actor uuid;
begin
  if source = 'invoice_events' then
    actor := (r->>'actor_user_id')::uuid;
    insert into public.audit_events (organization_id, entity_type, entity_id, action, actor_user_id, actor_kind, details, recorded_at, source_table, source_id)
    values ((r->>'organization_id')::uuid, 'invoice', (r->>'invoice_id')::uuid, r->>'event_type', actor,
      case when actor is null then 'system' else 'user' end, coalesce(r->'details', '{}'::jsonb), (r->>'created_at')::timestamptz, source, r->>'id')
    on conflict (source_table, source_id) do nothing;
  elsif source = 'invoice_money_events' then
    actor := (r->>'actor_user')::uuid;
    insert into public.audit_events (organization_id, entity_type, entity_id, action, actor_user_id, actor_kind, before, after, recorded_at, source_table, source_id)
    values ((r->>'organization_id')::uuid, 'invoice', (r->>'invoice_id')::uuid, 'money_changed', actor,
      case when actor is null then 'system' else 'user' end, r->'before_value', r->'after_value', (r->>'recorded_at')::timestamptz, source, r->>'id')
    on conflict (source_table, source_id) do nothing;
  elsif source = 'payment_allocation_events' then
    insert into public.audit_events (organization_id, entity_type, entity_id, action, actor_kind, after, recorded_at, source_table, source_id)
    values ((r->>'organization_id')::uuid, 'payment_allocation', (r->>'allocation_id')::uuid, r->>'operation', 'system',
      r->'snapshot', (r->>'recorded_at')::timestamptz, source, r->>'id')
    on conflict (source_table, source_id) do nothing;
  elsif source = 'payment_assistance_events' then
    actor := (r->>'actor_user')::uuid;
    insert into public.audit_events (organization_id, entity_type, entity_id, action, actor_user_id, actor_kind, after, recorded_at, source_table, source_id)
    values ((r->>'organization_id')::uuid, 'payment_assistance', (r->>'entity_id')::uuid, r->>'event_type', actor,
      case when actor is null then 'system' else 'user' end, r->'snapshot', (r->>'recorded_at')::timestamptz, source, r->>'id')
    on conflict (source_table, source_id) do nothing;
  elsif source = 'organization_member_events' then
    actor := (r->>'actor_user_id')::uuid;
    insert into public.audit_events (organization_id, entity_type, entity_id, action, actor_user_id, actor_kind, before, after, details, recorded_at, source_table, source_id)
    values ((r->>'organization_id')::uuid, 'member', (r->>'target_member_id')::uuid, r->>'event_type', actor,
      case when actor is null then 'system' else 'user' end,
      case when r->>'previous_role' is null then null else jsonb_build_object('role', r->>'previous_role') end,
      case when r->>'new_role' is null then null else jsonb_build_object('role', r->>'new_role') end,
      jsonb_build_object('actor_email', r->>'actor_email', 'target_email', r->>'target_email'),
      (r->>'created_at')::timestamptz, source, r->>'id')
    on conflict (source_table, source_id) do nothing;
  elsif source = 'reminder_settings_events' then
    actor := (r->>'actor_user_id')::uuid;
    insert into public.audit_events (organization_id, entity_type, entity_id, action, actor_user_id, actor_kind, after, details, recorded_at, source_table, source_id)
    values ((r->>'organization_id')::uuid, 'reminder_settings', (r->>'organization_id')::uuid, 'updated', actor,
      case when actor is null then 'system' else 'user' end,
      jsonb_build_object('is_active', r->'is_active', 'days_from_due', r->'days_from_due', 'template_data', r->'template_data'),
      jsonb_build_object('actor_email', r->>'actor_email'), (r->>'created_at')::timestamptz, source, r->>'id')
    on conflict (source_table, source_id) do nothing;
  elsif source = 'operator_actions' then
    insert into public.audit_events (organization_id, entity_type, entity_id, action, actor_kind, details, recorded_at, source_table, source_id)
    values ((r->>'organization_id')::uuid,
      case when r->>'order_id' is null then 'organization' else 'billing_order' end,
      coalesce((r->>'order_id')::uuid, (r->>'organization_id')::uuid), r->>'action', 'operator',
      jsonb_build_object('operator_email', r->>'operator_email', 'note', r->>'note'), (r->>'created_at')::timestamptz, source, r->>'id')
    on conflict (source_table, source_id) do nothing;
  else
    raise exception 'unknown audit source %', source;
  end if;
end $$;
revoke all on function private.record_legacy_audit(text, jsonb) from public, anon, authenticated;

create or replace function private.mirror_audit_event() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  perform private.record_legacy_audit(tg_table_name, to_jsonb(new));
  return null;
end $$;
revoke all on function private.mirror_audit_event() from public, anon, authenticated;

do $$
declare t text;
begin
  foreach t in array array['invoice_events', 'invoice_money_events', 'payment_allocation_events', 'payment_assistance_events',
    'organization_member_events', 'reminder_settings_events', 'operator_actions'] loop
    execute format('create trigger %I after insert on public.%I for each row execute function private.mirror_audit_event()', t || '_to_audit', t);
    execute format('select count(private.record_legacy_audit(%L, to_jsonb(s))) from public.%I s', t, t);
  end loop;
end $$;

-- Smazat jde jen fakturu bez peněz a bez odeslané zprávy; ostatní se stornují.
-- Dřívější verze (20260916000000) platby od faktury tiše odpojila a smazala ji.
create or replace function public.delete_invoice_safely(target_org uuid, target_invoice uuid, actor_user uuid)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  selected_invoice invoices%rowtype;
begin
  if not exists (
    select 1 from organization_members
    where organization_id = target_org
      and user_id = actor_user
      and role in ('accounting', 'admin')
  ) then
    raise exception 'insufficient_permission';
  end if;

  select * into selected_invoice
  from invoices
  where id = target_invoice and organization_id = target_org
  for update;

  if selected_invoice.id is null then
    raise exception 'invoice_not_found';
  end if;

  if selected_invoice.paid_amount > 0
    or exists (select 1 from bank_payments where organization_id = target_org and invoice_id = target_invoice)
    or exists (select 1 from bank_payment_allocations where organization_id = target_org and invoice_id = target_invoice and is_committed) then
    raise exception 'invoice_has_payments';
  end if;
  if exists (select 1 from reminder_log where organization_id = target_org and invoice_id = target_invoice and status = 'sent') then
    raise exception 'invoice_reminder_sent';
  end if;
  if exists (select 1 from invoice_email_deliveries where organization_id = target_org and invoice_id = target_invoice and status in ('accepted', 'sending')) then
    raise exception 'invoice_email_sent';
  end if;

  -- Nepotvrzené návrhy přiřazení nejsou peníze; s fakturou zmizí.
  delete from bank_payment_allocations
  where organization_id = target_org and invoice_id = target_invoice and not is_committed;

  insert into audit_events (organization_id, entity_type, entity_id, action, actor_user_id, actor_kind, before, source_table, source_id)
  values (target_org, 'invoice', target_invoice, 'deleted', actor_user, 'user', to_jsonb(selected_invoice), 'delete_invoice_safely', target_invoice::text);

  delete from invoices
  where id = target_invoice and organization_id = target_org;

  return jsonb_build_object(
    'invoice_id', target_invoice,
    'file_url', selected_invoice.file_url,
    'detached_payments', 0
  );
end;
$function$;
