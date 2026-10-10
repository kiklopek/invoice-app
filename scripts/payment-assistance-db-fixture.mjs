import { readFile, readdir } from 'node:fs/promises';
export const bootstrap = `
  create role anon; create role authenticated; create role service_role bypassrls;
  create schema auth; create schema storage; create schema extensions;
  create table auth.users(id uuid primary key, email text, raw_user_meta_data jsonb default '{}');
  create function auth.uid() returns uuid language sql as $$ select null::uuid $$;
  create function auth.role() returns text language sql as $$ select 'service_role'::text $$;
  create function auth.jwt() returns jsonb language sql as $$ select '{}'::jsonb $$;
  create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);
  create table storage.objects(id uuid primary key default gen_random_uuid(),bucket_id text,name text,owner uuid);
  create function storage.foldername(text) returns text[] language sql as $$ select string_to_array($1,'/') $$;
`;
export async function replayMigrations(exec, withoutPgcrypto = false) {
  await exec(bootstrap);
  for (const name of (await readdir('supabase/migrations')).filter(n => n.endsWith('.sql')).sort()) {
    let sql = await readFile(`supabase/migrations/${name}`, 'utf8');
    if (withoutPgcrypto) sql = sql.replace(/create extension if not exists pgcrypto(?: with schema \w+)?;/gi, '');
    try { await exec(sql); }
    catch (error) { console.error('Migration failed:', name); throw error; }
  }
}
export async function runSqlRegressions(exec) {
  for (const name of ['robust_reconciliation.sql','reconciliation_integrity_guards.sql','payment_assistance.sql','camt_statement_evidence.sql','release_security_permissions.sql','customer_email_edit.sql','organization_onboarding.sql','stripe_billing.sql','multi_tenant_guards.sql','billing_exempt.sql','auto_booking_policy.sql']) {
    const sql = (await readFile(`supabase/tests/${name}`, 'utf8')).replace(/^\\.*$/gm, '');
    await exec(sql);
    console.log(`Passed ${name}`);
  }
}
