-- Additive follow-up to v4. Never infer historical OCR totals or rewrite balances.
alter table public.invoice_uploads add column ocr_money_snapshot jsonb;

create or replace function public.validate_invoice_money_evidence()
returns trigger language plpgsql set search_path=public as $$
declare difference numeric; initial_paid numeric; snapshot jsonb;
begin
  if tg_op='UPDATE' then
    if coalesce((new.money_evidence->>'initial_paid')::numeric,0)
       <>coalesce((old.money_evidence->>'initial_paid')::numeric,0) then
      raise exception 'initial_payment_requires_ledger_correction';
    end if;
    if old.money_evidence is not null and (
       new.money_evidence is null or new.money_evidence->'original_total' is distinct from old.money_evidence->'original_total') then
      raise exception 'original_amount_is_immutable';
    end if;
    if new.amount=old.amount and new.amount_without_vat=old.amount_without_vat
       and new.vat_rate=old.vat_rate and new.money_evidence is not distinct from old.money_evidence then return new; end if;
    if new.amount<>old.amount and new.money_evidence is not null then
      new.money_evidence:=jsonb_set(new.money_evidence,'{total_source}','"manual"');
    end if;
  elsif new.file_url is not null then
    -- The saved OCR result, not a browser-supplied original_total, is the evidence.
    select ocr_money_snapshot into snapshot from public.invoice_uploads
      where organization_id=new.organization_id and path=new.file_url;
    if snapshot is not null then
      new.money_evidence:=coalesce(new.money_evidence,snapshot)||jsonb_build_object(
        'original_total',snapshot->'original_total',
        'total_source',case when new.amount=(snapshot->>'original_total')::numeric
          then snapshot->>'total_source' else 'manual' end);
    end if;
  end if;
  difference:=new.amount-round(new.amount_without_vat*(100+new.vat_rate)/100,2);
  if difference<>0 and (new.money_evidence is null
    or coalesce((new.money_evidence->>'adjustment_confirmed')::boolean,false)=false
    or nullif(trim(new.money_evidence->>'adjustment_reason'),'') is null) then
    raise exception 'unconfirmed_amount_adjustment';
  end if;
  if new.money_evidence is not null then
    if jsonb_typeof(new.money_evidence)<>'object'
       or not (new.money_evidence ?& array['original_total','total_source','initial_paid']) then
      raise exception 'invalid_money_evidence';
    end if;
    new.money_evidence:=jsonb_set(new.money_evidence,'{adjustment}',to_jsonb(difference));
    initial_paid:=round((new.money_evidence->>'initial_paid')::numeric,2);
    new.money_evidence:=jsonb_set(new.money_evidence,'{initial_paid}',to_jsonb(initial_paid));
    if initial_paid>0 and not coalesce((new.money_evidence->>'initial_paid_confirmed')::boolean,false) then
      raise exception 'unconfirmed_initial_payment';
    end if;
  end if;
  return new;
end $$;

create or replace function public.record_initial_invoice_payment()
returns trigger language plpgsql security definer set search_path=public as $$
declare initial_paid numeric; payment_id uuid;
begin
  initial_paid:=coalesce((new.money_evidence->>'initial_paid')::numeric,0);
  if initial_paid=0 then return new; end if;
  insert into public.bank_payments(organization_id,invoice_id,external_id,booked_on,amount,currency,
    variable_symbol,counterparty_name,note,match_status,source,imported_by,matched_at)
  values(new.organization_id,new.id,'initial-'||new.id,(now() at time zone 'Europe/Prague')::date,initial_paid,new.currency,
    new.variable_symbol,new.counterparty_name,'Uživatelem potvrzený počáteční stav úhrad při importu; datum zápisu není datem původní platby.',
    'matched','manual',new.created_by,now()) returning id into payment_id;
  insert into public.bank_payment_allocations(organization_id,bank_payment_id,invoice_id,amount,is_committed,created_by,committed_at)
    values(new.organization_id,payment_id,new.id,initial_paid,true,new.created_by,now());
  update public.invoices set paid_amount=initial_paid,
    status=case when initial_paid=amount then 'paid' when due_date<(now() at time zone 'Europe/Prague')::date then 'overdue' else 'pending' end,
    paid_at=case when initial_paid=amount then now() else null end,
    next_reminder_at=case when initial_paid=amount then null else next_reminder_at end where id=new.id;
  return new;
end $$;

