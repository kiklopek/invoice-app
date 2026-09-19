-- Reports has no view of bank-payment matching quality or import history
-- over time (the GPC import archive is a raw flat list, no aggregation).
-- Mirrors invoice_report_summary's pattern: one security-definer RPC doing
-- all aggregation in SQL, returning a single jsonb blob for the reports page.
--
-- Note on the auto_matched/needs_review split: bank_statement_entries.
-- proposal_confidence is written once at import-preview time and is never
-- updated by the later manual-review step (save_bank_statement_allocations
-- only writes to bank_payment_allocations). So this reflects the quality of
-- the SYSTEM'S ORIGINAL PROPOSAL, not whether the accountant later changed
-- it -- an honest, simpler metric than diffing final allocations against
-- proposed_invoice_ids, which is left as a possible future refinement.
create or replace function payment_reconciliation_summary(
  target_org uuid, actor_user uuid, report_from date, report_to date
) returns jsonb language plpgsql security definer set search_path = public
as $$
declare result jsonb;
begin
  if not exists (select 1 from organization_members where organization_id = target_org and user_id = actor_user) then raise exception 'insufficient_permission'; end if;
  if report_from > report_to then raise exception 'invalid_period'; end if;

  with committed_imports as materialized (
    select * from bank_statement_imports
    where organization_id = target_org and status = 'committed'
      and committed_at is not null
      and (committed_at at time zone 'Europe/Prague')::date between report_from and report_to
  ), entry_stats as (
    select
      bse.import_id,
      count(*) filter (where bse.disposition = 'accepted') as accepted,
      count(*) filter (where bse.disposition = 'accepted' and bse.proposal_confidence = 'safe') as auto_matched,
      count(*) filter (where bse.disposition = 'accepted' and (bse.proposal_confidence = 'review' or bse.proposal_confidence is null)) as needs_review
    from bank_statement_entries bse
    where bse.organization_id = target_org
      and bse.import_id in (select id from committed_imports)
    group by bse.import_id
  ), per_import as (
    select ci.id, ci.original_filename, ci.committed_at, ci.accepted_count, ci.ignored_count, ci.error_count,
      coalesce(es.auto_matched, 0) as auto_matched, coalesce(es.needs_review, 0) as needs_review
    from committed_imports ci
    left join entry_stats es on es.import_id = ci.id
  ), monthly_values as (
    select to_char(committed_at at time zone 'Europe/Prague', 'YYYY-MM') as month_key,
      count(distinct id) as imports,
      sum(accepted_count) as accepted,
      sum(auto_matched) as auto_matched,
      sum(needs_review) as needs_review
    from per_import group by 1
  )
  select jsonb_build_object(
    'totals', jsonb_build_object(
      'imports', (select count(*) from per_import),
      'accepted', coalesce((select sum(accepted_count) from per_import), 0),
      'auto_matched', coalesce((select sum(auto_matched) from per_import), 0),
      'needs_review', coalesce((select sum(needs_review) from per_import), 0),
      'unmatched_payments', coalesce((
        select count(*) from bank_payments
        where organization_id = target_org and match_status = 'unmatched'
          and booked_on between report_from and report_to
      ), 0)
    ),
    'monthly', coalesce((
      select jsonb_agg(jsonb_build_object(
        'key', month_key, 'imports', imports, 'accepted', accepted,
        'auto_matched', auto_matched, 'needs_review', needs_review
      ) order by month_key)
      from monthly_values
    ), '[]'::jsonb),
    'recent_imports', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', id, 'filename', original_filename, 'committed_at', committed_at,
        'accepted_count', accepted_count, 'ignored_count', ignored_count, 'error_count', error_count,
        'auto_matched', auto_matched, 'needs_review', needs_review
      ) order by committed_at desc)
      from (select * from per_import order by committed_at desc limit 10) r
    ), '[]'::jsonb)
  ) into result;
  return result;
end;
$$;

revoke all on function payment_reconciliation_summary(uuid, uuid, date, date) from public, anon, authenticated;
grant execute on function payment_reconciliation_summary(uuid, uuid, date, date) to service_role;
