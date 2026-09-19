-- One payment pays one invoice: let a confirmed account identity carry an
-- automatic match, and let that identity actually be learned from GPC.
--
-- Two guards in 20260918111705 together made the "confirmed counterparty
-- account" rule unreachable for the only statement format this app imports:
--
--   1. Learning required a complete identity ('.../0100' or an IBAN). A GPC
--      075 record carries the counterparty account as a bare 16-digit
--      domestic number with no bank code attached, so nothing was EVER
--      learned from a GPC import and counterparty_payment_accounts stayed
--      empty forever.
--   2. The unattended path (automatic_only) additionally demanded that the
--      allocated invoice's VS or number equal the payment's VS -- so a
--      payment carrying no usable VS at all could never commit automatically,
--      even when the payer's account was already confirmed.
--
-- Both are relaxed below, deliberately and narrowly.

-- (1) Learn a bare domestic account number too.
--
-- The tradeoff is real and worth stating: an account number without a bank
-- code is not nationally unique, so in principle two counterparties at
-- different banks could share one. What that could actually cause is bounded:
-- a learned identity is never sufficient on its own -- it only ever combines
-- with an exact remaining amount, a payment not predating the invoice, and
-- the one-payment-one-invoice uniqueness check. A collision would have to
-- coincide with all of those to mislead anything.
create or replace function private.is_learnable_account(account text)
returns boolean language sql immutable as $$
  select account is not null and (
    account ~ '/[0-9]{4}$'                 -- domestic, with bank code
    or account ~ '^[A-Z]{2}[0-9A-Z]{13,32}$'  -- IBAN
    or account ~ '^[0-9]{6,16}$'           -- bare domestic account (GPC 075)
  ) and nullif(ltrim(regexp_replace(account,'\D','','g'),'0'),'') is not null
$$;

comment on function private.is_learnable_account(text) is
  'An account string specific enough to remember as a counterparty identity. Excludes all-zero placeholders, which GPC uses for the bank''s own internal postings.';

-- (2) Recreate the reconciler with both relaxations applied.
create or replace function public.reconcile_bank_statement(
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
        -- Unattended commits still demand a verifiable identity and the exact
        -- remaining balance -- what widens here is only WHICH identity counts.
        -- A counterparty account a human has already confirmed for this
        -- counterparty is evidence of the same kind as a matching VS, and it
        -- is the only identity a payment without a usable VS can ever offer.
        if automatic_only and (a.amount<>inv.amount-inv.paid_amount or not (
          nullif(ltrim(regexp_replace(coalesce(inv.variable_symbol,''),'\s','','g'),'0'),'')=nullif(ltrim(e.variable_symbol,'0'),'')
          or (nullif(trim(inv.variable_symbol),'') is null and trim(inv.invoice_number) ~ '^[0-9]+$'
            and nullif(ltrim(inv.invoice_number,'0'),'')=nullif(ltrim(e.variable_symbol,'0'),''))
          or exists(select 1 from public.counterparty_payment_accounts c
            where c.organization_id=target_org and c.account_number=e.counterparty_account
              and c.counterparty_ico=nullif(trim(inv.counterparty_ico),''))
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
      -- Learn the payer's account identity, but only from an allocation that
      -- paid exactly one invoice in full: that is the only case where the
      -- account provably belongs to that one counterparty. A split or partial
      -- payment leaves the attribution ambiguous, and a wrong identity learned
      -- here would quietly steer future automatic matches.
      if n=1 and total=e.amount and private.is_learnable_account(e.counterparty_account) then
        insert into public.counterparty_payment_accounts(organization_id,counterparty_ico,account_number,confirmed_by)
          select distinct target_org,i.counterparty_ico,e.counterparty_account,actor_user
          from public.bank_payment_allocations x join public.invoices i on i.id=x.invoice_id
          where x.statement_entry_id=e.id and nullif(trim(i.counterparty_ico),'') is not null
          on conflict(organization_id,counterparty_ico,account_number) do update set last_used_at=now();
      end if;
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
