import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";
import { chromium, expect } from "@playwright/test";
const require = createRequire(import.meta.url);
const vitestRequire = createRequire(require.resolve("vitest/package.json"));
const { createServer } = await import(
  pathToFileURL(vitestRequire.resolve("vite")).href
);
const project = process.cwd(),
  fixture = resolve(project, ".cache/login-progress"),
  output = resolve(project, "artifacts/login-progress");
await mkdir(fixture, { recursive: true });
await mkdir(output, { recursive: true });
await writeFile(
  resolve(fixture, "index.html"),
  '<html lang="cs"><meta name="viewport" content="width=device-width,initial-scale=1"><div id="root"></div><script type="module" src="/entry.tsx"></script></html>',
);
await writeFile(
  resolve(fixture, "link.tsx"),
  "import {createElement} from 'react';export default function Link({children,...props}){return createElement('a',props,children)}",
);
await writeFile(
  resolve(fixture, "image.tsx"),
  "import {createElement} from 'react';export default function Image({priority,fill,...props}){return createElement('img',props)}",
);
await writeFile(
  resolve(fixture, "font.ts"),
  "export function Inter(){return {className:''}}",
);
await writeFile(
  resolve(fixture, "config.ts"),
  "export const hasSupabaseBrowserConfig=()=>true;export const preloadSupabaseBrowserClient=()=>{};",
);
await writeFile(
  resolve(fixture, "supabase.ts"),
  `export const createClient=()=>({auth:{signInWithPassword:async()=>await (await fetch('/fixture-credentials')).json(),signOut:async()=>{await fetch("/fixture-signout");return {error:null}}}});`,
);
await writeFile(
  resolve(fixture, "entry.tsx"),
  `import React from 'react';import {createRoot} from 'react-dom/client';import '${project}/src/app/globals.css';import {LoginForm} from '${project}/src/components/auth/login-form';createRoot(document.getElementById('root')).render(location.pathname==='/login'?<LoginForm brand="splatno"/>:<h1 data-destination>{location.pathname}</h1>);`,
);
const server = await createServer({
  configFile: false,
  root: fixture,
  publicDir: resolve(project, "public"),
  logLevel: "error",
  server: {
    host: "127.0.0.1",
    port: 4345,
    strictPort: true,
    fs: { allow: [project] },
  },
  esbuild: { jsx: "automatic" },
  css: { postcss: { plugins: [] } },
  resolve: {
    alias: [
      {
        find: "@/lib/supabase-config",
        replacement: resolve(fixture, "config.ts"),
      },
      {
        find: "@/lib/supabase-browser",
        replacement: resolve(fixture, "supabase.ts"),
      },
      { find: /^next\/link$/, replacement: resolve(fixture, "link.tsx") },
      { find: /^next\/image$/, replacement: resolve(fixture, "image.tsx") },
      {
        find: /^next\/font\/google$/,
        replacement: resolve(fixture, "font.ts"),
      },
      { find: "@", replacement: resolve(project, "src") },
    ],
    dedupe: ["react", "react-dom"],
  },
});
await server.listen();
const browser = await chromium.launch();
const results = [];
async function scenario(name, run, viewport = { width: 1555, height: 1012 }) {
  const page = await browser.newPage({ viewport });
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  let accessCount = 0,
    credentialCount = 0,
    sessionCount = 0,
    signoutCount = 0;
  let accessMode = "success",
    mfa = false,
    onboarding = false;
  let releaseAccess, releaseCredentials;
  let expectedRemember = false;
  const timings = [];
  await page.exposeFunction("recordLoginTiming", (entry) => timings.push(entry));
  await page.addInitScript(() => {
    new PerformanceObserver((list) => {
      for (const e of list.getEntries()) {
        if (e.name.startsWith("splatno:login:")) window.recordLoginTiming({name:e.name,duration:e.duration});
      }
    }).observe({entryTypes:["measure", "mark"]});
  });
  await page.route("**/fixture-signout", async (r) => {
    signoutCount++;
    await r.fulfill({ json: {} });
  });
  await page.route("**/fixture-credentials", async (r) => {
    credentialCount++;
    if (releaseCredentials) await releaseCredentials;
    if (accessMode === "bad-password")
      return r.fulfill({ json: { data: {}, error: { status: 400 } } });
    return r.fulfill({
      json: {
        data: { session: { access_token: "fixture-only" } },
        error: null,
      },
    });
  });
  await page.route("**/api/auth/access", async (r) => {
    accessCount++;
    expect(r.request().postDataJSON()).toEqual({ remember: expectedRemember });
    if (releaseAccess) await releaseAccess;
    if (accessMode === "offline") return r.abort("internetdisconnected");
    if (accessMode === "hang") return;
    const status = typeof accessMode === "number" ? accessMode : 200;
    await r.fulfill({
      status,
      json:
        status === 200
          ? { mfa_bypassed: !mfa, needsOnboarding: onboarding }
          : { code: "fixture_failure", error: "SECRET_INTERNAL_STACK_TOKEN" },
    });
  });
  await page.route("**/api/auth/session-preference", async (r) => {
    sessionCount++;
    await r.fulfill({
      status: 200,
      json: { saved: true },
    });
  });
  const submit = async () => {
    await page.locator("input[type=email]").fill("test@example.invalid");
    await page.locator("input[type=password]").fill("fixture-password");
    expectedRemember = await page.locator("input[type=checkbox]").isChecked();
    await page.locator("button[type=submit]").click();
  };
  const control = {
    page,
    submit,
    setMode: (v) => (accessMode = v),
    setMfa: (v) => (mfa = v),
    setOnboarding: (v) => (onboarding = v),
    holdAccess: () => {
      let release;
      releaseAccess = new Promise((r) => (release = r));
      return () => {
        release();
        releaseAccess = null;
      };
    },
    holdCredentials: () => {
      let release;
      releaseCredentials = new Promise((r) => (release = r));
      return () => {
        release();
        releaseCredentials = null;
      };
    },
    counts: () => ({
      accessCount,
      credentialCount,
      sessionCount,
      signoutCount,
    }),
  };
  try {
    await page.goto("http://127.0.0.1:4345/login?returnTo=%2Finvoices");
    await run(control);
    expect(errors).toEqual([]);
    if (new URL(page.url()).pathname !== "/login") {
      await page.waitForLoadState("load");
      const navigation = await page.evaluate(() => {
        const e = performance.getEntriesByType("navigation")[0];
        return e ? { name: "destination-navigation", duration: e.loadEventEnd, serverTiming: e.serverTiming } : null;
      });
      if (navigation) timings.push(navigation);
    }
    results.push({ name, passed: true, requests: control.counts(), timings });
  } catch (e) {
    results.push({ name, passed: false, error: String(e) });
  } finally {
    await page.close();
  }
}
try {
  for (const viewport of [
    { width: 1555, height: 1012 },
    { width: 768, height: 1024 },
    { width: 390, height: 844 },
    { width: 320, height: 568 },
  ]) {
    await scenario(
      `loading and error ${viewport.width}`,
      async (c) => {
        const cardBefore = await c.page.locator("main > div").boundingBox();
        const release = c.holdAccess();
        await c.submit();
        await expect(
          c.page.getByRole("heading", { name: "Přihlašujeme vás…" }),
        ).toBeVisible();
        await expect(c.page.locator("li[aria-current=step]")).toContainText(
          "Načítání vašeho prostředí",
        );
        await expect(c.page.locator("aside")).toHaveCount(0);
        const cardAfter = await c.page.locator("main > div").boundingBox();
        expect(cardAfter.width).toBe(cardBefore.width);
        if (viewport.width > 900)
          expect(cardAfter.height).toBe(cardBefore.height);
        else expect(cardAfter.height).toBeGreaterThanOrEqual(viewport.height);
        await c.page.emulateMedia({ reducedMotion: "reduce" });
        expect(
          await c.page
            .locator("section > div > svg")
            .last()
            .evaluate((el) => getComputedStyle(el).animationName),
        ).toBe("none");
        expect(
          await c.page.evaluate(
            () => document.documentElement.scrollWidth <= innerWidth,
          ),
        ).toBe(true);
        await c.page.screenshot({
          path: resolve(output, `loading-${viewport.width}.png`),
          fullPage: true,
        });
        c.setMode("offline");
        release();
        await expect(c.page.getByRole("alert")).toContainText(
          "Chyba připojení",
        );
        await c.page.screenshot({
          path: resolve(output, `error-${viewport.width}.png`),
          fullPage: true,
        });
        expect(
          (await c.page.locator("main > div").boundingBox()).height,
        ).toBeGreaterThanOrEqual(
          viewport.height > 900 ? cardAfter.height : viewport.height,
        );
        await expect(c.page.locator("body")).not.toContainText("fixture-only");
        await expect(c.page.locator("body")).not.toContainText(
          "fixture-password",
        );
        expect(
          await c.page.evaluate(
            () => document.documentElement.scrollWidth <= innerWidth,
          ),
        ).toBe(true);
        if (viewport.width === 390) {
          await c.page.addStyleTag({
            content:
              "html {font-size:200%} main section p {font-size:2rem} main section button {font-size:1.25rem}",
          });
          expect(
            await c.page.evaluate(
              () => document.documentElement.scrollWidth <= innerWidth,
            ),
          ).toBe(true);
          await c.page.screenshot({
            path: resolve(output, "error-390-large-text.png"),
            fullPage: true,
          });
        }
        c.setMode("success");
        await c.page.getByRole("button", { name: "Zkusit znovu" }).click();
        await c.page.waitForURL("**/invoices");
        expect(c.counts()).toEqual({
          accessCount: 2,
          credentialCount: 1,
          sessionCount: 0,
          signoutCount: 0,
        });
      },
      viewport,
    );
  }
  await scenario("MFA retains returnTo", async (c) => {
    c.setMfa(true);
    await c.submit();
    await c.page.waitForURL("**/mfa?returnTo=%2Finvoices");
  });
  await scenario("founder onboarding", async (c) => {
    c.setOnboarding(true);
    await c.submit();
    await c.page.waitForURL("**/onboarding");
  });
  await scenario("invalid credentials stay in form", async (c) => {
    c.setMode("bad-password");
    await c.submit();
    await expect(c.page.locator("input[type=password]")).toBeVisible();
    expect(c.counts().accessCount).toBe(0);
  });
  for (const [status, title] of [
    [401, "Přihlášení vypršelo"],
    [403, "Nepodařilo se ověřit přístup"],
    [500, "Server momentálně neodpovídá"],
    [422, "Nepodařilo se načíst firemní údaje"],
  ])
    await scenario(`access ${status}`, async (c) => {
      c.setMode(status);
      await c.submit();
      await expect(c.page.getByRole("alert")).toContainText(title);
      if (status === 401 || status === 403)
        await expect(
          c.page.getByRole("button", { name: "Zkusit znovu" }),
        ).toHaveCount(0);
      await c.page.getByRole("button", { name: "Zpět na přihlášení" }).click();
      await expect(c.page.locator("input[type=email]")).toBeVisible();
    });
  await scenario("server error retry never resends credentials", async (c) => {
    c.setMode(500);
    await c.submit();
    await expect(c.page.getByRole("alert")).toBeVisible();
    c.setMode("success");
    await c.page.getByRole("button", { name: "Zkusit znovu" }).click();
    await c.page.waitForURL("**/invoices");
    expect(c.counts()).toEqual({
      accessCount: 2,
      credentialCount: 1,
      sessionCount: 0,
      signoutCount: 0,
    });
  });
  await scenario("remember preference uses the single bootstrap", async (c) => {
    await c.page.locator("input[type=checkbox]").check();
    await c.submit();
    await c.page.waitForURL("**/invoices");
    expect(c.counts()).toEqual({ accessCount: 1, credentialCount: 1, sessionCount: 0, signoutCount: 0 });
  });
  await scenario(
    "rapid retry clicks stay serial and failed retry updates error",
    async (c) => {
      c.setMode("offline");
      await c.submit();
      await expect(c.page.getByRole("alert")).toBeVisible();
      const release = c.holdAccess();
      c.setMode(500);
      await c.page
        .getByRole("button", { name: "Zkusit znovu" })
        .evaluate((button) => {
          button.click();
          button.click();
          button.click();
        });
      await expect.poll(() => c.counts().accessCount).toBe(2);
      await expect(
        c.page.getByRole("heading", { name: "Přihlašujeme vás…" }),
      ).toBeVisible();
      release();
      await expect(c.page.getByRole("alert")).toContainText(
        "Server momentálně neodpovídá",
      );
      await expect(c.page.locator("body")).not.toContainText(
        "SECRET_INTERNAL_STACK_TOKEN",
      );
      c.setMode("success");
      await c.page.getByRole("button", { name: "Zkusit znovu" }).click();
      await c.page.waitForURL("**/invoices");
      expect(c.counts()).toEqual({
        accessCount: 3,
        credentialCount: 1,
        sessionCount: 0,
        signoutCount: 0,
      });
    },
  );
  for (const [kind, title] of [
    ["unknown", "Nastala neočekávaná chyba"],
    ["abort", "Načítání bylo přerušeno"],
  ])
    await scenario(kind, async (c) => {
      await c.page.evaluate((kind) => {
        const original = fetch;
        window.fetch = (input, opts) =>
          String(input) === "/api/auth/access"
            ? Promise.reject(
                kind === "abort"
                  ? new DOMException(
                      "SECRET_INTERNAL_STACK_TOKEN",
                      "AbortError",
                    )
                  : new Error("SECRET_INTERNAL_STACK_TOKEN"),
              )
            : original(input, opts);
      }, kind);
      await c.submit();
      await expect(c.page.getByRole("alert")).toContainText(title);
      await expect(c.page.locator("body")).not.toContainText(
        "SECRET_INTERNAL_STACK_TOKEN",
      );
      if (kind === "unknown")
        await expect(
          c.page.getByRole("button", { name: "Zkusit znovu" }),
        ).toHaveCount(0);
    });
  await scenario(
    "slow credentials do not simulate progress or permit overlapping retry",
    async (c) => {
      await c.page.clock.install();
      const release = c.holdCredentials();
      await c.submit();
      await c.page.clock.fastForward(16000);
      await expect(
        c.page.getByText("Přihlášení trvá déle než obvykle.", { exact: false }),
      ).toBeVisible();
      await expect(c.page.locator("li[aria-current=step]")).toContainText(
        "Ověření přihlašovacích údajů",
      );
      await expect(
        c.page.getByRole("button", { name: "Zkusit znovu" }),
      ).toHaveCount(0);
      release();
      await c.page.waitForURL("**/invoices");
    },
  );
  await scenario("request timeout becomes recoverable error", async (c) => {
    await c.page.evaluate(() => {
      const originalFetch = window.fetch;
      window.fetch = (input, options) =>
        String(input) === "/api/auth/access"
          ? new Promise((_, reject) =>
              options.signal.addEventListener(
                "abort",
                () => reject(options.signal.reason),
                { once: true },
              ),
            )
          : originalFetch(input, options);
    });
    await c.submit();
    await expect(c.page.getByRole("alert")).toContainText(
      "Server momentálně neodpovídá",
      {
        timeout: 35000,
      },
    );
  });
} finally {
  await browser.close();
  await server.close();
}
await writeFile(
  resolve(output, "results.json"),
  JSON.stringify(
    {
      scope:
        "Real login UI; synthetic Supabase client and API responses. No live accounts, cookies or company data tested.",
      results,
    },
    null,
    2,
  ),
);
console.log(JSON.stringify(results, null, 2));
if (results.some((r) => !r.passed)) process.exitCode = 1;
