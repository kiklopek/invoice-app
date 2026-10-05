-- Customer contact and open invoice recipients are one atomic change.
create or replace function public.update_customer_contact(
  target_org uuid, actor_user uuid, target_customer uuid,
  change_email boolean default false, new_email text default null,
  change_phone boolean default false, new_phone text default null
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  contact public.customers%rowtype;
  normalized_email text := lower(btrim(new_email));
  changed_invoices integer := 0;
begin
  if not exists (
    select 1 from public.organization_members m
    where m.organization_id = target_org and m.user_id = actor_user
      and m.role in ('admin', 'accounting')
  ) then
    raise exception 'Customer edit not permitted' using errcode = '42501';
  end if;
  if change_email and (normalized_email is null or length(normalized_email) > 254
      or normalized_email !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$') then
    raise exception 'Invalid customer email' using errcode = '22023';
  end if;

  -- Invoice edits lock an invoice before their registry trigger locks the
  -- customer. Follow the same order to avoid a contact/edit deadlock.
  if change_email then
    perform 1 from public.invoices i
    where i.organization_id = target_org and i.customer_id = target_customer
    order by i.id for update;
  end if;
  select * into contact from public.customers c
  where c.id = target_customer and c.organization_id = target_org for update;
  if not found then return null; end if;

  update public.customers c
  set email = case when change_email then normalized_email else c.email end,
      phone = case when change_phone then nullif(left(btrim(new_phone), 40), '') else c.phone end,
      updated_by = actor_user, updated_at = now()
  where c.id = target_customer and c.organization_id = target_org
  returning * into contact;

  if change_email then
    update public.invoices i
    set counterparty_email = normalized_email, updated_by = actor_user, updated_at = now()
    where i.organization_id = target_org and i.customer_id = target_customer
      and i.status in ('pending', 'overdue')
      and i.counterparty_email is distinct from normalized_email;
    get diagnostics changed_invoices = row_count;
  end if;
  return jsonb_build_object('customer', jsonb_build_object(
    'id', contact.id, 'email', contact.email, 'phone', contact.phone
  ), 'updated_invoice_count', changed_invoices);
end;
$$;

revoke all on function public.update_customer_contact(uuid, uuid, uuid, boolean, text, boolean, text) from public, anon, authenticated;
grant execute on function public.update_customer_contact(uuid, uuid, uuid, boolean, text, boolean, text) to service_role;
