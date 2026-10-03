-- Additive assistance. No changes to the v5 matcher or its booking functions.
create table public.payment_assistance_settings (
  organization_id uuid primary key references public.organizations(id) on delete cascade,
  mode text not null default 'off' check(mode in ('off','shadow','review')),
  memory_enabled boolean not null default false,
  reevaluation_enabled boolean not null default false,
  generation bigint not null default 1
);
create table public.payment_payer_memory (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  counterparty_ico text not null check(length(counterparty_ico) between 1 and 20),
  account text check(length(account) between 1 and 100),
  payer_name text check(length(payer_name) between 1 and 200),
  reference text check(length(reference) between 1 and 500),
  source_payment_ids uuid[] not null check(cardinality(source_payment_ids) between 1 and 12),
  active boolean not null default true,
  revision integer not null default 1,
  confirmed_by uuid not null references auth.users(id),
  updated_at timestamptz not null default now(),
  check(account is not null or payer_name is not null or reference is not null)
);
create index payment_payer_memory_org on public.payment_payer_memory(organization_id) where active;
create index payment_payer_memory_sources on public.payment_payer_memory using gin(source_payment_ids);
create table public.payment_assistance_proposals (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  generation bigint not null,
  input_hash text not null check(input_hash ~ '^[a-f0-9]{64}$'),
  engine_version text not null check(engine_version='assistance-v1'),
  kind text not null check(kind in ('unique','ambiguous','waiting','complex')),
  status text not null default 'pending' check(status in ('pending','confirmed','rejected','stale')),
  proposal jsonb not null,
  created_at timestamptz not null default now(),
  decided_at timestamptz,
  decided_by uuid references auth.users(id),
  unique(organization_id,generation,input_hash)
);
create index payment_assistance_proposals_pending on public.payment_assistance_proposals(organization_id,created_at) where status='pending';
create table public.payment_assistance_jobs (
  organization_id uuid primary key references public.organizations(id) on delete cascade,
  requested_generation bigint not null,
  completed_generation bigint not null default 0,
  attempts integer not null default 0,
  available_at timestamptz not null default now(),
  lease_token uuid,
  lease_until timestamptz,
  last_error text,
  duration_ms integer,
  updated_at timestamptz not null default now()
);
create index payment_assistance_jobs_due on public.payment_assistance_jobs(available_at) where requested_generation>completed_generation;
create table public.payment_assistance_events (
  id bigint generated always as identity primary key,
  organization_id uuid not null references public.organizations(id) on delete cascade,
  entity_id uuid not null,
  event_type text not null,
  actor_user uuid references auth.users(id),
  snapshot jsonb not null,
  recorded_at timestamptz not null default now()
);
create index payment_assistance_events_org on public.payment_assistance_events(organization_id,recorded_at);
alter table public.bank_payments add column assistance_waiting boolean not null default false;

do $$ declare t text; begin
  foreach t in array array['payment_assistance_settings','payment_payer_memory','payment_assistance_proposals','payment_assistance_jobs','payment_assistance_events'] loop
    execute format('alter table public.%I enable row level security',t);
    execute format('revoke all on public.%I from public,anon,authenticated',t);
    execute format('grant select,insert,update,delete on public.%I to service_role',t);
  end loop;
end $$;
revoke update,delete on public.payment_assistance_events from service_role;
grant usage on sequence public.payment_assistance_events_id_seq to service_role;

create function private.assistance_require_actor(target_org uuid,actor_user uuid) returns void
language plpgsql set search_path=public as $$ begin
  if not exists(select 1 from public.organization_members where organization_id=target_org and user_id=actor_user and role in('accounting','admin')) then raise exception 'insufficient_permission'; end if;
end $$;

