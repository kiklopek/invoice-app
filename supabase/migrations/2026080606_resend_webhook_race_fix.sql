-- Retry stejného webhook ID musí znovu zkusit párování, pokud webhook předběhl zápis odeslání.
create or replace function process_resend_delivery_event(
  webhook_event_id text, webhook_event_type text, message_id text, event_time timestamptz, event_error text
) returns jsonb language plpgsql security definer set search_path = public
as $$
declare target_log reminder_log%rowtype; normalized_status text; was_duplicate boolean;
begin
  if webhook_event_type not in ('email.sent', 'email.delivered', 'email.delivery_delayed', 'email.bounced', 'email.complained', 'email.failed')
    or length(webhook_event_id) not between 1 and 200 or length(message_id) not between 1 and 200 then
    raise exception 'invalid resend webhook event';
  end if;
  insert into provider_webhook_events (event_id, event_type, provider_message_id, event_at)
  values (webhook_event_id, webhook_event_type, message_id, event_time) on conflict (event_id) do nothing;
  was_duplicate := not found;
  normalized_status := case webhook_event_type when 'email.sent' then 'accepted' when 'email.delivered' then 'delivered'
    when 'email.delivery_delayed' then 'delayed' when 'email.bounced' then 'bounced'
    when 'email.complained' then 'complained' when 'email.failed' then 'failed' end;
  select * into target_log from reminder_log where provider_message_id = message_id order by created_at desc limit 1 for update;
  if not found then return jsonb_build_object('duplicate', was_duplicate, 'matched', false); end if;
  if target_log.delivery_event_at is null or event_time >= target_log.delivery_event_at then
    update reminder_log set delivery_status = normalized_status, delivery_event_at = event_time,
      delivered_at = case when webhook_event_type = 'email.delivered' then event_time else delivered_at end,
      delivery_error = case when webhook_event_type in ('email.bounced', 'email.complained', 'email.failed', 'email.delivery_delayed')
        then nullif(left(coalesce(event_error, ''), 1000), '') else null end,
      updated_at = now() where id = target_log.id;
  end if;
  if webhook_event_type in ('email.bounced', 'email.complained') then
    insert into email_suppressions (organization_id, email, reason, provider_message_id, last_event_at)
    values (target_log.organization_id, lower(target_log.sent_to), case when webhook_event_type = 'email.bounced' then 'bounced' else 'complained' end, message_id, event_time)
    on conflict (organization_id, email) do update set
      reason = case when excluded.last_event_at >= email_suppressions.last_event_at then excluded.reason else email_suppressions.reason end,
      provider_message_id = case when excluded.last_event_at >= email_suppressions.last_event_at then excluded.provider_message_id else email_suppressions.provider_message_id end,
      last_event_at = greatest(email_suppressions.last_event_at, excluded.last_event_at);
  end if;
  return jsonb_build_object('duplicate', was_duplicate, 'matched', true, 'log_id', target_log.id);
end;
$$;

revoke all on function process_resend_delivery_event(text, text, text, timestamptz, text) from public, anon, authenticated;
grant execute on function process_resend_delivery_event(text, text, text, timestamptz, text) to service_role;
