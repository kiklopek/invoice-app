import { defineConfig, devices } from "@playwright/test";
import { STORAGE_STATE } from "./e2e/global-setup";
import { existsSync } from "node:fs";

// Session se vyrabi jednou v global-setup (prihlasenim uctu, ktery obchazi
// MFA) a vsechny projekty ji sdileji. Kdyz soubor neexistuje, Playwright by
// na storageState spadl pri startu -- proto se pripoji jen kdyz je.
const storageState = existsSync(STORAGE_STATE) ? STORAGE_STATE : undefined;

// POZOR, slepá ulička: nabízí se pustit sadu proti produkčnímu buildu
// (`next build && next start`), aby odpadla kompilace na vyžádání a s ní
// i timeouty. NEFUNGUJE to přes HTTP. Pod `next start` je NODE_ENV=production
// a proxy.ts nastavuje session cookie jako `secure` (viz src/proxy.ts), takže
// ji prohlížeč na http://127.0.0.1 vůbec neodešle: každá workspace stránka
// skončí na 401 "Nejste přihlášený uživatel". Ověřeno měřením -- z 180 testů
// pak projde 43. Podmínkou by bylo HTTPS s důvěryhodným certifikátem.

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 2 : 0,
  // Dev server kompiluje stránky až při prvním požadavku, takže se při plném
  // paralelismu vlny překladů sčítají a testy padají na timeoutech -- ověřeno,
  // stejné testy, které při čtyřech workerech selhaly (17 najednou), projdou
  // sériově beze změny kódu. Retries by to schovaly, jenže zelená kvůli
  // opakování je přesně ta nedůvěryhodná zelená, kterou má sada odstraňovat.
  workers: 3,
  reporter: process.env.CI ? "github" : "list",
  globalSetup: "./e2e/global-setup.ts",
  use: {
    baseURL: "http://127.0.0.1:3000",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    storageState,
  },
  // Sirky odpovidaji ctyrem breakpointum, na ktere se sjednocuje CSS (F3B):
  // 480 / 768 / 1024 / 1280. Driv se testoval jen desktop a Pixel 5, takze
  // pasmo kolem tabletu -- kde je dnes rozbity layout mezi 761 a 780 px --
  // nikdo nekontroloval.
  projects: [
    { name: "desktop", use: { ...devices["Desktop Chrome"] } },
    { name: "desktop-safari", use: { ...devices["Desktop Safari"] } },
    { name: "tablet", use: { ...devices["Desktop Chrome"], viewport: { width: 768, height: 1024 } } },
    { name: "mobile", use: { ...devices["Pixel 5"] } },
    { name: "mobile-small", use: { ...devices["Pixel 5"], viewport: { width: 360, height: 740 } } },
  ],
  // Webpack, ne Turbopack: ten má v 16.3.5 chybu ve zvýrazňovači chybových
  // rámců (crates/next-code-frame/src/highlight.rs -- řeže řetězec po bajtech
  // a rozsekne české písmeno), která shodí celý dev server. V repu plném
  // češtiny to spolehlivě nastane při první chybě za běhu a sada pak padá na
  // "webServer exited early". `pnpm build` už webpack používá ze stejného
  // důvodu.
  webServer: {
    command: "corepack pnpm dev:webpack --hostname 127.0.0.1 --port 3000",
    url: "http://127.0.0.1:3000/dashboard",
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});
