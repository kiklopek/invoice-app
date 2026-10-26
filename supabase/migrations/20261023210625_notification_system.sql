-- Company events are shared; reading one never marks it read for a colleague.
create table public.notification_events (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  event_key text not null check (length(event_key) between 1 and 240),
  type text not null check (type in ('invoice_overdue','invoice_paid','reminders_paused','payment_received','payment_review','payment_unmatched','payment_matched','reminder_sent','reminder_failed','import_failed','subscription_problem','member_changed','customer_created')),
  title text not null check (length(title) between 1 and 160),
  message text not null check (length(message) <= 600),
  entity_type text not null check (entity_type in ('invoice','payment','upload','organization','customer','statement')),
  entity_id uuid not null,
  roles text[] not null check (cardinality(roles)>0 and roles <@ array['viewer','accounting','admin']::text[]),
  created_at timestamptz not null default clock_timestamp(),
  unique(organization_id,event_key),
  unique(organization_id,id)
);
create index notification_events_feed on public.notification_events(organization_id,created_at desc,id desc);
create table public.notification_reads (
  organization_id uuid not null,
  event_id uuid not null,
  user_id uuid not null references auth.users(id) on delete cascade,
  read_at timestamptz not null default clock_timestamp(),
  primary key(user_id,organization_id,event_id),
  foreign key(organization_id,event_id) references public.notification_events(organization_id,id) on delete cascade
);
alter table public.notification_events enable row level security;
alter table public.notification_reads enable row level security;
create policy notification_events_member_read on public.notification_events for select to authenticated using (
  private.has_org_role(organization_id,roles)
);
create policy notification_reads_owner on public.notification_reads for select to authenticated using (
  user_id=(select auth.uid()) and private.is_org_member(organization_id)
);
revoke all on public.notification_events,public.notification_reads from public,anon,authenticated;
grant select on public.notification_events,public.notification_reads to authenticated;
grant all on public.notification_events,public.notification_reads to service_role;
grant select on public.organization_members,public.invoices,public.bank_payments,public.invoice_uploads,public.customers,public.bank_statement_imports to service_role;

-- Invoker RPCs are only available to the authenticated server's service client.
-- They also recheck the actor's live membership, rather than trusting JWT metadata.
create function public.notification_feed(target_org uuid,actor_user uuid,only_unread boolean default false,
  page_size integer default 8,before_time timestamptz default null,before_id uuid default null)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare actor_role text; result jsonb; cutoff timestamptz:=clock_timestamp();
begin
  select m.role into actor_role from public.organization_members m where m.organization_id=target_org and m.user_id=actor_user
    and (m.support_expires_at is null or m.support_expires_at>now());
  if actor_role is null then raise exception 'notification_access_denied' using errcode='42501'; end if;
  if page_size<1 or page_size>50 or ((before_time is null)<>(before_id is null)) then raise exception 'invalid_notification_page' using errcode='22023'; end if;
  with visible as (
    select e.*,r.read_at from public.notification_events e
    left join public.notification_reads r on r.organization_id=e.organization_id and r.event_id=e.id and r.user_id=actor_user
    where e.organization_id=target_org and actor_role=any(e.roles)
  ), page as (
    select v.* from visible v where (not only_unread or v.read_at is null)
      and (before_time is null or (v.created_at,v.id)<(before_time,before_id))
    order by v.created_at desc,v.id desc limit page_size+1
  ), selected as (select * from page order by created_at desc,id desc limit page_size)
  select jsonb_build_object(
    'items',coalesce((select jsonb_agg(jsonb_build_object(
      'id',s.id,'type',s.type,'title',s.title,'message',s.message,'created_at',s.created_at,'read_at',s.read_at,
      'href',case
        when s.entity_type='invoice' and exists(select 1 from public.invoices i where i.id=s.entity_id and i.organization_id=target_org)
          then '/invoices/'||s.entity_id
        when s.entity_type='payment' and exists(select 1 from public.bank_payments p where p.id=s.entity_id and p.organization_id=target_org) then
          case when actor_role in('admin','accounting') then '/invoices/payments/archive?highlight='||s.entity_id||'#payment-'||s.entity_id else null end
        when s.entity_type='upload' and actor_role in('admin','accounting') and exists(select 1 from public.invoice_uploads u where u.id=s.entity_id and u.organization_id=target_org) then '/invoices/import'
        when s.entity_type='customer' and exists(select 1 from public.customers c where c.id=s.entity_id and c.organization_id=target_org) then '/customers?highlight='||s.entity_id
        when s.entity_type='statement' and actor_role in('admin','accounting') and exists(select 1 from public.bank_statement_imports b where b.id=s.entity_id and b.organization_id=target_org) then '/invoices/payments'
        when s.entity_type='organization' and s.entity_id=target_org and actor_role='admin' then
          case when s.type='subscription_problem' then '/predplatne' else '/settings' end
        else null end
    ) order by s.created_at desc,s.id desc) from selected s),'[]'::jsonb),
    'unread_count',(select count(*) from visible where read_at is null),
    'total',(select count(*) from visible where not only_unread or read_at is null),
    'has_more',(select count(*)>page_size from page),
    'through',cutoff
  ) into result;
  return result;
