-- Ruční odeslání faktury e-mailem (POST /api/invoices/[id]/send) posílá
-- odběrateli skutečnou zprávu, ale nikam se nezapisovalo. V aktivitě faktury
-- tedy nebylo vidět, že už kontakt proběhl, a účetní mohla poslat podruhé.
--
-- Záznam patří do invoice_events, ne do reminder_log. Do reminder_log ho dát
-- nelze, aniž by hrozilo tiché potlačení naplánované upomínky, a to ze dvou
-- nezávislých důvodů:
--
--   1. unique (invoice_id, stage, scheduled_for) by ruční záznam nechal
--      obsadit slot, do kterého se má později zapsat automatická upomínka;
--   2. decideReminderAction() klíčuje existující záznamy podle scheduled_for,
--      takže řádek se stavem 'sent' na datum z rozvrhu vyhodnotí fázi jako
--      vyřízenou a automatickou upomínku vůbec nenaplánuje.
--
-- Obojí by se projevilo až u zákazníka tím, že upomínka nedorazila. Navíc by
-- zrušení toho unique rozbilo schedule_reminder_jobs(), která se na něj
-- opírá klauzulí on conflict (invoice_id, stage, scheduled_for).
--
-- invoice_events naproti tomu žádný unique ani on conflict nemá, čte ho už
-- dnes detail faktury i /api/invoices/[id]/activity, a jako jediná z těch
-- dvou tabulek nese autora akce -- u ručního odeslání je to ta podstatná
-- informace. Změna je proto čistě aditivní: rozšíření výčtu event_type.

alter table invoice_events
  drop constraint if exists invoice_events_event_type_check;

alter table invoice_events
  add constraint invoice_events_event_type_check check (event_type in (
    'created', 'updated', 'paid', 'reopened', 'cancelled', 'overdue',
    'reminders_paused', 'reminders_resumed', 'payment_changed',
    -- Ruční odeslání faktury e-mailem z detailu faktury. Do details se
    -- ukládá adresa příjemce, aby šlo dohledat, komu zpráva odešla.
    'emailed'
  ));
