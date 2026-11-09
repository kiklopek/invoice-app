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
where recorded_at > now() - interval '14 days';