create function private.assistance_enqueue(target_org uuid, force_request boolean default false) returns void
language plpgsql security definer set search_path=public as $$ declare g bigint; begin
  update public.payment_assistance_settings set generation=generation+1 where organization_id=target_org and mode<>'off'
    and (reevaluation_enabled or force_request) returning generation into g;
  if g is null then return; end if;
  update public.payment_assistance_proposals set status='stale' where organization_id=target_org and status='pending';
  insert into public.payment_assistance_jobs(organization_id,requested_generation) values(target_org,g)
    on conflict(organization_id) do update set requested_generation=excluded.requested_generation,available_at=now(),attempts=0,updated_at=now();
end $$;

create function public.configure_payment_assistance(target_org uuid,new_mode text,new_memory boolean,new_reevaluation boolean) returns void
language plpgsql set search_path=public as $$ declare previous record; begin
  if new_mode not in('off','shadow','review') then raise exception 'invalid_mode'; end if;
  select * into previous from public.payment_assistance_settings where organization_id=target_org;
  insert into public.payment_assistance_settings(organization_id,mode,memory_enabled,reevaluation_enabled)
    values(target_org,new_mode,new_memory,new_reevaluation)
    on conflict(organization_id) do update set mode=excluded.mode,memory_enabled=excluded.memory_enabled,reevaluation_enabled=excluded.reevaluation_enabled;
  if previous is null or row(previous.mode,previous.memory_enabled,previous.reevaluation_enabled) is distinct from row(new_mode,new_memory,new_reevaluation) then
    perform private.assistance_enqueue(target_org,true);
  end if;
end $$;

-- Triggers isolate assistance failures from the existing invoice/payment write.
-- Generation invalidation still runs with reevaluation disabled; only queuing is optional.
create function private.assistance_changed() returns trigger language plpgsql security definer set search_path=public as $$
declare org uuid; g bigint; source_id uuid; begin
  org:=case when tg_op='DELETE' then old.organization_id else new.organization_id end;
  if tg_table_name='bank_payment_allocations' and tg_op in('DELETE','UPDATE') then
    source_id:=old.bank_payment_id;
    update public.payment_payer_memory set active=false,revision=revision+1,updated_at=now()
      where organization_id=org and active and source_id=any(source_payment_ids);
  end if;
  if tg_table_name='payment_payer_memory' then
    insert into public.payment_assistance_events(organization_id,entity_id,event_type,actor_user,snapshot)
      values(org,case when tg_op='DELETE' then old.id else new.id end,'memory_'||lower(tg_op),
        case when tg_op='DELETE' then old.confirmed_by else new.confirmed_by end,
        jsonb_build_object('before',case when tg_op<>'INSERT' then to_jsonb(old) end,'after',case when tg_op<>'DELETE' then to_jsonb(new) end));
  end if;
  update public.payment_assistance_settings set generation=generation+1 where organization_id=org and mode<>'off' returning generation into g;
  if g is not null then
    update public.payment_assistance_proposals set status='stale' where organization_id=org and status='pending';
    if exists(select 1 from public.payment_assistance_settings where organization_id=org and reevaluation_enabled) then
      insert into public.payment_assistance_jobs(organization_id,requested_generation) values(org,g)
        on conflict(organization_id) do update set requested_generation=excluded.requested_generation,available_at=now(),attempts=0,updated_at=now();
    end if;
  end if;
  return null;
exception when others then
  raise warning 'payment assistance invalidation failed: %',sqlstate;
  return null;
end $$;
create trigger payment_assistance_invoice_changed after insert or delete or update of amount,paid_amount,status,currency,issue_date,variable_symbol,invoice_number,counterparty_ico,counterparty_name on public.invoices for each row execute function private.assistance_changed();
create trigger payment_assistance_payment_changed after insert or delete or update of amount,currency,booked_on,variable_symbol,counterparty_name,counterparty_account,note,match_status on public.bank_payments for each row execute function private.assistance_changed();
create trigger payment_assistance_allocation_changed after insert or update or delete on public.bank_payment_allocations for each row execute function private.assistance_changed();
create trigger payment_assistance_memory_changed after insert or update or delete on public.payment_payer_memory for each row execute function private.assistance_changed();

