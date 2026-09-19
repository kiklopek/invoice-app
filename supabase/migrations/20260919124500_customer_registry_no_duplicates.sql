-- Stop the customer registry from manufacturing duplicates.
--
-- Four separate defects made the same class of junk row appear:
--
--   1. The BEFORE trigger had no column list, so EVERY invoice update re-ran
--      the upsert -- booking a payment, flipping a status, recomputing the next
--      reminder. Each one rewrote name/dic/email from whatever the invoice
--      happened to carry, so a single bad OCR pass kept reasserting itself.
--   2. The upsert wrote excluded.dic / excluded.email unconditionally, so an
--      invoice without those fields BLANKED a value a human had curated.
--   3. Nothing ever cleaned up. Correcting an invoice's ICO left the old
--      customer behind forever with zero invoices pointing at it. The sibling
--      reminder-preferences trigger already handles this; customers never did.
--   4. The registry would happily store the organization's OWN identity as a
--      customer when the supplier block was misread as the counterparty.
--
-- Deleting is deliberately narrow: only a customer with no invoices, no phone
-- and no notes. Phone and notes are never written by OCR or by this trigger,
-- so their presence is proof a human touched the row -- and a row a human
-- touched is never garbage collected, even with no invoices left.

create or replace function private.customer_is_disposable(target_customer uuid)
returns boolean language sql stable set search_path = '' as $$
  select exists (
    select 1 from public.customers c
    where c.id = target_customer
      and coalesce(c.phone, '') = ''
      and coalesce(c.notes, '') = ''
      and not exists (select 1 from public.invoices i where i.customer_id = c.id)
  );
$$;

revoke all on function private.customer_is_disposable(uuid) from public, anon, authenticated;
grant execute on function private.customer_is_disposable(uuid) to service_role;

comment on function private.customer_is_disposable(uuid) is
  'True when a customer row carries no invoices and no human-entered phone/notes, i.e. it is pure trigger residue and safe to remove.';

create or replace function remember_customer_from_invoice()
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

  -- A customer that is us is never a customer. This can only happen when the
  -- supplier block was read as the counterparty, and storing it would teach
  -- every downstream feature (matching, reminders) a false fact.
  if normalized_ico ~ '^[0-9]{8}$' and normalized_ico <> coalesce(own_ico, '') then
    insert into public.customers (
      organization_id, ico, name, dic, email, created_by, updated_by
    ) values (
      new.organization_id, normalized_ico, new.counterparty_name, new.counterparty_dic, new.counterparty_email,
      coalesce(new.created_by, new.updated_by), coalesce(new.updated_by, new.created_by)
    )
    on conflict (organization_id, ico) do update
    -- coalesce, not straight assignment: an invoice that simply does not carry
    -- a DIC or e-mail must not erase one that is already known.
    set name = coalesce(nullif(excluded.name, ''), customers.name),
        dic = coalesce(nullif(excluded.dic, ''), customers.dic),
        email = coalesce(nullif(excluded.email, ''), customers.email),
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

revoke all on function remember_customer_from_invoice() from public, anon, authenticated;
grant execute on function remember_customer_from_invoice() to service_role;

-- The column list is the point of this trigger replacement: reconciliation
-- updates (status, paid_amount, next_reminder_at) no longer touch the registry
-- at all. Only a change to the identity fields can move a customer row.
drop trigger if exists remember_customer_from_invoice_trigger on invoices;
create trigger remember_customer_from_invoice_trigger
before insert on invoices
for each row execute function remember_customer_from_invoice();

create trigger remember_customer_from_invoice_update_trigger
before update of counterparty_ico, counterparty_name, counterparty_dic, counterparty_email
on invoices
for each row execute function remember_customer_from_invoice();

-- Sweep the row an invoice just stopped pointing at.
create or replace function forget_orphaned_customer()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
declare
  stale_customer uuid := old.customer_id;
begin
  if stale_customer is null then return null; end if;
  if tg_op = 'UPDATE' and new.customer_id is not distinct from stale_customer then return null; end if;
  if private.customer_is_disposable(stale_customer) then
    delete from public.customers where id = stale_customer;
  end if;
  return null;
end;
$$;

revoke all on function forget_orphaned_customer() from public, anon, authenticated;
grant execute on function forget_orphaned_customer() to service_role;

create trigger forget_orphaned_customer_trigger
after update or delete on invoices
for each row execute function forget_orphaned_customer();

-- One-time cleanup of residue the old trigger already produced. Scoped by the
-- same disposability rule, so nothing a human filled in is at risk.
delete from customers c
where coalesce(c.phone, '') = ''
  and coalesce(c.notes, '') = ''
  and not exists (select 1 from invoices i where i.customer_id = c.id);
