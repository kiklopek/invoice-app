-- One payment may settle several of the payer's invoices, unattended.
--
-- Three separate places blocked it, and all three have to move together:
--   1. the preview seeded an allocation only for proposed_invoice_ids[1], and
--      only when cardinality was exactly 1 (see the preview wrapper below);
--   2. the reconciler's unattended path raised proposal_changed whenever an
--      entry had anything other than exactly one allocation (replaced here);
--   3. the matcher only ever returned combinations as "review" (web tier, v5).
--
-- What does NOT move: every invoice in a combination is still settled in FULL
-- (a.amount = its whole remaining balance), the allocated total must equal the
-- payment to the haler, and each invoice still has to carry its own evidence.
-- Partial payments remain outside the unattended path entirely.
--
-- Account-identity learning stays restricted to n=1 further down: a payment
-- split across several invoices does not prove whose account it came from.

create or replace function public.reconcile_bank_statement(
  target_org uuid, actor_user uuid, target_import uuid, expected_revision integer,
  automatic_only boolean default false, acknowledge_account_mismatch boolean default false
) returns jsonb language plpgsql security definer set search_path=public as $$
declare s public.bank_statement_imports%rowtype; e public.bank_statement_entries%rowtype;
  a record; inv public.invoices%rowtype; total numeric; n integer; partial boolean;
  payment_id uuid; sole_invoice uuid; failures jsonb := '[]'; done integer:=0; matched integer:=0;
  remaining integer; error_code text; allocated uuid[]; proposed uuid[];
