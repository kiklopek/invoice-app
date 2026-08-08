create table email_mfa_challenges (
  id uuid primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  session_id uuid not null,
  code_hash text not null check (code_hash ~ '^[a-f0-9]{64}$'),
  expires_at timestamptz not null,
  attempts smallint not null default 0 check (attempts between 0 and 5),
  consumed_at timestamptz,
  created_at timestamptz not null default now()
);

create index email_mfa_challenges_user_session_created
  on email_mfa_challenges (user_id, session_id, created_at desc);

alter table email_mfa_challenges enable row level security;
revoke all on email_mfa_challenges from public, anon, authenticated;
grant select, insert, update, delete on email_mfa_challenges to service_role;

create or replace function create_email_mfa_challenge(
  target_challenge uuid,
  target_user uuid,
  target_session uuid,
  target_code_hash text,
  target_expires_at timestamptz
) returns text
language plpgsql
security definer
set search_path = public
as $$
begin
  perform pg_advisory_xact_lock(hashtextextended(target_user::text || ':' || target_session::text, 0));

  if exists (
    select 1 from email_mfa_challenges
    where user_id = target_user
      and created_at > now() - interval '60 seconds'
  ) then
    return 'rate_limited';
  end if;

  update email_mfa_challenges
  set consumed_at = coalesce(consumed_at, now())
  where user_id = target_user
    and session_id = target_session
    and consumed_at is null;

  insert into email_mfa_challenges (
    id, user_id, session_id, code_hash, expires_at
  ) values (
    target_challenge, target_user, target_session, target_code_hash, target_expires_at
  );

  return 'created';
end;
$$;

create or replace function verify_email_mfa_challenge(
  target_challenge uuid,
  target_user uuid,
  target_session uuid,
  candidate_hash text
) returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  challenge email_mfa_challenges%rowtype;
begin
  select * into challenge
  from email_mfa_challenges
  where id = target_challenge
    and user_id = target_user
    and session_id = target_session
  for update;

  if not found or challenge.consumed_at is not null then
    return 'not_found';
  end if;

  if challenge.expires_at <= now() then
    update email_mfa_challenges set consumed_at = now() where id = challenge.id;
    return 'expired';
  end if;

  if challenge.attempts >= 5 then
    update email_mfa_challenges set consumed_at = now() where id = challenge.id;
    return 'locked';
  end if;

  if challenge.code_hash <> candidate_hash then
    update email_mfa_challenges
    set attempts = attempts + 1,
        consumed_at = case when attempts + 1 >= 5 then now() else consumed_at end
    where id = challenge.id;
    return 'invalid';
  end if;

  update email_mfa_challenges set consumed_at = now() where id = challenge.id;
  return 'verified';
end;
$$;

revoke all on function create_email_mfa_challenge(uuid, uuid, uuid, text, timestamptz) from public, anon, authenticated;
revoke all on function verify_email_mfa_challenge(uuid, uuid, uuid, text) from public, anon, authenticated;
grant execute on function create_email_mfa_challenge(uuid, uuid, uuid, text, timestamptz) to service_role;
grant execute on function verify_email_mfa_challenge(uuid, uuid, uuid, text) to service_role;
