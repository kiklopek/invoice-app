\set ON_ERROR_STOP on
-- Fáze F1a přestavby databáze: každý cizí klíč má index a technické záznamy
-- se po době uchování mažou. Účetní data, audit ani nic s penězi se nemaže.
begin;
do $$
declare missing text; result jsonb; u uuid := '00000000-0000-4000-8000-0000000000f1';
begin
  -- 1. Každý cizí klíč v public má index začínající jeho sloupci.
  select string_agg(c.conrelid::regclass || '.' || c.conname, ', ') into missing
  from pg_constraint c
  where c.contype = 'f' and c.connamespace = 'public'::regnamespace
    and not exists (select 1 from pg_index i where i.indrelid = c.conrelid
      and (i.indkey::int2[])[0:cardinality(c.conkey) - 1] @> c.conkey
      and c.conkey @> (i.indkey::int2[])[0:cardinality(c.conkey) - 1]);
  if missing is not null then raise exception 'Foreign keys without an index: %', missing; end if;

  -- 2. Mazání spustí jen serverová role.
  if has_function_privilege('anon', 'private.apply_retention()', 'EXECUTE')
    or has_function_privilege('authenticated', 'private.apply_retention()', 'EXECUTE') then
    raise exception 'apply_retention is executable by a client role';
  end if;
  if not has_function_privilege('service_role', 'private.apply_retention()', 'EXECUTE') then
    raise exception 'service_role cannot run apply_retention';
  end if;

  -- 3. Staré záznamy zmizí, čerstvé zůstanou.
  insert into auth.users(id, email) values (u, 'retention@example.invalid');
  insert into public.email_mfa_challenges(id, user_id, session_id, code_hash, expires_at, created_at) values
    (gen_random_uuid(), u, gen_random_uuid(), repeat('a', 64), now() - interval '2 days', now() - interval '2 days'),
    (gen_random_uuid(), u, gen_random_uuid(), repeat('b', 64), now() + interval '5 minutes', now());
  insert into public.provider_webhook_events(event_id, event_type, provider_message_id, event_at, received_at) values
    ('old-evt', 'email.delivered', 'm1', now() - interval '100 days', now() - interval '100 days'),
    ('new-evt', 'email.delivered', 'm2', now(), now());
  insert into public.stripe_events(id, type, received_at) values
    ('evt_old', 'invoice.paid', now() - interval '100 days'), ('evt_new', 'invoice.paid', now());
  insert into public.onboarding_drafts(user_id, payload, updated_at) values (u, '{}', now() - interval '100 days');

  result := private.apply_retention();
  if (select count(*) from public.email_mfa_challenges where user_id = u) <> 1
    or not exists (select 1 from public.email_mfa_challenges where code_hash = repeat('b', 64)) then
    raise exception 'MFA retention wrong: %', result;
  end if;
  if exists (select 1 from public.provider_webhook_events where event_id = 'old-evt')
    or not exists (select 1 from public.provider_webhook_events where event_id = 'new-evt') then
    raise exception 'Webhook retention wrong: %', result;
  end if;
  if exists (select 1 from public.stripe_events where id = 'evt_old')
    or not exists (select 1 from public.stripe_events where id = 'evt_new') then
    raise exception 'Stripe retention wrong: %', result;
  end if;
  if exists (select 1 from public.onboarding_drafts where user_id = u) then
    raise exception 'Stale onboarding draft kept: %', result;
  end if;
  if (result->>'email_mfa_challenges')::int <> 1 or (result->>'stripe_events')::int <> 1 then
    raise exception 'Retention counts wrong: %', result;
  end if;
end $$;
rollback;
