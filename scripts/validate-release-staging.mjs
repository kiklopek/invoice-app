const required=['E2E_BASE_URL','NEXT_PUBLIC_SUPABASE_URL','NEXT_PUBLIC_SUPABASE_ANON_KEY','SUPABASE_SERVICE_ROLE_KEY','E2E_EMAIL','E2E_PASSWORD','E2E_MFA_EMAIL','E2E_MFA_PASSWORD'];
const missing=required.filter(name=>!process.env[name]?.trim());
if(missing.length)throw new Error(`Missing staging configuration: ${missing.join(', ')}`);
if(new URL(process.env.E2E_BASE_URL).protocol!=='https:')throw new Error('Release audit requires HTTPS staging.');
if(new URL(process.env.NEXT_PUBLIC_SUPABASE_URL).hostname==='liczsygjiuaobdzytyea.supabase.co')throw new Error('Release audit refuses the main Supabase project.');
if(process.env.E2E_ALLOW_UNAUTHENTICATED==='true' || process.env.E2E_ALLOW_ADMIN_RECOVERY!=='false')throw new Error('Release audit cannot skip authentication or use admin recovery.');
if(process.env.E2E_MFA_EMAIL.toLowerCase()==='test-admin@hlavica.cz' || process.env.E2E_MFA_EMAIL===process.env.E2E_EMAIL)throw new Error('MFA audit requires a separate ordinary staging account without the test exemption.');
console.log('Isolated HTTPS staging configured; credentials are not printed.');
