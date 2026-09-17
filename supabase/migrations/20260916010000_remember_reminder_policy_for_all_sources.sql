-- Rozsiruje pamatovani si kategorie upominek podle ICO na vsechny zdroje
-- faktury (rucni zadani, CSV import, ...), ne jen OCR.
--
-- Puvodni spoustec remember_ocr_reminder_policy() zapisoval do
-- counterparty_reminder_preferences pouze pro "new.source = 'ocr'". Rucne
-- vytvorena nebo upravena faktura tak nikdy nezanechala stopu, a ucetni
-- musela kategorii u opakovaneho odberatele vybirat pokazde znovu rucne.
-- Podminka na zdroj faktury se odstranuje -- zapamatovani ted funguje
-- shodne pro kazdou fakturu bez ohledu na to, jak vznikla.
create or replace function remember_ocr_reminder_policy()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
declare
  normalized_ico text := regexp_replace(coalesce(new.counterparty_ico, ''), '[^0-9]', '', 'g');
  previous_ico text;
begin
  if tg_op = 'UPDATE' then
    previous_ico := regexp_replace(coalesce(old.counterparty_ico, ''), '[^0-9]', '', 'g');
    if previous_ico ~ '^[0-9]{8}$' and previous_ico is distinct from normalized_ico then
      delete from public.counterparty_reminder_preferences
      where organization_id = old.organization_id
        and counterparty_ico = previous_ico
        and last_invoice_id = old.id;
    end if;
  end if;

  if normalized_ico ~ '^[0-9]{8}$'
    and new.reminder_policy_id is not null then
    insert into public.counterparty_reminder_preferences (
      organization_id, counterparty_ico, reminder_policy_id, last_invoice_id, updated_by
    ) values (
      new.organization_id, normalized_ico, new.reminder_policy_id, new.id,
      coalesce(new.updated_by, new.created_by)
    )
    on conflict (organization_id, counterparty_ico) do update
    set reminder_policy_id = excluded.reminder_policy_id,
        last_invoice_id = excluded.last_invoice_id,
        updated_by = excluded.updated_by,
        updated_at = now();
  end if;

  return new;
end;
$$;

revoke all on function remember_ocr_reminder_policy() from public, anon, authenticated;
grant execute on function remember_ocr_reminder_policy() to service_role;
