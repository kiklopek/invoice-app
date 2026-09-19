-- Additive rollout. Historical amounts are never recomputed by this migration.
alter table public.invoices add column money_evidence jsonb;
alter table public.invoices drop constraint if exists invoices_vat_amounts_consistent;
alter table public.invoices add constraint invoices_money_evidence_valid check (
  money_evidence is null or (
    jsonb_typeof(money_evidence) = 'object'
    and (money_evidence->>'original_total')::numeric >= 0
    and (money_evidence->>'initial_paid')::numeric between 0 and amount
    and (money_evidence->>'total_source') in ('read','derived','manual')
  )
);

create or replace function public.validate_invoice_money_evidence()
returns trigger language plpgsql set search_path=public as $$
declare difference numeric; initial_paid numeric;
begin
  -- Only enforce new money rules on new/changed amounts, not unrelated edits to legacy data.
  if tg_op='UPDATE' and new.amount=old.amount and new.amount_without_vat=old.amount_without_vat
     and new.vat_rate=old.vat_rate and new.money_evidence is not distinct from old.money_evidence then return new; end if;
  difference := new.amount-round(new.amount_without_vat*(100+new.vat_rate)/100,2);
  if difference<>0 and (new.money_evidence is null
    or coalesce((new.money_evidence->>'adjustment_confirmed')::boolean,false)=false
    or nullif(trim(new.money_evidence->>'adjustment_reason'),'') is null) then
    raise exception 'unconfirmed_amount_adjustment';
  end if;
  if new.money_evidence is not null then
    new.money_evidence := jsonb_set(new.money_evidence,'{adjustment}',to_jsonb(difference));
    initial_paid := coalesce((new.money_evidence->>'initial_paid')::numeric,0);
    if initial_paid>0 and not coalesce((new.money_evidence->>'initial_paid_confirmed')::boolean,false) then
      raise exception 'unconfirmed_initial_payment';
    end if;
    if tg_op='UPDATE' and initial_paid<>coalesce((old.money_evidence->>'initial_paid')::numeric,0) then
      raise exception 'initial_payment_requires_ledger_correction';
    end if;
  end if;
  return new;
end $$;
create trigger invoices_validate_money before insert or update on public.invoices
for each row execute function public.validate_invoice_money_evidence();
revoke all on function public.validate_invoice_money_evidence() from public,anon,authenticated;

create or replace function public.record_initial_invoice_payment()
returns trigger language plpgsql security definer set search_path=public as $$
declare initial_paid numeric; payment_id uuid;
begin
  initial_paid := coalesce((new.money_evidence->>'initial_paid')::numeric,0);
  if initial_paid=0 then return new; end if;
  insert into public.bank_payments(organization_id,invoice_id,external_id,booked_on,amount,currency,
    variable_symbol,counterparty_name,note,match_status,source,imported_by,matched_at)
  values(new.organization_id,new.id,'initial-'||new.id,current_date,initial_paid,new.currency,
    new.variable_symbol,new.counterparty_name,'Uživatelem potvrzený počáteční stav úhrad při importu; datum zápisu není datem původní platby.',
    'matched','manual',new.created_by,now()) returning id into payment_id;
  insert into public.bank_payment_allocations(organization_id,bank_payment_id,invoice_id,amount,is_committed,created_by,committed_at)
    values(new.organization_id,payment_id,new.id,initial_paid,true,new.created_by,now());
  update public.invoices set paid_amount=initial_paid,
    status=case when initial_paid=amount then 'paid' when due_date<current_date then 'overdue' else 'pending' end,
    next_reminder_at=case when initial_paid=amount then null else next_reminder_at end
    where id=new.id;
  return new;
end $$;
create trigger invoices_record_initial_payment after insert on public.invoices
for each row execute function public.record_initial_invoice_payment();
revoke all on function public.record_initial_invoice_payment() from public,anon,authenticated;

-- Read-only diagnostics, callable only by the trusted server. No guessed backfill.
create or replace function public.audit_invoice_money(target_org uuid)
returns table(invoice_id uuid, invoice_number text, amount numeric, paid_amount numeric,
  ledger_paid numeric, formula_difference numeric, original_difference numeric)
language sql security invoker set search_path=public as $$
  select i.id,i.invoice_number,i.amount,i.paid_amount,
    coalesce(a.total,0),i.amount-round(i.amount_without_vat*(100+i.vat_rate)/100,2),
    i.amount-(i.money_evidence->>'original_total')::numeric
  from public.invoices i left join lateral (
    select sum(amount) total from public.bank_payment_allocations
    where invoice_id=i.id and organization_id=target_org and is_committed
  ) a on true
  where i.organization_id=target_org and (i.paid_amount<>coalesce(a.total,0)
    or i.amount<>round(i.amount_without_vat*(100+i.vat_rate)/100,2)
    or i.amount<>(i.money_evidence->>'original_total')::numeric)
