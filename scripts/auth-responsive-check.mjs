import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";
import { chromium, webkit, expect } from "@playwright/test";
const require = createRequire(import.meta.url);
const vitestRequire = createRequire(require.resolve("vitest/package.json"));
const { createServer } = await import(
  pathToFileURL(vitestRequire.resolve("vite")).href
);
const project = process.cwd(),
  fixture = resolve(project, ".cache/auth-responsive"),
  output = resolve(project, "/tmp/auth-responsive-check");
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
  `import React from 'react';import {createRoot} from 'react-dom/client';import '${project}/src/app/globals.css';import '${project}/src/app/minimal.css';import '${project}/src/app/styles/responsive.css';import {LoginForm} from '${project}/src/components/auth/login-form';import{RegisterForm}from'${project}/src/components/auth/register-form';createRoot(document.getElementById('root')).render(location.pathname==='/register'?<RegisterForm brand="splatno"/>:<LoginForm brand="splatno"/>);`,
);
const server = await createServer({
  configFile: false,
  root: fixture,
  publicDir: resolve(project, "public"),
  logLevel: "error",
  server: {
    host: "127.0.0.1",
    port: 4359,
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
try {
  for (const engine of [chromium, webkit]) {
    const browser = await engine.launch();
    try {
      const page = await browser.newPage();
      const errors = [];
      page.on("pageerror", (error) => errors.push(error.message));
      for (const path of ["/login", "/register"]) {
        for (const [width, height] of [
          [320, 740],
          [390, 844],
          [768, 1024],
          [900, 1024],
          [901, 900],
          [1024, 768],
          [1280, 720],
          [1440, 900],
          [1920, 1080],
          [2560, 1330],
          [3840, 2160],
          [1024, 600],
        ]) {
          await page.setViewportSize({ width, height });
          await page.goto(`http://127.0.0.1:4359${path}`);
          await expect(page.locator("h1")).toBeVisible();
          await page.evaluate(() => document.fonts.ready);
          const metrics = await page.evaluate(() => {
            const root = document.querySelector("main[data-layout]");
            const card = root.firstElementChild;
            const form = document.querySelector("form");
            const image = root.querySelector("aside img");
            const title = root.querySelector("h1");
            const box = card.getBoundingClientRect();
            return {
              overflow: document.documentElement.scrollWidth > innerWidth + 1,
              cardWidth: box.width,
              cardHeight: box.height,
              formWidth: form.getBoundingClientRect().width,
              imageWidth: image.getBoundingClientRect().width,
              titleSize: parseFloat(getComputedStyle(title).fontSize),
              inputHeight: form
                .querySelector("input[type=email]")
                .getBoundingClientRect().height,
            };
          });
          expect(metrics.overflow).toBe(false);
          expect(metrics.cardWidth).toBeLessThanOrEqual(1441);
          expect(metrics.formWidth).toBeLessThanOrEqual(
            path === "/login" ? 501 : 561,
          );
          expect(metrics.imageWidth).toBeLessThanOrEqual(441);
          expect(metrics.titleSize).toBeLessThanOrEqual(46);
          expect(metrics.inputHeight).toBeGreaterThanOrEqual(44);
          if (path === "/login" && width >= 901 && height >= 720)
            expect(metrics.cardHeight).toBeLessThanOrEqual(height - 63);
          if ([390, 1440, 2560].includes(width))
            await page.screenshot({
              path: resolve(
                output,
                `${engine.name()}-${path.slice(1)}-${width}.png`,
              ),
              fullPage: true,
            });
          if (path === "/login") {
            await page
              .locator("input[type=email]")
              .fill("test@example.invalid");
            await page.locator("input[type=password]").fill("fixture-password");
            await page.getByRole("button", { name: /zobrazit heslo/i }).click();
            await expect(
              page.locator('input[autocomplete="current-password"]'),
            ).toHaveAttribute("type", "text");
          }
          expect(errors).toEqual([]);
          console.log(
            `${engine.name()} ${path} ${width}x${height}: ${JSON.stringify(metrics)}`,
          );
        }
      }
      await page.setViewportSize({ width: 390, height: 844 });
      await page.goto("http://127.0.0.1:4359/login");
      await page.addStyleTag({
        content:
          "main[data-layout] {font-size:30px} main h1 {font-size:64px !important} main label > span, main p, main a {font-size:28px !important}",
      });
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth + 1,
        ),
      ).toBe(true);
    } finally {
      await browser.close();
    }
  }
  console.log(`Screenshots: ${output}`);
} finally {
  await server.close();
}
