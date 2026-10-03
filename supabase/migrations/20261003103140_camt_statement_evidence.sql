alter table public.bank_statement_imports drop constraint bank_statement_imports_source_format_check;
alter table public.bank_statement_imports add constraint bank_statement_imports_source_format_check check(source_format in('gpc','csv','camt053'));
alter table public.bank_statement_entries add column statement_account text;
alter table public.bank_statement_entries add column bank_reference text;
alter table public.bank_statement_entries add column provenance jsonb;
alter table public.bank_statement_entries add column overlap_warning boolean not null default false;
alter table public.bank_statement_entries add column overlap_acknowledged_by uuid references auth.users(id);
create index bank_statement_entries_reference on public.bank_statement_entries(organization_id,statement_account,bank_reference) where bank_reference is not null;
create index bank_statement_entries_camt on public.bank_statement_entries(organization_id,booked_on,amount) where record_type='camt053';

create function private.assistance_normalize_account(raw text) returns text language plpgsql immutable as $$
declare a text:=upper(regexp_replace(coalesce(raw,''),'\s','','g')); prefix text; begin
  if a ~ '^CZ[0-9]{22}$' then
    prefix:=ltrim(substr(a,9,6),'0');
    return case when prefix<>'' then prefix||'-' else '' end||coalesce(nullif(ltrim(substr(a,15,10),'0'),''),'0')||'/'||substr(a,5,4);
  end if;
  if a ~ '^([0-9]{1,6}-)?[0-9]{1,10}/[0-9]{4}$' then
    if position('-' in a)>0 then prefix:=ltrim(split_part(a,'-',1),'0'); a:=split_part(a,'-',2); else prefix:=''; end if;
    return case when prefix<>'' then prefix||'-' else '' end||coalesce(nullif(ltrim(split_part(a,'/',1),'0'),''),'0')||'/'||split_part(a,'/',2);
  end if;
  return a;
end $$;

-- Activates only when a CAMT row is involved. Existing formats keep their
-- identifiers; a possible cross-format duplicate requires explicit review.
create function private.assistance_cross_format_guard() returns trigger language plpgsql security definer set search_path=public as $$
declare account_value text; format_value text; begin
  if new.disposition<>'accepted' then return new; end if;
  select statement_account,source_format into account_value,format_value from public.bank_statement_imports where id=new.import_id;
  if format_value<>'camt053' and not exists(select 1 from public.bank_statement_entries where organization_id=new.organization_id and record_type='camt053') then return new; end if;
  if nullif(new.counterparty_account,'') is not null and (exists(
    select 1 from public.bank_statement_entries e join public.bank_statement_imports s on s.id=e.import_id
    where e.organization_id=new.organization_id and e.import_id<>new.import_id and s.status<>'discarded'
      and e.disposition='accepted' and e.unrelated_at is null and (s.source_format='camt053' or format_value='camt053') and s.source_format<>format_value
      and e.booked_on=new.booked_on and e.amount=new.amount and e.currency=new.currency
      and private.assistance_normalize_account(e.counterparty_account)=private.assistance_normalize_account(new.counterparty_account)
      and (s.statement_account is null or account_value is null or private.assistance_normalize_account(s.statement_account)=private.assistance_normalize_account(account_value))
  ) or (format_value='camt053' and exists(
    -- Older ledger rows may predate statement staging. Their missing bank
    -- reference cannot prove identity, so require a human duplicate check.
    select 1 from public.bank_payments b where b.organization_id=new.organization_id
      and b.booked_on=new.booked_on and b.amount=new.amount and b.currency=new.currency
      and private.assistance_normalize_account(b.counterparty_account)=private.assistance_normalize_account(new.counterparty_account)
      and not exists(select 1 from public.bank_statement_entries old_entry
        where old_entry.organization_id=b.organization_id and old_entry.bank_payment_id=b.id)
  ))) then
    new.overlap_warning:=true;
    new.proposal_confidence:='review';
    new.proposal_reason:='Možná stejná transakce v jiném formátu výpisu. Ověřte duplicitu před zaúčtováním.';
  end if;
  return new;
end $$;
create trigger payment_cross_format_guard before insert on public.bank_statement_entries for each row execute function private.assistance_cross_format_guard();

create function private.assistance_overlap_booking_guard() returns trigger language plpgsql security definer set search_path=public as $$ begin
  if exists(select 1 from public.bank_statement_entries e where e.organization_id=new.organization_id and e.external_id=new.external_id
    and e.disposition='accepted' and e.overlap_warning and e.overlap_acknowledged_by is null) then raise exception 'possible_duplicate'; end if;
  return new;
end $$;
create trigger payment_overlap_booking_guard before insert on public.bank_payments for each row execute function private.assistance_overlap_booking_guard();

