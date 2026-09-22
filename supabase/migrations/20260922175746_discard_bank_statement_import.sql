-- Nahraný výpis, který se ukázal jako špatný soubor nebo duplicita, zůstával
-- navždy ve stavu 'review' -- zahodit ho nešlo. Archiv importů tím postupně
-- zarůstá položkami, u kterých nikdo neví, jestli se čeká na kontrolu, nebo
-- jsou k ničemu.
--
-- Zahození je měkké, ne DELETE. Tvrdé smazání by kaskádou odstranilo
-- bank_statement_entries, jenže bank_payments na import navázané nejsou
-- (bank_statement_entries.bank_payment_id je on delete set null). Už
-- zaúčtované platby by tedy zůstaly, ale ztratily by doklad o tom, z jakého
-- výpisu vznikly. U účetního software je zničená auditní stopa horší problém
-- než zaseknutý stav.
--
-- Ověřeno, že nový stav nemůže nic obživit: reconcile_bank_statement()
-- odmítá vše, co není 'review' ('statement_import_not_committable'), a
-- run_bank_reconciliation_jobs() si vybírá výhradně status='review'.

alter table public.bank_statement_imports
  drop constraint if exists bank_statement_imports_status_check;

alter table public.bank_statement_imports
  add constraint bank_statement_imports_status_check
  check (status in ('review', 'committing', 'committed', 'failed', 'discarded'));

alter table public.bank_statement_imports
  add column if not exists discarded_at timestamptz,
  add column if not exists discarded_by uuid references auth.users(id) on delete set null,
  add column if not exists discard_reason text check (discard_reason is null or length(discard_reason) <= 500);

-- Stav a jeho doprovodné údaje musí držet pohromadě, aby nešlo zahodit výpis
-- bez zápisu o tom, kdo to udělal.
alter table public.bank_statement_imports
  drop constraint if exists bank_statement_imports_discard_state_check;
alter table public.bank_statement_imports
  add constraint bank_statement_imports_discard_state_check check (
    (status = 'discarded' and discarded_at is not null and discarded_by is not null)
    or (status <> 'discarded' and discarded_at is null and discarded_by is null)
  );

create or replace function public.discard_bank_statement_import(
  target_org uuid, actor_user uuid, target_import uuid, expected_revision integer, reason text default null
) returns jsonb language plpgsql security definer set search_path = public as $$
declare selected_import public.bank_statement_imports%rowtype; booked_count integer;
begin
  if not exists(
    select 1 from public.organization_members
    where organization_id=target_org and user_id=actor_user and role in ('accounting','admin')
  ) then raise exception 'insufficient_payment_import_permission'; end if;

  perform pg_advisory_xact_lock(hashtextextended(target_org::text, 0));
  select * into selected_import from public.bank_statement_imports
    where id=target_import and organization_id=target_org for update;
  if not found then raise exception 'statement_import_not_found'; end if;

  -- Opakované zahození není chyba; tlačítko se dá zmáčknout dvakrát.
  if selected_import.status='discarded' then
    return jsonb_build_object('id', selected_import.id, 'status', 'discarded',
      'revision', selected_import.revision, 'idempotent', true);
  end if;

  -- Zaúčtované platby jsou peníze na fakturách. Výpis, ze kterého vznikly,
  -- musí zůstat dohledatelný, i kdyby byl jinak k ničemu.
  select count(*) into booked_count from public.bank_statement_entries
    where import_id=target_import and bank_payment_id is not null;
  if booked_count>0 then raise exception 'statement_import_has_booked_payments'; end if;

  if selected_import.status not in ('review','failed') then
    raise exception 'statement_import_not_discardable';
  end if;
  if selected_import.revision<>expected_revision then raise exception 'revision_conflict'; end if;

  update public.bank_statement_imports set
    status='discarded', revision=revision+1, discarded_at=now(), discarded_by=actor_user,
    discard_reason=nullif(trim(coalesce(reason,'')),''), commit_requested=false, updated_at=now()
    where id=target_import;

  return jsonb_build_object('id', target_import, 'status', 'discarded',
    'revision', selected_import.revision+1, 'idempotent', false);
end $$;

revoke all on function public.discard_bank_statement_import(uuid,uuid,uuid,integer,text) from public,anon,authenticated;
grant execute on function public.discard_bank_statement_import(uuid,uuid,uuid,integer,text) to service_role;
