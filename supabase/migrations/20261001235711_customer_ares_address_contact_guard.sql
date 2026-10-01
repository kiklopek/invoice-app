-- ARES supplies the registered office; reminder contacts remain organization-owned.
alter table public.customers add column address text;

-- Invoice imports may create a contact, but a later OCR reading must never
-- replace an existing reminder address without an explicit customer edit.
create or replace function public.remember_customer_from_invoice()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
declare
  normalized_ico text := regexp_replace(coalesce(new.counterparty_ico, ''), '[^0-9]', '', 'g');
  own_ico text;
  matched_customer_id uuid;
begin
  select regexp_replace(coalesce(o.ico, ''), '[^0-9]', '', 'g') into own_ico
  from public.organizations o where o.id = new.organization_id;

  if normalized_ico ~ '^[0-9]{8}$' and normalized_ico <> coalesce(own_ico, '') then
    insert into public.customers (
      organization_id, ico, name, dic, email, created_by, updated_by
    ) values (
      new.organization_id, normalized_ico, new.counterparty_name, new.counterparty_dic, new.counterparty_email,
      coalesce(new.created_by, new.updated_by), coalesce(new.updated_by, new.created_by)
    )
    on conflict (organization_id, ico) do update
    set name = coalesce(nullif(excluded.name, ''), customers.name),
        dic = coalesce(nullif(excluded.dic, ''), customers.dic),
        email = coalesce(nullif(customers.email, ''), nullif(excluded.email, '')),
        updated_by = coalesce(excluded.updated_by, customers.updated_by),
        updated_at = now()
    returning id into matched_customer_id;
    new.customer_id := matched_customer_id;
  else
    new.customer_id := null;
  end if;

  return new;
end;
$$;

revoke all on function public.remember_customer_from_invoice() from public, anon, authenticated;
grant execute on function public.remember_customer_from_invoice() to service_role;
