-- Limity pokusů pro nové veřejné a polo-veřejné akce:
--   invitation_accept  přijetí pozvánky (veřejný odkaz; subjekt = otisk tokenu)
--   invitation_send    odeslání pozvánky e-mailem (subjekt = firma)
--   company_lookup     dohledání IČO v ARES během onboardingu (subjekt = účet)
-- Tělo funkce je převzaté z baseline (jediná definice), mění se jen seznam
-- povolených akcí; signatura zůstává, takže GRANT/REVOKE platí dál.

do $$
declare constraint_name text;
begin
  for constraint_name in
    select c.conname from pg_constraint c
    where c.conrelid = 'public.auth_request_events'::regclass
      and c.contype = 'c'
      and pg_get_constraintdef(c.oid) like '%password_recovery_email%'
  loop
    execute format('alter table public.auth_request_events drop constraint %I', constraint_name);
  end loop;
end $$;

alter table public.auth_request_events add constraint auth_request_events_action_known check (action in (
  'registration_access_ip', 'registration_access_email',
  'password_recovery_ip', 'password_recovery_email',
  'invitation_accept_ip', 'invitation_accept_email',
  'invitation_send_ip', 'invitation_send_email',
  'company_lookup_ip', 'company_lookup_email'
));

create or replace function consume_auth_rate_limit(
  target_action text,
  target_subject_hash text,
  target_max_attempts integer,
  target_window_seconds integer
) returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  attempts integer;
  accepted boolean;
begin
  if target_action not in (
    'registration_access_ip', 'registration_access_email',
    'password_recovery_ip', 'password_recovery_email',
    'invitation_accept_ip', 'invitation_accept_email',
    'invitation_send_ip', 'invitation_send_email',
    'company_lookup_ip', 'company_lookup_email'
  ) or target_subject_hash !~ '^[0-9a-f]{64}$'
    or target_max_attempts < 1 or target_max_attempts > 100
    or target_window_seconds < 60 or target_window_seconds > 86400 then
    raise exception 'invalid auth rate limit input';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(target_action || ':' || target_subject_hash, 0));

  select count(*) into attempts
  from public.auth_request_events
  where action = target_action
    and subject_hash = target_subject_hash
    and allowed
    and requested_at >= now() - make_interval(secs => target_window_seconds);

  accepted := attempts < target_max_attempts;
  insert into public.auth_request_events (action, subject_hash, allowed)
  values (target_action, target_subject_hash, accepted);

  delete from public.auth_request_events
  where requested_at < now() - interval '30 days';

  return accepted;
end;
$$;

revoke all on function consume_auth_rate_limit(text, text, integer, integer) from public, anon, authenticated;
grant execute on function consume_auth_rate_limit(text, text, integer, integer) to service_role;