$$;
revoke all on function public.audit_invoice_money(uuid) from public,anon,authenticated;
grant execute on function public.audit_invoice_money(uuid) to service_role;

alter table public.bank_statement_entries add column processing_error text;
alter table public.bank_statement_entries add column matching_version text not null default 'legacy';
alter table public.bank_statement_entries add column processed_at timestamptz;
alter table public.bank_statement_imports add column automation_mode text not null default 'shadow' check(automation_mode in ('shadow','automatic'));
alter table public.bank_statement_imports add column worker_attempts integer not null default 0;
alter table public.bank_statement_imports add column worker_last_attempt_at timestamptz;
alter table public.bank_statement_imports add column commit_requested boolean not null default false;

-- Append-only evidence, including allocations later removed by existing correction workflows.
create table public.payment_allocation_events (
  id bigint generated always as identity primary key,
  organization_id uuid not null references public.organizations(id),
  allocation_id uuid not null,
  operation text not null,
  snapshot jsonb not null,
  recorded_at timestamptz not null default now()
);
alter table public.payment_allocation_events enable row level security;
revoke all on public.payment_allocation_events from public,anon,authenticated;
grant select,insert on public.payment_allocation_events to service_role;
grant usage on sequence public.payment_allocation_events_id_seq to service_role;
create index on public.payment_allocation_events(organization_id,recorded_at);
create function public.audit_payment_allocation() returns trigger language plpgsql security definer set search_path=public as $$
begin
  if tg_op='DELETE' then
    insert into public.payment_allocation_events(organization_id,allocation_id,operation,snapshot)
    values(old.organization_id,old.id,tg_op,to_jsonb(old)); return old;
  end if;
  insert into public.payment_allocation_events(organization_id,allocation_id,operation,snapshot)
  values(new.organization_id,new.id,tg_op,to_jsonb(new)); return new;
end $$;
revoke all on function public.audit_payment_allocation() from public,anon,authenticated;
create trigger payment_allocation_audit after insert or update or delete on public.bank_payment_allocations
for each row execute function public.audit_payment_allocation();

-- A transaction per invocation; exception blocks isolate failed rows while the org lock
-- and invoice row locks prevent double allocation by simultaneous users/workers.
create function public.reconcile_bank_statement(
  target_org uuid, actor_user uuid, target_import uuid, expected_revision integer,
  automatic_only boolean default false, acknowledge_account_mismatch boolean default false
) returns jsonb language plpgsql security definer set search_path=public as $$
declare s public.bank_statement_imports%rowtype; e public.bank_statement_entries%rowtype;
  a record; inv public.invoices%rowtype; total numeric; n integer; partial boolean;
  payment_id uuid; sole_invoice uuid; failures jsonb := '[]'; done integer:=0; matched integer:=0;
  remaining integer; error_code text;
