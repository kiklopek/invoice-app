import { mkdir, writeFile, readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";
export async function startHarness(sourceRoot, label, port) {
  const project = process.cwd(),
    dir = resolve(".cache/responsive-audit", label);
  await mkdir(dir, { recursive: true });
  const files = {
    "index.html":
      '<!doctype html><html lang="cs"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><div id="root"></div><script type="module" src="/entry.tsx"></script></html>',
    "link.tsx": `import{createElement}from'react';export default function Link({children,prefetch:_p,replace:_r,scroll:_s,...props}){return createElement('a',props,children)}`,
    "image.tsx": `import{createElement}from'react';export default function Image({priority:_p,preload:_pr,fill:_f,unoptimized:_u,...props}){return createElement('img',props)}`,
    "navigation.tsx": `export function usePathname(){return location.pathname}export function useSearchParams(){return new URLSearchParams(location.search)}export function useRouter(){return{push:url=>{window.__AUDIT_NAVIGATION__=url},replace:url=>{window.__AUDIT_NAVIGATION__=url},prefetch:()=>{},refresh:()=>{}}}export function redirect(url){throw new Error('Unexpected server redirect in presentation harness: '+url)}`,
    "font.ts": `export function Inter(){return{className:'audit-auth-font'}}`,
    "supabase.ts": `export {hasSupabaseBrowserConfig}from'./config';export const createClient=()=>({auth:{getUser:async()=>({data:{user:{id:'audit-user'}}}),signInWithPassword:async()=>({data:{session:null},error:{message:'Kontrolovaná testovací chyba přihlášení'}}),updateUser:async()=>({error:{message:'Žádná skutečná změna hesla v auditu'}}),signOut:async()=>({error:null})}});`,
    "config.ts": `export const hasSupabaseBrowserConfig=()=>true;export const preloadSupabaseBrowserClient=()=>{};`,
  };
  const entry = (
    await readFile(
      resolve("scripts/responsive-audit/entry.template.txt"),
      "utf8",
    )
  ).replaceAll("__SOURCE__", sourceRoot);
  for (const [name, content] of Object.entries({
    ...files,
    "entry.tsx": entry,
  }))
    await writeFile(resolve(dir, name), content);
  const req = createRequire(resolve("package.json")),
    vr = createRequire(req.resolve("vitest/config")),
    { createServer } = await import(pathToFileURL(vr.resolve("vite")).href);
  const server = await createServer({
    define: { "process.env": JSON.stringify({ NODE_ENV: "production" }) },
    configFile: false,
    root: dir,
    publicDir: resolve(sourceRoot, "public"),
    logLevel: "error",
    server: {
      host: "127.0.0.1",
      port,
      strictPort: true,
      fs: { allow: [project, sourceRoot] },
    },
    esbuild: { jsx: "automatic" },
    css: { postcss: { plugins: [] } },
    resolve: {
      alias: [
        { find: /^next\/link$/, replacement: resolve(dir, "link.tsx") },
        { find: /^next\/image$/, replacement: resolve(dir, "image.tsx") },
        {
          find: /^next\/navigation$/,
          replacement: resolve(dir, "navigation.tsx"),
        },
        { find: /^next\/font\/google$/, replacement: resolve(dir, "font.ts") },
        {
          find: "@/lib/supabase-browser",
          replacement: resolve(dir, "supabase.ts"),
        },
        {
          find: "@/lib/supabase-config",
          replacement: resolve(dir, "config.ts"),
        },
        { find: "@", replacement: resolve(sourceRoot, "src") },
      ],
      dedupe: ["react", "react-dom"],
    },
  });
  await server.listen();
  return { server, url: `http://127.0.0.1:${port}` };
}
export async function installNetwork(
  page,
  data,
  scenario,
  requests,
  _options = {},
) {
  await page.route("**/*", async (route) => {
    const req = route.request(),
      url = new URL(req.url());
    if (
      url.hostname !== "127.0.0.1" &&
      url.protocol !== "data:" &&
      url.protocol !== "blob:"
    )
      return route.abort();
    if (!url.pathname.startsWith("/api/")) return route.continue();
    requests.push({ method: req.method(), path: url.pathname });
    const p = url.pathname;
    if (
      scenario === "error" &&
      !["/api/auth/access", "/api/notifications", "/api/search"].includes(p)
    )
      return route.fulfill({
        status: 503,
        json: { error: "Kontrolovaná testovací chyba služby." },
      });
    let json;
    if (p === "/api/auth/email-mfa/send")
      return route.fulfill({
        json: {
          email: "demo@example.invalid",
          can_verify: true,
          retry_after: 0,
        },
      });
    if (p === "/api/onboarding/draft") json = { draft: null };
    else if (p === "/api/payments/imports")
      json = { imports: [], can_manage: true };
    else if (p === "/api/payments/invoice-candidates")
      json = { invoices: data.rows, total: data.rows.length };
    else if (p === "/api/payments/assistance")
      json = {
        flags: { mode: "off", memory: false, reevaluation: false, camt: false },
        proposals: [],
        memories: [],
        sources: [],
        payments: [],
        job: null,
        metrics: { confirmed: 0, rejected: 0 },
      };
    else if (p === "/api/dashboard") json = data.summary;
    else if (p === "/api/auth/access")
      json = { ...data.profile, vat_payer: data.profile.vatPayer };
    else if (p === "/api/dashboard/summary") json = data.summary;
    else if (p === "/api/reports") json = data.reports;
    else if (p === "/api/invoices/totals") json = data.totals;
    else if (p === "/api/invoices/count")
      json = { count: data.list.active_count };
    else if (p === "/api/invoices/creation") json = data.creation;
    else if (p === "/api/invoices") json = data.list;
    else if (p === "/api/customers") json = data.customers;
    else if (p === "/api/customers/search")
      json = { customers: data.customers.customers };
    else if (p === "/api/settings/page-data") json = data.settings;
    else if (p === "/api/settings/reminder-policies")
      json = { policies: [data.policy] };
    else if (p === "/api/reminders/page-data") json = data.reminder;
    else if (p === "/api/settings/reminders") json = data.reminder.settings;
    else if (p === "/api/notifications") json = data.notifications;
    else if (p === "/api/payments") json = data.payments;
    else if (p === "/api/billing") json = data.billing;
    else if (p === "/api/search") json = { results: [], unavailable: [] };
    else if (p.endsWith("/statement-imports"))
      json = { imports: [], total: 0, has_more: false };
    else if (p.includes("reminder-policy-preference"))
      json = { policy_id: null };
    else if (p.endsWith("/assignable-payments"))
      json = {
        payments: [],
        remaining_amount: data.rows[0].amount,
        currency: "CZK",
      };
    else if (p.endsWith("/page-data") && p.startsWith("/api/invoices/"))
      json = data.detail;
    else if (/^\/api\/invoices\/[^/]+$/.test(p)) json = data.detail;
    else if (p === "/api/auth/session-preference") json = { ok: true };
    else
      return route.fulfill({
        status: 404,
        json: { error: "Unmapped audit fixture endpoint" },
      });
    if (
      !["GET", "HEAD"].includes(req.method()) &&
      !["/api/auth/access", "/api/auth/session-preference"].includes(p)
    )
      return route.fulfill({
        status: 400,
        json: {
          error: "Kontrolovaná testovací chyba; žádný zápis nebyl proveden.",
        },
      });
    return route.fulfill({ json });
  });
}