end $$;

create function public.read_notifications(target_org uuid,actor_user uuid,event_ids uuid[] default null,through_time timestamptz default null)
returns integer language plpgsql security invoker set search_path='' as $$
declare actor_role text; changed integer;
begin
  select m.role into actor_role from public.organization_members m where m.organization_id=target_org and m.user_id=actor_user
    and (m.support_expires_at is null or m.support_expires_at>now());
  if actor_role is null then raise exception 'notification_access_denied' using errcode='42501'; end if;
  if (event_ids is null)=(through_time is null) or cardinality(event_ids)>50 then raise exception 'invalid_notification_read' using errcode='22023'; end if;
  -- Reject forged IDs instead of reporting a successful write to a foreign event.
  if event_ids is not null and exists(select 1 from unnest(event_ids) requested(id) where not exists(
    select 1 from public.notification_events e where e.id=requested.id and e.organization_id=target_org and actor_role=any(e.roles)
  )) then raise exception 'notification_access_denied' using errcode='42501'; end if;
  insert into public.notification_reads(organization_id,event_id,user_id)
    select target_org,e.id,actor_user from public.notification_events e
    where e.organization_id=target_org and actor_role=any(e.roles)
      and (case when event_ids is not null then e.id=any(event_ids) else e.created_at<=least(through_time,clock_timestamp()) end)
    on conflict do nothing;
  get diagnostics changed=row_count;
  return changed;
end $$;
revoke all on function public.notification_feed(uuid,uuid,boolean,integer,timestamptz,uuid),public.read_notifications(uuid,uuid,uuid[],timestamptz) from public,anon,authenticated;
grant execute on function public.notification_feed(uuid,uuid,boolean,integer,timestamptz,uuid),public.read_notifications(uuid,uuid,uuid[],timestamptz) to service_role;

-- Private trigger helper: constant, bounded messages, no provider diagnostics or bank accounts.
create function private.emit_notification(org uuid,key text,kind text,heading text,body text,entity text,entity_uuid uuid,audience text[])
returns void language sql security definer set search_path='' as $$
  insert into public.notification_events(organization_id,event_key,type,title,message,entity_type,entity_id,roles)
  values(org,key,kind,left(heading,160),left(body,600),entity,entity_uuid,audience)
  on conflict(organization_id,event_key) do nothing;
$$;
revoke all on function private.emit_notification(uuid,text,text,text,text,text,uuid,text[]) from public,anon,authenticated;