begin
  if not exists(select 1 from public.organization_members where organization_id=target_org and user_id=actor_user and role in ('accounting','admin')) then raise exception 'insufficient_payment_import_permission'; end if;
  perform pg_advisory_xact_lock(hashtextextended(target_org::text,0));
  select * into s from public.bank_statement_imports where id=target_import and organization_id=target_org for update;
  if not found then raise exception 'statement_import_not_found'; end if;
  if s.status='committed' then return jsonb_build_object('status','committed','revision',s.revision,'imported',0,'matched',0,'errors','[]'::jsonb,'idempotent',true); end if;
  if s.revision<>expected_revision then raise exception 'revision_conflict'; end if;
  if s.status<>'review' then raise exception 'statement_import_not_committable'; end if;
  if s.account_mismatch and (automatic_only or not acknowledge_account_mismatch) then raise exception 'account_mismatch_acknowledgement_required'; end if;
  if automatic_only and s.automation_mode<>'automatic' then
    return jsonb_build_object('status','shadow','revision',s.revision,'imported',0,'matched',0,'errors','[]'::jsonb);
  end if;
  for e in select * from public.bank_statement_entries where import_id=target_import and disposition='accepted'
    and bank_payment_id is null and (not automatic_only or (proposal_confidence='safe' and matching_version='v2'))
    order by line_number limit 100
  loop
    begin
      if exists(select 1 from public.bank_payments where organization_id=target_org and external_id=e.external_id) then
        raise exception 'possible_duplicate';
      end if;
      select coalesce(sum(amount),0),count(*),coalesce(bool_or(is_manual_partial),false),
        (array_agg(invoice_id order by invoice_id))[1] into total,n,partial,sole_invoice
        from public.bank_payment_allocations where statement_entry_id=e.id and not is_committed;
      if automatic_only and (n<>1 or total<>e.amount or sole_invoice is distinct from e.proposed_invoice_ids[1]) then raise exception 'proposal_changed'; end if;
      if total>e.amount or (n>0 and total<>e.amount and not partial) then raise exception 'invalid_allocation_totals'; end if;
      for a in select * from public.bank_payment_allocations where statement_entry_id=e.id and not is_committed order by invoice_id loop
        select * into inv from public.invoices where id=a.invoice_id and organization_id=target_org for update;
        if not found or inv.status not in ('pending','overdue') or inv.currency<>e.currency then raise exception 'invalid_allocation_target'; end if;
        if a.amount>inv.amount-inv.paid_amount then raise exception 'invoice_balance_changed'; end if;
        if automatic_only and (a.amount<>inv.amount-inv.paid_amount or not (
          nullif(ltrim(regexp_replace(coalesce(inv.variable_symbol,''),'\s','','g'),'0'),'')=nullif(ltrim(e.variable_symbol,'0'),'')
          or (nullif(trim(inv.variable_symbol),'') is null and trim(inv.invoice_number) ~ '^[0-9]+$'
            and nullif(ltrim(inv.invoice_number,'0'),'')=nullif(ltrim(e.variable_symbol,'0'),''))
        )) then raise exception 'proposal_changed'; end if;
      end loop;
      insert into public.bank_payments(organization_id,invoice_id,external_id,booked_on,amount,currency,
        variable_symbol,counterparty_name,counterparty_account,note,match_status,source,imported_by,matched_at)
      values(target_org,case when n=1 and total=e.amount then sole_invoice else null end,e.external_id,e.booked_on,e.amount,e.currency,
        e.variable_symbol,e.counterparty_name,e.counterparty_account,e.note,
        case when n=1 and total=e.amount then 'matched' when n>1 and total=e.amount then 'split' when n>0 then 'ambiguous' else 'unmatched' end,
        'bank_import',actor_user,case when n>0 then now() else null end) returning id into payment_id;
      for a in select * from public.bank_payment_allocations where statement_entry_id=e.id and not is_committed order by invoice_id loop
        update public.invoices set paid_amount=paid_amount+a.amount,
          status=case when paid_amount+a.amount=amount then 'paid' when due_date<(now() at time zone 'Europe/Prague')::date then 'overdue' else 'pending' end,
          paid_at=case when paid_amount+a.amount=amount then (e.booked_on+time '12:00') at time zone 'Europe/Prague' else null end,
          next_reminder_at=case when paid_amount+a.amount=amount then null else next_reminder_at end,
          updated_by=actor_user,updated_at=now() where id=a.invoice_id;
      end loop;
      update public.bank_payment_allocations set bank_payment_id=payment_id,is_committed=true,committed_at=now()
        where statement_entry_id=e.id and not is_committed;
      update public.bank_statement_entries set bank_payment_id=payment_id,processed_at=now(),processing_error=null where id=e.id;
      -- Learn only complete account identities; bare local account numbers cannot identify a bank.
      insert into public.counterparty_payment_accounts(organization_id,counterparty_ico,account_number,confirmed_by)
        select distinct target_org,i.counterparty_ico,e.counterparty_account,actor_user
        from public.bank_payment_allocations x join public.invoices i on i.id=x.invoice_id
        where x.statement_entry_id=e.id and nullif(trim(i.counterparty_ico),'') is not null
          and (e.counterparty_account ~ '/[0-9]{4}$' or e.counterparty_account ~ '^[A-Z]{2}[0-9A-Z]{13,32}$')
        on conflict(organization_id,counterparty_ico,account_number) do update set last_used_at=now();
      done:=done+1; if n>0 then matched:=matched+1; end if;
    exception when others then
      error_code:=case when sqlerrm in ('possible_duplicate','proposal_changed','invalid_allocation_totals','invalid_allocation_target','invoice_balance_changed') then sqlerrm else 'entry_commit_failed' end;
      update public.bank_statement_entries set processing_error=error_code,proposal_confidence='review' where id=e.id;
      failures:=failures||jsonb_build_array(jsonb_build_object('entry_id',e.id,'line_number',e.line_number,'code',error_code));
    end;
  end loop;
  select count(*) into remaining from public.bank_statement_entries where import_id=target_import and disposition='accepted' and bank_payment_id is null;
  update public.bank_statement_imports set revision=revision+1,status=case when remaining=0 then 'committed' else 'review' end,
    commit_requested=not automatic_only and remaining>0 and jsonb_array_length(failures)=0,
    updated_at=now(),committed_at=case when remaining=0 then now() else null end,
    committed_by=case when remaining=0 then actor_user else null end,
    account_mismatch_acknowledged=account_mismatch_acknowledged or acknowledge_account_mismatch
    where id=target_import;
  return jsonb_build_object('status',case when remaining=0 then 'committed' else 'review' end,'revision',s.revision+1,
    'imported',done,'matched',matched,'remaining',remaining,'errors',failures,'idempotent',false);