begin
  if not exists(select 1 from public.organization_members where organization_id=target_org and user_id=actor_user and role in ('accounting','admin')) then raise exception 'insufficient_payment_import_permission'; end if;
  perform pg_advisory_xact_lock(hashtextextended(target_org::text,0));
  select * into s from public.bank_statement_imports where id=target_import and organization_id=target_org for update;
  if not found then raise exception 'statement_import_not_found'; end if;
  if s.status='committed' then return jsonb_build_object('status','committed','revision',s.revision,'imported',0,'matched',0,'errors','[]'::jsonb,'idempotent',true); end if;
  if s.revision<>expected_revision then raise exception 'revision_conflict'; end if;
  if s.status<>'review' then raise exception 'statement_import_not_committable'; end if;
  -- The mismatch no longer gates the unattended path, by the owner's decision:
  -- their bank writes a header account that never equals the configured one, so
  -- the gate fired on every statement and held back even the rows it had no
  -- doubt about. It still gates a PERSON committing the statement, which is
  -- where the question actually belongs -- someone is looking at the warning
  -- and can answer it. The flag stays set and stays visible either way.
  if s.account_mismatch and not s.account_mismatch_acknowledged
     and not automatic_only and not acknowledge_account_mismatch then raise exception 'account_mismatch_acknowledgement_required'; end if;
  if automatic_only and s.automation_mode<>'automatic' then
    return jsonb_build_object('status','shadow','revision',s.revision,'imported',0,'matched',0,'errors','[]'::jsonb);
  end if;
  for e in select * from public.bank_statement_entries where import_id=target_import and disposition='accepted'
    and bank_payment_id is null and (not automatic_only or (proposal_confidence='safe' and matching_version='v4'))
    order by line_number limit 100
  loop
    begin
      if exists(select 1 from public.bank_payments where organization_id=target_org and external_id=e.external_id) then
        raise exception 'possible_duplicate';
      end if;
      select coalesce(sum(amount),0),count(*),coalesce(bool_or(is_manual_partial),false),
        (array_agg(invoice_id order by invoice_id))[1] into total,n,partial,sole_invoice
        from public.bank_payment_allocations where statement_entry_id=e.id and not is_committed;
      -- One payment may now settle SEVERAL invoices unattended, so the old
      -- "exactly one allocation" rule is replaced by a stricter equality: the
      -- set of uncommitted allocations must be EXACTLY the set the matcher
      -- proposed -- no invoice added, none dropped, none swapped -- and the
      -- allocated total must be the whole payment. A subset or superset means
      -- the ledger moved under the proposal, which is the case this refuses.
      select coalesce(array_agg(invoice_id order by invoice_id),'{}') into allocated
        from public.bank_payment_allocations where statement_entry_id=e.id and not is_committed;
      select coalesce(array_agg(x order by x),'{}') into proposed
        from unnest(e.proposed_invoice_ids) x;
      if automatic_only and (n<1 or total<>e.amount or allocated is distinct from proposed) then raise exception 'proposal_changed'; end if;
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
        -- Re-derive the evidence here rather than trusting the proposal. The
        -- matcher that produced it runs in the web tier against a snapshot of
        -- the ledger; this runs inside the booking transaction against the
        -- locked rows, so it is the check that actually protects the money.
        if automatic_only and (a.amount<>inv.amount-inv.paid_amount or not (
          -- The payment's symbol is the invoice's own symbol...
          nullif(ltrim(regexp_replace(coalesce(inv.variable_symbol,''),'\s','','g'),'0'),'')=nullif(ltrim(e.variable_symbol,'0'),'')
          -- ...or its number, for invoices printed without a symbol at all.
          or (nullif(trim(inv.variable_symbol),'') is null and trim(inv.invoice_number) ~ '^[0-9]+$'
            and nullif(ltrim(inv.invoice_number,'0'),'')=nullif(ltrim(e.variable_symbol,'0'),''))
          -- ...or the payer wrote the invoice number in the message, as a whole
          -- token: without the boundaries, invoice 1234 matches inside document
          -- number 091500001234567 and books a stranger's payment.
          or (trim(inv.invoice_number) ~ '^[0-9A-Za-z]{4,}$' and e.note is not null
            and e.note ~* ('(^|[^0-9A-Za-z])'||trim(inv.invoice_number)||'([^0-9A-Za-z]|$)'))
          -- ...or the payer's account is a confirmed identity for this customer
          -- AND identifies only this one customer. An account confirmed for two
          -- customers names neither, so it cannot carry an unattended booking.
          or (exists(select 1 from public.counterparty_payment_accounts c
                where c.organization_id=target_org and c.account_number=e.counterparty_account
                  and c.counterparty_ico=nullif(trim(inv.counterparty_ico),''))
            and (select count(distinct c2.counterparty_ico) from public.counterparty_payment_accounts c2
                where c2.organization_id=target_org and c2.account_number=e.counterparty_account)=1)
          -- ...or the payer's NAME agrees with the customer and the payment is
          -- not older than the invoice. Enabled deliberately by the owner. This
          -- one identifies the PAYER, never the invoice, so it rests entirely on
          -- the amount belonging to just one open invoice of theirs -- which the
          -- caller's uniqueness pass, not this check, is what establishes.
          or (private.names_match(e.counterparty_name,inv.counterparty_name)
            and (e.booked_on is null or inv.issue_date is null or e.booked_on>=inv.issue_date))
        )) then raise exception 'proposal_changed'; end if;
      end loop;
      insert into public.bank_payments(organization_id,invoice_id,external_id,booked_on,amount,currency,
        variable_symbol,counterparty_name,counterparty_account,note,match_reason,match_status,source,imported_by,matched_at)
      values(target_org,case when n=1 and total=e.amount then sole_invoice else null end,e.external_id,e.booked_on,e.amount,e.currency,
        e.variable_symbol,e.counterparty_name,e.counterparty_account,e.note,
        case when automatic_only then e.proposal_reason else null end,
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





-- Worker selection follows the engine version.
create or replace function public.run_bank_reconciliation_jobs() returns jsonb
language plpgsql security definer set search_path=public as $$
declare s record; result jsonb; results jsonb:='[]';
begin
  for s in select * from public.bank_statement_imports i where status='review'
    and (commit_requested or (automation_mode='automatic' and exists(
      select 1 from public.bank_statement_entries e where e.import_id=i.id and e.proposal_confidence='safe'
        and e.matching_version='v5' and e.bank_payment_id is null and e.disposition='accepted')))
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

-- The preview seeds allocations. _v1 still handles the single-invoice case;
-- a combination needs one allocation PER invoice, each for that invoice's whole
-- remaining balance, and is seeded only when the proposed set is completely
-- intact -- every invoice still open, same currency, and the balances summing to
-- the payment exactly. Anything less and nothing is seeded at all, which leaves
-- the row for a human rather than half-allocated.
create or replace function public.create_bank_statement_preview(target_org uuid,actor_user uuid,import_data jsonb,entry_rows jsonb)
returns jsonb language plpgsql security definer set search_path=public as $$
declare result jsonb; result_import_id uuid; s public.bank_statement_imports%rowtype;
begin
  result:=public.create_bank_statement_preview_v1(target_org,actor_user,import_data,entry_rows);
  result_import_id:=(result->>'id')::uuid;
  if not (result->>'duplicate')::boolean then
    update public.bank_statement_entries e set matching_version='v5' where e.import_id=result_import_id;

    insert into public.bank_payment_allocations(organization_id,statement_entry_id,invoice_id,amount,created_by)
    select target_org,e.id,i.id,i.amount-i.paid_amount,actor_user
    from public.bank_statement_entries e
    join public.invoices i on i.id=any(e.proposed_invoice_ids) and i.organization_id=target_org
    where e.import_id=result_import_id and e.disposition='accepted' and e.proposal_confidence='safe'
      and cardinality(e.proposed_invoice_ids)>1
      and (select count(*) from public.invoices x
             where x.id=any(e.proposed_invoice_ids) and x.organization_id=target_org
               and x.status in ('pending','overdue') and x.currency=e.currency)=cardinality(e.proposed_invoice_ids)
      and (select sum(x.amount-x.paid_amount) from public.invoices x
             where x.id=any(e.proposed_invoice_ids) and x.organization_id=target_org)=e.amount;

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