create function public.payment_assistance_inputs(target_org uuid) returns jsonb language plpgsql set search_path=public as $$
declare result jsonb; begin
  if (select count(*) from public.bank_payments where organization_id=target_org and match_status in('unmatched','ambiguous'))>10000
     or (select count(*) from public.invoices where organization_id=target_org and status in('pending','overdue'))>10000 then raise exception 'assistance_input_limit'; end if;
  select jsonb_build_object('generation',s.generation,
    'payments',coalesce((select jsonb_agg(jsonb_build_object('id',p.id,'organization_id',p.organization_id,'amount',p.amount,
      'allocated_amount',coalesce((select sum(a.amount) from public.bank_payment_allocations a where a.bank_payment_id=p.id and a.is_committed),0),
      'currency',p.currency,'booked_on',p.booked_on,'counterparty_account',p.counterparty_account,'counterparty_name',p.counterparty_name,
      'variable_symbol',p.variable_symbol,'note',p.note,'eligible',true,
      'account_verified',not exists(select 1 from public.bank_statement_entries e where e.bank_payment_id=p.id and not e.counterparty_account_verified)) order by p.id)
      from public.bank_payments p where p.organization_id=target_org and p.match_status in('unmatched','ambiguous')
      and not exists(select 1 from public.bank_statement_entries e join public.bank_statement_imports imp on imp.id=e.import_id
        where e.bank_payment_id=p.id and (e.unrelated_at is not null or imp.status='discarded'))),'[]'::jsonb),
    'invoices',coalesce((select jsonb_agg(jsonb_build_object('id',i.id,'organization_id',i.organization_id,'amount',i.amount,'paid_amount',i.paid_amount,
      'currency',i.currency,'counterparty_ico',i.counterparty_ico,'counterparty_name',i.counterparty_name,'invoice_number',i.invoice_number,
      'variable_symbol',i.variable_symbol,'issue_date',i.issue_date,'status',i.status) order by i.id)
      from public.invoices i where i.organization_id=target_org and i.status in('pending','overdue')),'[]'::jsonb),
    'closed_invoices',coalesce((select jsonb_agg(jsonb_build_object('id',i.id,'organization_id',i.organization_id,'amount',i.amount,'paid_amount',i.paid_amount,
      'currency',i.currency,'counterparty_ico',i.counterparty_ico,'counterparty_name',i.counterparty_name,'invoice_number',i.invoice_number,
      'variable_symbol',i.variable_symbol,'issue_date',i.issue_date,'status',i.status)) from public.invoices i where i.organization_id=target_org and i.status not in('pending','overdue')
      and exists(select 1 from public.bank_payments p where p.organization_id=target_org and p.match_status in('unmatched','ambiguous') and p.currency=i.currency
        and (nullif(ltrim(coalesce(i.variable_symbol,case when i.invoice_number ~ '^[0-9]+$' then i.invoice_number end), '0'),'')=nullif(ltrim(p.variable_symbol,'0'),'')
          or (i.invoice_number ~ '^[0-9A-Za-z]{4,}$' and p.note ~* ('(^|[^0-9A-Za-z])'||i.invoice_number||'([^0-9A-Za-z]|$)'))))),'[]'::jsonb),
    'memories',case when s.memory_enabled then coalesce((select jsonb_agg(jsonb_build_object('id',m.id,'organization_id',m.organization_id,
      'counterparty_ico',m.counterparty_ico,'account',m.account,'payer_name',m.payer_name,'reference',m.reference,'active',m.active,'revision',m.revision) order by m.id)
      from public.payment_payer_memory m where m.organization_id=target_org and m.active),'[]'::jsonb) else '[]'::jsonb end)
    into result from public.payment_assistance_settings s where s.organization_id=target_org and s.mode<>'off';
  return result;
end $$;

create function public.claim_payment_assistance_job(target_org uuid) returns jsonb language plpgsql set search_path=public as $$
declare j public.payment_assistance_jobs%rowtype; begin
  update public.payment_assistance_jobs set lease_token=gen_random_uuid(),lease_until=now()+interval '2 minutes',attempts=attempts+1
    where organization_id=target_org and requested_generation>completed_generation and available_at<=now()
    and (lease_until is null or lease_until<now()) returning * into j;
  if not found then return null; end if;
  return to_jsonb(j);
