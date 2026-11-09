\set ON_ERROR_STOP on
-- Fáze F4 přestavby databáze (expand): jedna fronta úloh místo pěti vlastních.
begin;
do $$
declare
  org uuid := '00000000-0000-4000-8000-0000000004f1';
  first_id bigint; again_id bigint; claimed jsonb; lease uuid; job record; failed text;
begin
  if to_regclass('public.jobs') is null then raise exception 'jobs table is missing'; end if;
  if has_table_privilege('authenticated', 'public.jobs', 'SELECT') or has_function_privilege('authenticated', 'public.enqueue_job(text, uuid, jsonb, text, integer, timestamptz)', 'EXECUTE')
    or has_function_privilege('anon', 'public.claim_jobs(text, integer, interval)', 'EXECUTE') then
    raise exception 'client roles can use the job queue';
  end if;
  insert into public.organizations(id, name, ico) values (org, 'Jobs test s.r.o.', '27074358');

  -- 1. Stejný dedupe_key zařadí úlohu jen jednou (žádné dvojí odeslání).
  first_id := public.enqueue_job('invoice.email', org, '{"invoice":"a"}', 'invoice.email:a', 3, null);
  again_id := public.enqueue_job('invoice.email', org, '{"invoice":"a"}', 'invoice.email:a', 3, null);
  if first_id is distinct from again_id or (select count(*) from public.jobs where dedupe_key = 'invoice.email:a') <> 1 then
    raise exception 'duplicate job enqueued';
  end if;
  perform public.enqueue_job('invoice.email', org, '{"invoice":"later"}', 'invoice.email:later', 3, now() + interval '1 hour');
  perform public.enqueue_job('ocr.extract', org, '{}', 'ocr:x', 3, null);

  -- 2. Vyzvednutí bere jen splatné úlohy daného typu a zamkne je.
  claimed := public.claim_jobs('invoice.email', 10, interval '5 minutes');
  if jsonb_array_length(claimed) <> 1 or (claimed->0->>'id')::bigint <> first_id then raise exception 'wrong jobs claimed: %', claimed; end if;
  lease := (claimed->0->>'lease_token')::uuid;
  if jsonb_array_length(public.claim_jobs('invoice.email', 10, interval '5 minutes')) <> 0 then raise exception 'a leased job was claimed twice'; end if;

  -- 3. Chyba odloží další pokus s rostoucí prodlevou; po posledním pokusu je úloha dead.
  perform public.fail_job(first_id, lease, 'smtp timeout');
  select * into job from public.jobs where id = first_id;
  if job.status <> 'queued' or job.attempts <> 1 or job.available_at <= now() or job.last_error <> 'smtp timeout' then
    raise exception 'retry not scheduled: %', to_jsonb(job);
  end if;
  update public.jobs set available_at = now() - interval '1 second' where id = first_id;
  lease := (public.claim_jobs('invoice.email', 1, interval '5 minutes')->0->>'lease_token')::uuid;
  perform public.fail_job(first_id, lease, 'smtp timeout');
  update public.jobs set available_at = now() - interval '1 second' where id = first_id;
  lease := (public.claim_jobs('invoice.email', 1, interval '5 minutes')->0->>'lease_token')::uuid;
  perform public.fail_job(first_id, lease, 'smtp timeout');
  if (select status from public.jobs where id = first_id) <> 'dead' then raise exception 'job not dead after max attempts'; end if;

  -- 4. Cizí nebo propadlý zámek úlohu nedokončí.
  lease := (public.claim_jobs('ocr.extract', 1, interval '5 minutes')->0->>'lease_token')::uuid;
  failed := null;
  begin
    perform public.complete_job((select id from public.jobs where dedupe_key = 'ocr:x'), gen_random_uuid());
  exception when others then failed := sqlerrm;
  end;
  if failed is distinct from 'job_lease_lost' then raise exception 'foreign lease completed a job: %', failed; end if;
  perform public.complete_job((select id from public.jobs where dedupe_key = 'ocr:x'), lease);
  if (select status from public.jobs where dedupe_key = 'ocr:x') <> 'done' then raise exception 'job not completed'; end if;
end $$;
rollback;
