-- Brána každé fáze přestavby databáze (docs: návrh přestavby, sekce Postup přechodu).
-- Jen čtení. Spustit nad produkcí před a po každé migraci; každý řádek výsledku
-- musí mít violations = 0, jinak se fáze zastaví a rozdíly se ukážou ke kontrole.
-- Ověřeno 9. 11. 2026: všech 47 faktur a 34 plateb bez rozdílu.
with alloc as (
  select invoice_id, sum(amount) filter (where is_committed) as committed
  from public.bank_payment_allocations group by invoice_id
)
select 'invoice paid_amount = committed allocations' as invariant,
       count(*) filter (where coalesce(a.committed, 0) <> i.paid_amount) as violations
from public.invoices i left join alloc a on a.invoice_id = i.id
union all
select 'payment linked the old way has an allocation',
       count(*) from public.bank_payments p
where p.invoice_id is not null
  and not exists (select 1 from public.bank_payment_allocations x where x.bank_payment_id = p.id)
union all
select 'allocation within its payment amount',
       count(*) from (
         select x.bank_payment_id from public.bank_payment_allocations x
         join public.bank_payments p on p.id = x.bank_payment_id
         where x.is_committed group by x.bank_payment_id, p.amount
         having sum(x.amount) > p.amount
       ) over_allocated
union all
select 'paid_amount within invoice amount',
       count(*) from public.invoices where paid_amount > amount
union all
select 'allocation and invoice belong to the same organization',
       count(*) from public.bank_payment_allocations x
       join public.invoices i on i.id = x.invoice_id
where i.organization_id <> x.organization_id
union all
-- Od fáze F2: hlídač zápisů. Brána F2 = 0 po dobu 14 dní, teprve pak contract.
select 'money guard violations in the last 14 days',
       count(*) from public.money_guard_violations
where recorded_at > now() - interval '14 days'
union all
-- Od fáze F3: stav upomínek ve vlastní tabulce se shoduje s fakturou.
select 'invoice reminder state matches the invoice',
       count(*) from public.invoices i left join public.invoice_reminder_state s on s.invoice_id = i.id
where s.invoice_id is null or s.reminders_sent <> i.reminders_sent or s.paused <> i.reminders_paused
   or s.next_reminder_at is distinct from i.next_reminder_at or s.last_reminder_at is distinct from i.last_reminder_at
union all
select 'invoice document matches the invoice',
       count(*) from public.invoices i left join public.invoice_documents d on d.invoice_id = i.id and d.is_current
where (i.file_url is not null or i.money_evidence is not null)
  and (d.id is null or d.storage_path is distinct from i.file_url or d.money_evidence is distinct from i.money_evidence);
-- Informativní (nemusí být 0, ukazuje práci před contract krokem F3):
--   select count(*) from public.invoices where customer_id is null;
--   select count(*) from public.counterparty_payment_accounts where customer_id is null;
--   select count(*) from public.counterparty_reminder_preferences where customer_id is null;