end $$;

create function public.finish_payment_assistance_job(target_org uuid,token uuid,expected_generation bigint,proposals jsonb,error_code text,elapsed_ms integer) returns void
language plpgsql set search_path=public as $$ declare g bigint; p jsonb; begin
  -- Same order as enqueue and booking: settings before job.
  select generation into g from public.payment_assistance_settings where organization_id=target_org for update;
  perform 1 from public.payment_assistance_jobs where organization_id=target_org and lease_token=token for update;
  if not found then raise exception 'lease_conflict'; end if;
  if error_code is not null then
    update public.payment_assistance_jobs set lease_token=null,lease_until=null,last_error=left(error_code,100),
      available_at=now()+least(attempts,60)*interval '1 minute',duration_ms=elapsed_ms where organization_id=target_org;
    return;
  end if;
  if g=expected_generation and exists(select 1 from public.payment_assistance_settings where organization_id=target_org and mode<>'off') then
    if jsonb_typeof(proposals)<>'array' or jsonb_array_length(proposals)>10000 then raise exception 'invalid_proposals'; end if;
    update public.payment_assistance_proposals set status='stale' where organization_id=target_org and status='pending' and generation<>g;
    for p in select value from jsonb_array_elements(proposals) loop
      insert into public.payment_assistance_proposals(organization_id,generation,input_hash,engine_version,kind,proposal)
        values(target_org,g,p->>'input_hash',p->>'engine_version',p->>'kind',p) on conflict do nothing;
    end loop;
    update public.payment_assistance_jobs set completed_generation=expected_generation,last_error=null,duration_ms=elapsed_ms where organization_id=target_org;
  end if;
  update public.payment_assistance_jobs set lease_token=null,lease_until=null where organization_id=target_org;
end $$;

create function public.request_payment_assistance(target_org uuid,actor_user uuid) returns void language plpgsql set search_path=public as $$ begin
  perform private.assistance_require_actor(target_org,actor_user);
  perform private.assistance_enqueue(target_org,true);
end $$;

create function public.payment_assistance_overview(target_org uuid,actor_user uuid) returns jsonb language plpgsql set search_path=public as $$
declare s public.payment_assistance_settings%rowtype; result jsonb; begin
  perform private.assistance_require_actor(target_org,actor_user);
  select * into s from public.payment_assistance_settings where organization_id=target_org;
  select jsonb_build_object(
    'proposals',case when s.mode='review' then coalesce((select jsonb_agg(to_jsonb(p)) from
      (select * from public.payment_assistance_proposals where organization_id=target_org and status='pending' order by created_at desc,id limit 100) p),'[]'::jsonb) else '[]'::jsonb end,
    'memories',case when s.memory_enabled and s.mode='review' then coalesce((select jsonb_agg(to_jsonb(m)) from
      (select * from public.payment_payer_memory where organization_id=target_org order by updated_at desc,id limit 100) m),'[]'::jsonb) else '[]'::jsonb end,
    'payments',coalesce((select jsonb_agg(to_jsonb(p)) from (select id,amount,currency,booked_on,counterparty_name,assistance_waiting from public.bank_payments
      where organization_id=target_org and match_status in('unmatched','ambiguous') order by booked_on desc,id limit 100) p),'[]'::jsonb),
    'sources',case when s.memory_enabled and s.mode='review' then coalesce((select jsonb_agg(to_jsonb(p)) from (
      select b.id,b.counterparty_account,b.counterparty_name,b.note,b.amount,b.currency,
        min(i.counterparty_ico) counterparty_ico,min(i.counterparty_name) customer_name
      from public.bank_payments b join public.bank_payment_allocations a on a.bank_payment_id=b.id and a.is_committed
      join public.invoices i on i.id=a.invoice_id where b.organization_id=target_org and b.match_reason is null
        and b.match_status in('matched','split') group by b.id having count(distinct i.counterparty_ico)=1 and bool_and(i.counterparty_ico is not null)
      order by b.booked_on desc,b.id limit 100) p),'[]'::jsonb) else '[]'::jsonb end,
    'job',(select to_jsonb(j) from public.payment_assistance_jobs j where j.organization_id=target_org),
    'metrics',jsonb_build_object('confirmed',(select count(*) from public.payment_assistance_events where organization_id=target_org and event_type='proposal_confirmed'),
      'rejected',(select count(*) from public.payment_assistance_events where organization_id=target_org and event_type='proposal_rejected'))
  ) into result;
  return result;
