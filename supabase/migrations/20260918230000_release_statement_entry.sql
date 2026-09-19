-- Take back a row the automation booked.
--
-- Automatic booking is only acceptable if it can be undone from the same screen
-- where it happened. The existing unassign_bank_payment_allocations reverses the
-- invoice balances but deliberately KEEPS the payment record (it is written for
-- "this payment belongs to a different invoice", not "this never happened"), and
-- that leaves a statement row in a state where nothing further is possible:
--
--   * the entry still points at the payment, so the review UI calls it booked
--     and offers no way to change the assignment;
--   * the payment's external_id still exists, so re-booking that row raises
--     'possible_duplicate';
--   * the import may have flipped to 'committed', which refuses further commits.
--
-- This clears all three, and then pins the row to 'review' so the unattended
-- pass does not immediately re-book exactly what the user just took back --
-- releasing a row IS the statement that its automatic answer was wrong.
create function public.release_statement_entry(target_org uuid, actor_user uuid, target_entry uuid)
returns jsonb language plpgsql security definer set search_path=public as $$
declare e public.bank_statement_entries%rowtype; s public.bank_statement_imports%rowtype; payment_id uuid;
begin
  if not exists(select 1 from public.organization_members
      where organization_id=target_org and user_id=actor_user and role in ('accounting','admin')) then
    raise exception 'insufficient_payment_import_permission';
  end if;
  perform pg_advisory_xact_lock(hashtextextended(target_org::text,0));
  select * into e from public.bank_statement_entries
    where id=target_entry and organization_id=target_org for update;
  if not found then raise exception 'statement_entry_not_found'; end if;
  if e.bank_payment_id is null then raise exception 'statement_entry_not_booked'; end if;
  payment_id:=e.bank_payment_id;

  -- Reuse the existing reversal: it also recomputes each invoice's status and
  -- its next reminder from the reminder policy, which must not be duplicated.
  perform public.unassign_bank_payment_allocations(target_org,payment_id,actor_user);
  -- The allocation audit trail (payment_allocation_events) already holds the
  -- deleted rows, so removing the payment record loses no history.
  delete from public.bank_payments where id=payment_id and organization_id=target_org;

  update public.bank_statement_entries set proposal_confidence='review',
    processing_error=null, processed_at=null
    where id=target_entry and organization_id=target_org;
  update public.bank_statement_imports set status='review', committed_at=null, committed_by=null,
    commit_requested=false, revision=revision+1, updated_at=now()
    where id=e.import_id and organization_id=target_org returning * into s;

  return jsonb_build_object('entry_id',target_entry,'import_id',e.import_id,
    'revision',s.revision,'status',s.status);
end $$;
revoke all on function public.release_statement_entry(uuid,uuid,uuid) from public,anon,authenticated;
grant execute on function public.release_statement_entry(uuid,uuid,uuid) to service_role;
