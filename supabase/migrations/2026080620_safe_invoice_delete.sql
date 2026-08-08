create or replace function delete_invoice_safely(
  target_org uuid,
  target_invoice uuid,
  actor_user uuid
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  selected_invoice invoices%rowtype;
  detached_payments integer := 0;
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

  update bank_payments
  set invoice_id = null,
      match_status = 'unmatched',
      matched_at = null,
      unmatched_at = now(),
      unmatched_by = actor_user
  where organization_id = target_org
    and invoice_id = target_invoice;
  get diagnostics detached_payments = row_count;

  delete from invoices
  where id = target_invoice and organization_id = target_org;

  return jsonb_build_object(
    'invoice_id', target_invoice,
    'file_url', selected_invoice.file_url,
    'detached_payments', detached_payments
  );
end;
$$;

revoke all on function delete_invoice_safely(uuid, uuid, uuid) from public, anon, authenticated;
grant execute on function delete_invoice_safely(uuid, uuid, uuid) to service_role;