end $$;

create function public.set_payment_assistance_waiting(target_org uuid,actor_user uuid,target_payment uuid,waiting boolean) returns void
language plpgsql set search_path=public as $$ begin
  perform private.assistance_require_actor(target_org,actor_user);
  if not exists(select 1 from public.payment_assistance_settings where organization_id=target_org and mode='review') then raise exception 'assistance_disabled'; end if;
  update public.bank_payments set assistance_waiting=waiting where organization_id=target_org and id=target_payment and match_status in('unmatched','ambiguous');
  if not found then raise exception 'payment_not_eligible'; end if;
  insert into public.payment_assistance_events(organization_id,entity_id,event_type,actor_user,snapshot)
    values(target_org,target_payment,'waiting_changed',actor_user,jsonb_build_object('waiting',waiting));
  perform private.assistance_enqueue(target_org,true);
end $$;

create function public.save_payment_payer_memory(target_org uuid,actor_user uuid,target_memory uuid,expected_revision integer,ico text,new_account text,new_name text,new_reference text,sources uuid[],new_active boolean) returns uuid
language plpgsql set search_path=public as $$ declare result uuid; p uuid; begin
  perform private.assistance_require_actor(target_org,actor_user);
  perform pg_advisory_xact_lock(hashtextextended(target_org::text,0));
  if not exists(select 1 from public.payment_assistance_settings where organization_id=target_org and memory_enabled and mode='review') then raise exception 'assistance_disabled'; end if;
  if sources is null or cardinality(sources) not between 1 and 12 then raise exception 'invalid_memory_sources'; end if;
  -- Every source must have a current HUMAN-confirmed allocation to this customer.
  foreach p in array sources loop
    if not exists(select 1 from public.bank_payment_allocations a join public.invoices i on i.id=a.invoice_id
      join public.bank_payments b on b.id=a.bank_payment_id where a.organization_id=target_org and a.bank_payment_id=p and a.is_committed
      and i.counterparty_ico=ico and b.match_reason is null)
      or exists(select 1 from public.bank_payment_allocations a join public.invoices i on i.id=a.invoice_id
        where a.organization_id=target_org and a.bank_payment_id=p and a.is_committed and i.counterparty_ico is distinct from ico) then raise exception 'unconfirmed_memory_source'; end if;
    if new_account is not null and exists(select 1 from public.bank_statement_entries e where e.bank_payment_id=p and not e.counterparty_account_verified) then raise exception 'unverified_memory_account'; end if;
  end loop;
  if target_memory is null then
    insert into public.payment_payer_memory(organization_id,counterparty_ico,account,payer_name,reference,source_payment_ids,confirmed_by,active)
      values(target_org,ico,nullif(trim(new_account),''),nullif(trim(new_name),''),nullif(trim(new_reference),''),sources,actor_user,new_active) returning id into result;
  else
    update public.payment_payer_memory set counterparty_ico=ico,account=nullif(trim(new_account),''),payer_name=nullif(trim(new_name),''),reference=nullif(trim(new_reference),''),
      source_payment_ids=sources,active=new_active,revision=revision+1,confirmed_by=actor_user,updated_at=now()
      where id=target_memory and organization_id=target_org and revision=expected_revision returning id into result;
    if not found then raise exception 'revision_conflict'; end if;
  end if;
  return result;
end $$;