end $$;
revoke all on function public.reconcile_bank_statement(uuid,uuid,uuid,integer,boolean,boolean) from public,anon,authenticated;
grant execute on function public.reconcile_bank_statement(uuid,uuid,uuid,integer,boolean,boolean) to service_role;

-- Durable work is derived from persisted imports. Transaction locks are the lease:
-- on process termination Postgres rolls back the current batch; retries resume at bank_payment_id IS NULL.
create function public.run_bank_reconciliation_jobs() returns jsonb
language plpgsql security definer set search_path=public as $$
declare s record; result jsonb; results jsonb:='[]';
begin
  for s in select * from public.bank_statement_imports i where status='review'
    and (commit_requested or (automation_mode='automatic' and not account_mismatch and exists(
      select 1 from public.bank_statement_entries e where e.import_id=i.id and e.proposal_confidence='safe'
        and e.matching_version='v2' and e.bank_payment_id is null and e.disposition='accepted')))
    and (worker_last_attempt_at is null or worker_last_attempt_at<now()-interval '1 minute')
    order by created_at limit 5
  loop
    if not pg_try_advisory_xact_lock(hashtextextended(s.organization_id::text,0)) then continue; end if;
    begin
      result:=public.reconcile_bank_statement(s.organization_id,s.created_by,s.id,s.revision,not s.commit_requested,s.account_mismatch_acknowledged);
      update public.bank_statement_imports set worker_attempts=worker_attempts+1,worker_last_attempt_at=now(),failure_reason=null where id=s.id;
      results:=results||jsonb_build_array(jsonb_build_object('id',s.id,'result',result));
    exception when others then
      update public.bank_statement_imports set worker_attempts=worker_attempts+1,worker_last_attempt_at=now(),
        failure_reason=left(sqlerrm,100),commit_requested=false,automation_mode='shadow' where id=s.id;
      results:=results||jsonb_build_array(jsonb_build_object('id',s.id,'code','worker_failed'));
    end;
  end loop;
  return results;
end $$;
revoke all on function public.run_bank_reconciliation_jobs() from public,anon,authenticated;
grant execute on function public.run_bank_reconciliation_jobs() to service_role;

alter function public.create_bank_statement_preview(uuid,uuid,jsonb,jsonb) rename to create_bank_statement_preview_v1;
revoke all on function public.create_bank_statement_preview_v1(uuid,uuid,jsonb,jsonb) from public,anon,authenticated,service_role;
create function public.create_bank_statement_preview(target_org uuid,actor_user uuid,import_data jsonb,entry_rows jsonb)
returns jsonb language plpgsql security definer set search_path=public as $$
declare result jsonb; result_import_id uuid; s public.bank_statement_imports%rowtype;
begin
  result:=public.create_bank_statement_preview_v1(target_org,actor_user,import_data,entry_rows);
  result_import_id:=(result->>'id')::uuid;
  if not (result->>'duplicate')::boolean then
    update public.bank_statement_entries e set matching_version='v2' where e.import_id=result_import_id;
    -- A semantic collision is not proof of duplication. Retain the transaction for manual review.
    update public.bank_statement_entries e set proposal_confidence='review',proposal_kind='ambiguous',
      proposal_reason='Možná duplicita: stejný den, částka, měna, VS a účet jako dřívější platba. Ověřte ji před zaúčtováním.',
      processing_error='possible_duplicate'
    where e.import_id=result_import_id and e.disposition='accepted' and exists(
      select 1 from public.bank_payments p where p.organization_id=target_org and p.booked_on=e.booked_on
        and p.amount=e.amount and p.currency=e.currency and p.variable_symbol is not distinct from e.variable_symbol
        and p.counterparty_account is not distinct from e.counterparty_account
    );
    delete from public.bank_payment_allocations a using public.bank_statement_entries e
      where a.statement_entry_id=e.id and e.import_id=result_import_id and e.proposal_confidence='review' and not a.is_committed;
    update public.bank_statement_imports set automation_mode=case when import_data->>'automation_mode'='automatic' then 'automatic' else 'shadow' end
      where id=result_import_id;
  end if;
  select * into s from public.bank_statement_imports where id=result_import_id;
  return result||jsonb_build_object('totals',jsonb_build_object('accepted',s.accepted_count,'ignored',s.ignored_count,'errors',s.error_count),
    'total_entries',s.entry_count,'entries',(select coalesce(jsonb_agg(to_jsonb(e)),'[]') from
      (select * from public.bank_statement_entries where bank_statement_entries.import_id=result_import_id order by line_number limit 50) e));
end $$;
revoke all on function public.create_bank_statement_preview(uuid,uuid,jsonb,jsonb) from public,anon,authenticated;
grant execute on function public.create_bank_statement_preview(uuid,uuid,jsonb,jsonb) to service_role;
