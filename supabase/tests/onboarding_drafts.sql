begin;
insert into auth.users(id, email) values
  ('b6432602-8c36-4d31-a918-2f3588af7c14', 'draft-test@example.invalid'),
  ('c6432602-8c36-4d31-a918-2f3588af7c14', 'other-draft@example.invalid');
set local role service_role;
insert into public.onboarding_drafts(user_id, payload) values
  ('b6432602-8c36-4d31-a918-2f3588af7c14', '{"step":4,"updatedAt":200}'),
  ('c6432602-8c36-4d31-a918-2f3588af7c14', '{"step":2,"updatedAt":100}');
update public.onboarding_drafts set payload='{"step":1,"updatedAt":100}' where user_id='b6432602-8c36-4d31-a918-2f3588af7c14';
do $$ begin
  if (select payload->>'step' from public.onboarding_drafts where user_id='b6432602-8c36-4d31-a918-2f3588af7c14') <> '4' then raise exception 'Stale autosave replaced newer progress'; end if;
end $$;
set local role authenticated;
do $$ begin
  begin
    perform * from public.onboarding_drafts;
    raise exception 'Draft data was exposed without MFA/API authorization';
  exception when insufficient_privilege then null;
  end;
end $$;
reset role;
delete from auth.users where id='b6432602-8c36-4d31-a918-2f3588af7c14';
do $$ begin
  if exists(select from public.onboarding_drafts where user_id='b6432602-8c36-4d31-a918-2f3588af7c14') then raise exception 'Deleted account retained its draft'; end if;
  if not exists(select from public.onboarding_drafts where user_id='c6432602-8c36-4d31-a918-2f3588af7c14') then raise exception 'Another account lost its draft'; end if;
end $$;
rollback;