create function public.decide_payment_assistance(target_org uuid,actor_user uuid,target_proposal uuid,accept boolean) returns jsonb
language plpgsql set search_path=public as $$
declare proposal_row public.payment_assistance_proposals%rowtype; p public.bank_payments%rowtype; i public.invoices%rowtype;
  item jsonb; snap jsonb; total numeric; allocation_count integer; sole uuid; latest date; ids uuid[]; current_inputs jsonb; g bigint;
begin
  perform private.assistance_require_actor(target_org,actor_user);
  perform pg_advisory_xact_lock(hashtextextended(target_org::text,0));
  select * into proposal_row from public.payment_assistance_proposals where id=target_proposal and organization_id=target_org for update;
  if not found then raise exception 'proposal_not_found'; end if;
  if proposal_row.status='confirmed' then return jsonb_build_object('id',target_proposal,'idempotent',true); end if;
  if not exists(select 1 from public.payment_assistance_settings where organization_id=target_org and mode='review') then raise exception 'assistance_disabled'; end if;
  if proposal_row.status<>'pending' then raise exception 'proposal_changed'; end if;
  if not accept then
    update public.payment_assistance_proposals set status='rejected',decided_by=actor_user,decided_at=now() where id=target_proposal;
    insert into public.payment_assistance_events(organization_id,entity_id,event_type,actor_user,snapshot) values(target_org,target_proposal,'proposal_rejected',actor_user,proposal_row.proposal);
    return jsonb_build_object('id',target_proposal,'status','rejected');
  end if;
  if proposal_row.kind<>'unique' or proposal_row.engine_version<>'assistance-v1' then raise exception 'proposal_not_unique'; end if;
  select array_agg(value::uuid order by value::uuid) into ids from jsonb_array_elements_text(proposal_row.proposal->'payment_ids');
  if cardinality(ids) not between 1 and 12 then raise exception 'invalid_proposal'; end if;
  perform 1 from public.bank_payments where organization_id=target_org and id=any(ids) order by id for update;
  select array_agg(value::uuid order by value::uuid) into ids from jsonb_array_elements_text(proposal_row.proposal->'invoice_ids');
  if cardinality(ids) not between 1 and 32 then raise exception 'invalid_proposal'; end if;
  perform 1 from public.invoices where organization_id=target_org and id=any(ids) order by id for update;
  select generation into g from public.payment_assistance_settings where organization_id=target_org for update;
  if g<>proposal_row.generation then raise exception 'proposal_changed'; end if;
  current_inputs:=public.payment_assistance_inputs(target_org);
  -- Check actual identity fields and remaining balances, even if a trigger failed.
  foreach snap in array array[proposal_row.proposal->'snapshot'] loop
    for item in select value from jsonb_array_elements(snap->'payments') loop
      if not exists(select 1 from jsonb_array_elements(current_inputs->'payments') v where v=item) then raise exception 'proposal_changed'; end if;
    end loop;
    for item in select value from jsonb_array_elements(snap->'invoices') loop
      if not exists(select 1 from jsonb_array_elements(current_inputs->'invoices') v where v=item) then raise exception 'proposal_changed'; end if;
    end loop;
    for item in select value from jsonb_array_elements(snap->'memories') loop
      if not exists(select 1 from jsonb_array_elements(current_inputs->'memories') v where v=item) then raise exception 'proposal_changed'; end if;
    end loop;
  end loop;
  if jsonb_array_length(proposal_row.proposal->'allocations')<1 then raise exception 'invalid_proposal'; end if;
  for item in select value from jsonb_array_elements(proposal_row.proposal->'allocations') loop
    if (item->>'amount')::numeric<=0 or round((item->>'amount')::numeric,2)<>(item->>'amount')::numeric
      or not (proposal_row.proposal->'payment_ids' ? (item->>'payment_id')) or not (proposal_row.proposal->'invoice_ids' ? (item->>'invoice_id')) then raise exception 'invalid_proposal'; end if;
  end loop;
  -- Validate all totals BEFORE writing, preserving partial-payment ledger semantics.
  for p in select * from public.bank_payments where organization_id=target_org and id in(select value::uuid from jsonb_array_elements_text(proposal_row.proposal->'payment_ids')) loop
    select sum((v->>'amount')::numeric) into total from jsonb_array_elements(proposal_row.proposal->'allocations') v where v->>'payment_id'=p.id::text;
    if total is null or total<>p.amount-coalesce((select sum(amount) from public.bank_payment_allocations where bank_payment_id=p.id and is_committed),0) then raise exception 'invalid_allocation_totals'; end if;
  end loop;
  for i in select * from public.invoices where organization_id=target_org and id in(select value::uuid from jsonb_array_elements_text(proposal_row.proposal->'invoice_ids')) loop
    select sum((v->>'amount')::numeric) into total from jsonb_array_elements(proposal_row.proposal->'allocations') v where v->>'invoice_id'=i.id::text;
    if total is null or total<>i.amount-i.paid_amount or i.status not in('pending','overdue') then raise exception 'invoice_balance_changed'; end if;
  end loop;
  update public.payment_assistance_proposals set status='confirmed',decided_by=actor_user,decided_at=now() where id=target_proposal;
  for item in select value from jsonb_array_elements(proposal_row.proposal->'allocations') loop
    select * into p from public.bank_payments where id=(item->>'payment_id')::uuid and organization_id=target_org;
    select * into i from public.invoices where id=(item->>'invoice_id')::uuid and organization_id=target_org;
    if p.currency<>i.currency or p.booked_on<i.issue_date then raise exception 'invalid_allocation_target'; end if;
    insert into public.bank_payment_allocations(organization_id,bank_payment_id,invoice_id,amount,is_manual_partial,is_committed,created_by,committed_at)
      values(target_org,p.id,i.id,(item->>'amount')::numeric,true,true,actor_user,now())
      on conflict(bank_payment_id,invoice_id) where bank_payment_id is not null and is_committed
      do update set amount=public.bank_payment_allocations.amount+excluded.amount;
  end loop;
  for i in select * from public.invoices where organization_id=target_org and id in(select value::uuid from jsonb_array_elements_text(proposal_row.proposal->'invoice_ids')) loop
    select max(bp.booked_on) into latest from public.bank_payment_allocations a join public.bank_payments bp on bp.id=a.bank_payment_id where a.invoice_id=i.id and a.is_committed;
    update public.invoices set paid_amount=amount,status='paid',paid_at=(latest+time '12:00') at time zone 'Europe/Prague',next_reminder_at=null,updated_by=actor_user,updated_at=now() where id=i.id;
  end loop;
  for p in select * from public.bank_payments where organization_id=target_org and id in(select value::uuid from jsonb_array_elements_text(proposal_row.proposal->'payment_ids')) loop
    select count(*),(array_agg(invoice_id))[1] into allocation_count,sole from public.bank_payment_allocations where bank_payment_id=p.id and is_committed;
    update public.bank_payments set invoice_id=case when allocation_count=1 then sole end,match_status=case when allocation_count=1 then 'matched' else 'split' end,
      match_reason=null,matched_at=now(),assistance_waiting=false where id=p.id;
  end loop;
  insert into public.payment_assistance_events(organization_id,entity_id,event_type,actor_user,snapshot) values(target_org,target_proposal,'proposal_confirmed',actor_user,proposal_row.proposal);
  return jsonb_build_object('id',target_proposal,'status','confirmed');
end $$;

-- All entry points are server-only; caller identity is checked on user mutations.
do $$ declare f record; begin
  for f in select p.oid::regprocedure signature from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where (n.nspname='private' and p.proname like 'assistance_%') or (n.nspname='public' and p.proname in(
      'configure_payment_assistance','payment_assistance_inputs','claim_payment_assistance_job','finish_payment_assistance_job',
      'request_payment_assistance','payment_assistance_overview','set_payment_assistance_waiting','save_payment_payer_memory','decide_payment_assistance')) loop
    execute format('revoke all on function %s from public,anon,authenticated',f.signature);
    execute format('grant execute on function %s to service_role',f.signature);
  end loop;
end $$;