-- Amount corrections remain inspectable even after subsequent corrections.
create table public.invoice_money_events (
  id bigint generated always as identity primary key,
  organization_id uuid not null references public.organizations(id),
  invoice_id uuid not null,
  actor_user uuid,
  before_value jsonb not null,
  after_value jsonb not null,
  recorded_at timestamptz not null default now()
);
alter table public.invoice_money_events enable row level security;
revoke all on public.invoice_money_events from public,anon,authenticated;
grant select,insert on public.invoice_money_events to service_role;
grant usage on sequence public.invoice_money_events_id_seq to service_role;
create index on public.invoice_money_events(organization_id,invoice_id,recorded_at);
create function public.audit_invoice_money_change() returns trigger
language plpgsql security definer set search_path=public as $$
begin
  if row(new.amount,new.amount_without_vat,new.vat_rate,new.money_evidence)
     is distinct from row(old.amount,old.amount_without_vat,old.vat_rate,old.money_evidence) then
    insert into public.invoice_money_events(organization_id,invoice_id,actor_user,before_value,after_value)
    values(new.organization_id,new.id,new.updated_by,
      jsonb_build_object('amount',old.amount,'net',old.amount_without_vat,'vat_rate',old.vat_rate,'evidence',old.money_evidence),
      jsonb_build_object('amount',new.amount,'net',new.amount_without_vat,'vat_rate',new.vat_rate,'evidence',new.money_evidence));
  end if;
  return new;
end $$;
revoke all on function public.audit_invoice_money_change() from public,anon,authenticated;
create trigger invoice_money_audit after update on public.invoices
for each row execute function public.audit_invoice_money_change();

-- Recheck the CURRENT candidate set inside the booking transaction. The v4
-- reconciler catches proposal_changed per entry; unrelated entries still commit.
create function private.guard_automatic_payment() returns trigger
language plpgsql security definer set search_path=public as $$
declare selected_invoice public.invoices%rowtype; candidate record; best integer:=99;
  winners uuid[]:='{}'; rank integer; account_icos text[]; symbol text; targets uuid[];
begin
  if new.match_reason is null then return new; end if; -- explicit human decisions
  -- A split payment (one payment across several invoices) has no single
  -- invoice_id to re-check here -- it books with invoice_id null and its own
  -- combination path (name_combination_auto_match.sql) already re-validates
  -- every candidate invoice inline, in the same transaction, before this row
  -- is even inserted. Written before that path existed, this guard assumed
  -- every automatic bank_payments row named exactly one invoice; left as-is
  -- it would raise proposal_changed on every automatic split payment ever
  -- since NULL never matches an id.
  if new.invoice_id is null then return new; end if;
  select * into selected_invoice from public.invoices
    where id=new.invoice_id and organization_id=new.organization_id for update;
  if not found then raise exception 'proposal_changed'; end if;
  select array_agg(distinct counterparty_ico) into account_icos from public.counterparty_payment_accounts
    where organization_id=new.organization_id and account_number=new.counterparty_account;
  if cardinality(account_icos)>0 and not coalesce(selected_invoice.counterparty_ico=any(account_icos),false) then
    raise exception 'proposal_changed';
  end if;
  symbol:=nullif(ltrim(regexp_replace(coalesce(new.variable_symbol,''),'\s','','g'),'0'),'');
  -- A known explicit reference must not be replaced by a coincidental amount.
  select array_agg(id) into targets from public.invoices i
  where i.organization_id=new.organization_id and i.currency=new.currency and i.status<>'cancelled'
    and (nullif(ltrim(regexp_replace(coalesce(nullif(trim(i.variable_symbol),''),
        case when trim(i.invoice_number) ~ '^[0-9]+$' then trim(i.invoice_number) end,''),'\s','','g'),'0'),'')=symbol
      or (trim(i.invoice_number) ~ '^[0-9A-Za-z]{4,}$' and coalesce(new.note,'') ~*
        ('(^|[^0-9A-Za-z])'||trim(i.invoice_number)||'([^0-9A-Za-z]|$)')));
  if cardinality(targets)>0 and (cardinality(targets)<>1 or targets[1]<>new.invoice_id) then
    raise exception 'proposal_changed';
  end if;
  for candidate in select * from public.invoices i
    where i.organization_id=new.organization_id and i.currency=new.currency
      and i.status in ('pending','overdue') and i.amount-i.paid_amount=new.amount
    order by id for update
  loop
    rank:=99;
    if nullif(ltrim(regexp_replace(coalesce(nullif(trim(candidate.variable_symbol),''),
        case when trim(candidate.invoice_number) ~ '^[0-9]+$' then trim(candidate.invoice_number) end,''),'\s','','g'),'0'),'')=symbol then rank:=1;
    elsif trim(candidate.invoice_number) ~ '^[0-9A-Za-z]{4,}$' and coalesce(new.note,'') ~*
      ('(^|[^0-9A-Za-z])'||trim(candidate.invoice_number)||'([^0-9A-Za-z]|$)') then rank:=2;
    elsif new.booked_on>=candidate.issue_date then
      if cardinality(account_icos)=1 and candidate.counterparty_ico=account_icos[1] then rank:=3;
      elsif private.names_match(new.counterparty_name,candidate.counterparty_name) then rank:=4;
      end if;
    end if;
    if rank<best then best:=rank; winners:=array[candidate.id];
    elsif rank=best then winners:=array_append(winners,candidate.id); end if;
  end loop;
  if best=99 or cardinality(winners)<>1 or winners[1]<>new.invoice_id then raise exception 'proposal_changed'; end if;
  return new;
end $$;
revoke all on function private.guard_automatic_payment() from public,anon,authenticated;
create trigger guard_automatic_payment before insert on public.bank_payments
for each row execute function private.guard_automatic_payment();