create function public.create_camt_statement_preview(target_org uuid,actor_user uuid,import_data jsonb,entry_rows jsonb) returns jsonb
language plpgsql set search_path=public as $$
declare row_data jsonb; previous record; rows jsonb:='[]'; result jsonb; saved_import_id uuid; amended jsonb; begin
  perform private.assistance_require_actor(target_org,actor_user);
  perform pg_advisory_xact_lock(hashtextextended(target_org::text,0));
  if import_data->>'source_format'<>'camt053' or jsonb_typeof(entry_rows)<>'array' or jsonb_array_length(entry_rows) not between 1 and 10000 then raise exception 'invalid_camt_request'; end if;
  for row_data in select value from jsonb_array_elements(entry_rows) loop
    if row_data->>'disposition'='accepted' then
      row_data:=row_data||jsonb_build_object('proposal_confidence','review');
      if nullif(row_data->>'bank_reference','') is not null then
        select e.amount,e.currency,e.booked_on into previous from public.bank_statement_entries e join public.bank_statement_imports s on s.id=e.import_id
          where e.organization_id=target_org and e.disposition='accepted' and s.status<>'discarded'
            and e.statement_account=private.assistance_normalize_account(import_data->>'statement_account') and e.bank_reference=row_data->>'bank_reference' limit 1;
        if found then
          row_data:=row_data||jsonb_build_object('disposition',case when previous.amount=(row_data->>'amount')::numeric and previous.currency=row_data->>'currency' and previous.booked_on=(row_data->>'booked_on')::date then 'duplicate' else 'error' end,
            'reason','Bankovní reference už existuje; zkontrolujte původní položku.','proposal_kind',null,'proposal_confidence',null,'proposed_invoice_ids','[]'::jsonb);
        end if;
      end if;
    end if;
    rows:=rows||jsonb_build_array(row_data);
  end loop;
  amended:=import_data||jsonb_build_object('automation_mode','shadow',
    'accepted_count',(select count(*) from jsonb_array_elements(rows) r where r->>'disposition'='accepted'),
    'ignored_count',(select count(*) from jsonb_array_elements(rows) r where r->>'disposition' in('ignored','duplicate')),
    'error_count',(select count(*) from jsonb_array_elements(rows) r where r->>'disposition'='error'));
  result:=public.create_bank_statement_preview(target_org,actor_user,amended,rows);
  saved_import_id:=(result->>'id')::uuid;
  if not (result->>'duplicate')::boolean then
    update public.bank_statement_entries e set statement_account=private.assistance_normalize_account(import_data->>'statement_account'),
      bank_reference=r->>'bank_reference',provenance=r->'provenance'
      from jsonb_array_elements(rows) r where e.import_id=saved_import_id and e.line_number=(r->>'line_number')::integer;
  end if;
  return result||jsonb_build_object('entries',(select coalesce(jsonb_agg(to_jsonb(e)),'[]'::jsonb) from
    (select * from public.bank_statement_entries where bank_statement_entries.import_id=saved_import_id order by line_number limit 50) e));
end $$;

create function public.acknowledge_statement_overlap(target_org uuid,actor_user uuid,target_entry uuid,expected_revision integer) returns void
language plpgsql set search_path=public as $$ declare imp uuid; begin
  perform private.assistance_require_actor(target_org,actor_user);
  perform pg_advisory_xact_lock(hashtextextended(target_org::text,0));
  select import_id into imp from public.bank_statement_entries where id=target_entry and organization_id=target_org and overlap_warning and bank_payment_id is null;
  if imp is null then raise exception 'invalid_overlap_entry'; end if;
  update public.bank_statement_imports set revision=revision+1 where id=imp and organization_id=target_org and revision=expected_revision and status='review';
  if not found then raise exception 'revision_conflict'; end if;
  update public.bank_statement_entries set overlap_acknowledged_by=actor_user where id=target_entry;
  insert into public.payment_assistance_events(organization_id,entity_id,event_type,actor_user,snapshot)
    values(target_org,target_entry,'overlap_acknowledged',actor_user,jsonb_build_object('import_id',imp));
end $$;

revoke all on function private.assistance_normalize_account(text) from public,anon,authenticated;
revoke all on function private.assistance_cross_format_guard() from public,anon,authenticated;
revoke all on function private.assistance_overlap_booking_guard() from public,anon,authenticated;
revoke all on function public.create_camt_statement_preview(uuid,uuid,jsonb,jsonb) from public,anon,authenticated;
revoke all on function public.acknowledge_statement_overlap(uuid,uuid,uuid,integer) from public,anon,authenticated;
grant execute on function private.assistance_normalize_account(text),public.create_camt_statement_preview(uuid,uuid,jsonb,jsonb),public.acknowledge_statement_overlap(uuid,uuid,uuid,integer) to service_role;
