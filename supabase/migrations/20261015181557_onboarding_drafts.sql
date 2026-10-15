-- Drafts belong to an authenticated person, not a company that does not exist yet.
-- Access goes through the API's verified session/MFA and server-selected user_id.
create table public.onboarding_drafts (
  user_id uuid primary key references auth.users(id) on delete cascade,
  payload jsonb not null check (jsonb_typeof(payload) = 'object' and octet_length(payload::text) <= 800000),
  updated_at timestamptz not null default now()
);
alter table public.onboarding_drafts enable row level security;
revoke all on public.onboarding_drafts from public, anon, authenticated;
grant select, insert, update, delete on public.onboarding_drafts to service_role;
comment on table public.onboarding_drafts is 'Private pre-company onboarding state; service-only, scoped to the verified user by the API.';

-- A late autosave/pagehide request must not overwrite a newer snapshot.
create function public.keep_newer_onboarding_draft() returns trigger
language plpgsql set search_path = '' as $$
begin
  if coalesce((new.payload->>'updatedAt')::numeric, 0) < coalesce((old.payload->>'updatedAt')::numeric, 0) then
    return null;
  end if;
  return new;
end;
$$;
revoke all on function public.keep_newer_onboarding_draft() from public, anon, authenticated;
grant execute on function public.keep_newer_onboarding_draft() to service_role;
create trigger onboarding_draft_newer before update on public.onboarding_drafts
  for each row execute function public.keep_newer_onboarding_draft();
