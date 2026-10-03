import { spawnSync } from "node:child_process";
import { describe,expect,it } from "vitest";
const env={PATH:process.env.PATH,SystemRoot:process.env.SystemRoot,E2E_BASE_URL:"https://staging.example.invalid",NEXT_PUBLIC_SUPABASE_URL:"https://isolated.supabase.co",NEXT_PUBLIC_SUPABASE_ANON_KEY:"fixture",SUPABASE_SERVICE_ROLE_KEY:"fixture",E2E_EMAIL:"test-admin@hlavica.cz",E2E_PASSWORD:"fixture",E2E_MFA_EMAIL:"ordinary@hlavica.cz",E2E_MFA_PASSWORD:"fixture",E2E_ALLOW_UNAUTHENTICATED:"false",E2E_ALLOW_ADMIN_RECOVERY:"false"};
const check=(overrides: Record<string,string|undefined>)=>spawnSync(process.execPath,["scripts/validate-release-staging.mjs"],{env:{...env,...overrides,NODE_ENV:"test"},encoding:"utf8"});
describe("release staging gate",()=>{
  it("accepts only explicit isolated HTTPS credentials",()=>{expect(check({}).status).toBe(0);});
  it("refuses the main project before any browser test can write",()=>{const result=check({NEXT_PUBLIC_SUPABASE_URL:"https://liczsygjiuaobdzytyea.supabase.co"});expect(result.status).not.toBe(0);expect(result.stderr).toContain("refuses the main");});
  it("refuses missing credentials, HTTP and MFA-exempt ordinary users",()=>{
    expect(check({E2E_PASSWORD:undefined}).status).not.toBe(0);
    expect(check({E2E_BASE_URL:"http://127.0.0.1:3000"}).status).not.toBe(0);
    expect(check({E2E_MFA_EMAIL:"test-admin@hlavica.cz"}).status).not.toBe(0);
  });
  it("refuses silent skips and admin-created recovery sessions",()=>{
    expect(check({E2E_ALLOW_UNAUTHENTICATED:"true"}).status).not.toBe(0);
    expect(check({E2E_ALLOW_ADMIN_RECOVERY:"true"}).status).not.toBe(0);
  });
});