create function private.notify_invoice_event() returns trigger language plpgsql security definer set search_path='' as $$
declare inv public.invoices%rowtype; kind text; heading text; body text; audience text[]:=array['viewer','accounting','admin']; key text;
begin
  if new.event_type not in('overdue','paid') or coalesce((new.details->>'corrected')::boolean,false) then return new; end if;
  select * into inv from public.invoices where id=new.invoice_id and organization_id=new.organization_id;
  if not found then return new; end if;
  key:='invoice-event:'||new.id;
  if new.event_type='overdue' then
    kind:='invoice_overdue';heading:='Faktura po splatnosti';
    body:='Faktura č. '||inv.invoice_number||' je po splatnosti ('||inv.counterparty_name||').';
    key:='invoice-overdue:'||inv.id||':'||inv.due_date;
  else
    kind:='invoice_paid';heading:='Faktura uhrazena';body:='Faktura č. '||inv.invoice_number||' byla plně uhrazena ('||inv.counterparty_name||').';
  end if;
  perform private.emit_notification(new.organization_id,key,kind,heading,body,'invoice',inv.id,audience);
  return new;
exception when others then raise warning 'notification_invoice_event_failed'; return new;
end $$;
create trigger notification_invoice_event after insert on public.invoice_events for each row execute function private.notify_invoice_event();

-- Deferred until the ledger transaction finishes: do not notify transient unmatched
-- states, and let statement-level summaries represent imported rows.
create function private.notify_payment() returns trigger language plpgsql security definer set search_path='' as $$
declare payment public.bank_payments%rowtype; kind text;
begin
  select * into payment from public.bank_payments where id=new.id and organization_id=new.organization_id;
  if not found or payment.match_status not in('ambiguous','unmatched') then return new; end if;
  if exists(select 1 from public.bank_statement_entries e where e.bank_payment_id=payment.id and e.organization_id=payment.organization_id) then return new; end if;
  kind:=case payment.match_status when 'ambiguous' then 'payment_review' else 'payment_unmatched' end;
  perform private.emit_notification(payment.organization_id,'payment-attention:'||payment.id,kind,
    case kind when 'payment_review' then 'Platba vyžaduje kontrolu' else 'Nespárovaná platba' end,
    'Zaevidovaná platba '||replace(trim(to_char(payment.amount,'FM999 999 999 990.00')),'.',',')||' '||trim(payment.currency)||' vyžaduje kontrolu párování.',
    'payment',payment.id,array['accounting','admin']);
  return new;
exception when others then raise warning 'notification_payment_failed'; return new;
end $$;
create constraint trigger notification_payment after insert or update on public.bank_payments
  deferrable initially deferred for each row execute function private.notify_payment();

create function private.notify_reminder() returns trigger language plpgsql security definer set search_path='' as $$
declare kind text; heading text; key text; number text;
begin
  if tg_op='UPDATE' and new.status is not distinct from old.status and new.delivery_status is not distinct from old.delivery_status then return new; end if;
  if new.delivery_status in('bounced','complained','failed') then
    kind:='reminder_failed';heading:='Upomínka nebyla doručena';key:='reminder-delivery:'||new.id||':'||new.delivery_status;
  elsif new.status='failed' then
    kind:='reminder_failed';heading:='Odeslání upomínky selhalo';key:='reminder-failed:'||new.id||':'||new.attempt_count;
  else return new; end if;
  select invoice_number into number from public.invoices where id=new.invoice_id and organization_id=new.organization_id;
  if not found then return new; end if;
  perform private.emit_notification(new.organization_id,key,kind,heading,'Upomínka k faktuře č. '||number||' vyžaduje kontrolu v detailu faktury.',
    'invoice',new.invoice_id,array['accounting','admin']);
  return new;
exception when others then raise warning 'notification_reminder_failed'; return new;
end $$;
create trigger notification_reminder after insert or update of status,delivery_status on public.reminder_log for each row execute function private.notify_reminder();

create function private.notify_upload() returns trigger language plpgsql security definer set search_path='' as $$
begin
  if new.ocr_status='failed' and (tg_op='INSERT' or old.ocr_status is distinct from new.ocr_status) then
    perform private.emit_notification(new.organization_id,'ocr-failed:'||new.id||':'||new.ocr_attempt_count,'import_failed','Zpracování dokumentu selhalo',
      'Dokument '||new.original_name||' se nepodařilo automaticky zpracovat. Zkontrolujte import faktur.', 'upload',new.id,array['accounting','admin']);
  end if;
  return new;
exception when others then raise warning 'notification_upload_failed'; return new;
end $$;
create trigger notification_upload after insert or update of ocr_status on public.invoice_uploads for each row execute function private.notify_upload();

create function private.notify_member_event() returns trigger language plpgsql security definer set search_path='' as $$
begin
  perform private.emit_notification(new.organization_id,'member-event:'||new.id,'member_changed','Změna firemních přístupů',
    case new.event_type when 'added' then 'Byl přidán člen firmy.' when 'removed' then 'Členovi byl odebrán přístup.' else 'Byla změněna role člena firmy.' end,
    'organization',new.organization_id,array['admin']);
  return new;
exception when others then raise warning 'notification_member_failed'; return new;
end $$;
create trigger notification_member_event after insert on public.organization_member_events for each row execute function private.notify_member_event();
revoke all on function private.notify_invoice_event(),private.notify_payment(),private.notify_reminder(),private.notify_upload(),private.notify_member_event() from public,anon,authenticated;

create function private.notify_subscription() returns trigger language plpgsql security definer set search_path='' as $$
begin
  if new.status in('past_due','unpaid','paused') and (tg_op='INSERT' or old.status is distinct from new.status) then
    perform private.emit_notification(new.organization_id,'subscription:'||new.organization_id||':'||new.status||':'||coalesce(new.stripe_synced_at::text,clock_timestamp()::text),
      'subscription_problem','Předplatné vyžaduje pozornost','Zkontrolujte stav předplatného a platební údaje.','organization',new.organization_id,array['admin']);
  end if;
  return new;
exception when others then raise warning 'notification_subscription_failed'; return new;
end $$;
create trigger notification_subscription after insert or update of status on public.subscriptions for each row execute function private.notify_subscription();
revoke all on function private.notify_subscription() from public,anon,authenticated;

-- One immutable summary per statement. Deferred evaluation sees final matching,
-- including automatic booking in the same transaction, and avoids one notice per row.
create function private.notify_statement() returns trigger language plpgsql security definer set search_path='' as $$
declare statement public.bank_statement_imports%rowtype; attention integer;
begin
  select * into statement from public.bank_statement_imports where id=new.id and organization_id=new.organization_id;
  if not found or statement.status='discarded' then return new; end if;
  if statement.status='failed' then
    perform private.emit_notification(statement.organization_id,'statement-failed:'||statement.id,'import_failed','Import výpisu vyžaduje pozornost',
      'Zaúčtování bankovního výpisu se nepodařilo dokončit. Zkontrolujte párování plateb.','statement',statement.id,array['accounting','admin']);
  else
    select count(*) into attention from public.bank_statement_entries e
      left join public.bank_payments p on p.id=e.bank_payment_id and p.organization_id=e.organization_id
      where e.import_id=statement.id and e.organization_id=statement.organization_id and e.disposition='accepted' and e.unrelated_at is null
        and ((e.bank_payment_id is null and (e.proposal_confidence is distinct from 'safe' or e.processing_error is not null))
          or p.match_status in('unmatched','ambiguous'));
    if attention>0 then
      perform private.emit_notification(statement.organization_id,'statement-review:'||statement.id,'payment_review','Platby ve výpisu vyžadují kontrolu',
        'Počet plateb ke kontrole: '||attention||'. Otevřete párování bankovního výpisu.',
        'statement',statement.id,array['accounting','admin']);
    end if;
  end if;
  return new;
exception when others then raise warning 'notification_statement_failed'; return new;
end $$;
create constraint trigger notification_statement after insert or update on public.bank_statement_imports
  deferrable initially deferred for each row execute function private.notify_statement();
revoke all on function private.notify_statement() from public,anon,authenticated;
