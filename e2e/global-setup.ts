import { chromium, type FullConfig, type Page } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";
import { mkdirSync, readFileSync, rmSync } from "node:fs";
import { dirname } from "node:path";

export const STORAGE_STATE = "e2e/.auth/state.json";

// Přihlášení přes UI je možné jen díky tomu, že účet v TRUSTED_EMAIL_MFA_ACCOUNT
// (src/lib/email-mfa-core.ts) obchází e-mailové MFA -- jinak by se tu čekalo
// na šestimístný kód z e-mailu a automatizovat to nejde.
const DEFAULT_EMAIL = "test-admin@hlavica.cz";

// Proměnné se čtou z .env.local, protože Playwright si Next.js prostředí
// nenačítá sám.
function loadEnvFile(path = ".env.local") {
  try {
    for (const line of readFileSync(path, "utf8").split("\n")) {
      const match = /^\s*([A-Z0-9_]+)\s*=\s*(.*)$/.exec(line);
      if (match && !process.env[match[1]]) {
        process.env[match[1]] = match[2].trim().replace(/^["']|["']$/g, "");
      }
    }
  } catch {
    // Soubor nemusí existovat (CI si proměnné předává jinak).
  }
}

/**
 * Session bez hesla: servisním klíčem se vygeneruje jednorázový odkaz
 * a routa /auth/recovery ho ověří a sama nastaví přihlašovací cookie.
 *
 * Proč takhle: heslo testovacího účtu v repu není a být nemá, ale servisní
 * klíč je v .env.local už kvůli běžnému vývoji. Nic se tím nemění -- token
 * je jednorázový a hesla se nedotýká.
 */
async function signInWithAdminToken(page: import("@playwright/test").Page, email: string) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) return false;

  const admin = createClient(url, serviceKey, { auth: { autoRefreshToken: false, persistSession: false } });
  const { data, error } = await admin.auth.admin.generateLink({ type: "recovery", email });
  const tokenHash = data?.properties?.hashed_token;
  if (error || !tokenHash) {
    console.warn(`[e2e] Jednorázový odkaz se nepodařilo vytvořit: ${error?.message ?? "bez tokenu"}`);
    return false;
  }

  await page.goto(`/auth/recovery?token_hash=${encodeURIComponent(tokenHash)}`);
  // Routa přesměruje na /reset-password; session už v tu chvíli platí.
  await page.goto("/dashboard");
  return !page.url().includes("/login");
}

async function signInWithPassword(page: import("@playwright/test").Page, email: string, password: string) {
  await page.goto("/login");
  await page.getByLabel("Firemní e-mail").fill(email);
  await page.getByLabel("Heslo").fill(password);
  await page.getByRole("button", { name: "Přihlásit se" }).click();
  await page.waitForURL(/\/dashboard/, { timeout: 30_000 });
  return true;
}

// Dev server překládá stránku až při prvním požadavku a trvá to jednotky
// sekund. V testech se ta cena platí uvnitř měřeného času: `page.goto()`
// vyprší, nebo se klikne dřív, než se stihne připojit React, a test spadne na
// něčem, co s jeho předmětem vůbec nesouvisí. Projít routy jednou předem je
// levnější a hlavně to nemíchá čekání na překlad do výsledků testů.
//
// Chyby se schválně polykají: tohle je urychlení, ne kontrola. Kdyby routa
// byla rozbitá, má to ohlásit test, který ji ověřuje, ne setup.
// Musí tu být i přihlašovací stránky (chodí na ně testy odhlášeného uživatele)
// a detail faktury, což je dynamická routa -- ta se dopisuje níž z reálného id.
const WARM_ROUTES = [
  "/dashboard", "/invoices", "/invoices/new", "/invoices/import",
  "/invoices/archive", "/invoices/payments", "/invoices/payments/archive",
  "/customers", "/reports", "/reminders", "/settings",
  "/login", "/register", "/forgot-password", "/reset-password",
];

async function warmRoutes(page: Page) {
  const started = Date.now();
  const routes = [...WARM_ROUTES];
  try {
    // Detail faktury kompiluje zvlášť a chodí na něj víc speců. Bez konkrétního
    // id ho předehřát nelze, tak se vezme první faktura ze seznamu.
    await page.goto("/invoices", { waitUntil: "domcontentloaded", timeout: 60_000 });
    const href = await page.locator('a[href^="/invoices/"]').first().getAttribute("href");
    if (href && /^\/invoices\/[0-9a-f-]{36}$/.test(href)) routes.push(href);
  } catch {
    // Detail se nepředehřeje; zbytek má smysl udělat tak jako tak.
  }
  for (const route of routes) {
    try {
      await page.goto(route, { waitUntil: "domcontentloaded", timeout: 60_000 });
    } catch {
      // Nechceme kvůli jedné routě přijít o předehřátí ostatních.
    }
  }
  console.info(`[e2e] Předehřáto ${routes.length} rout za ${Math.round((Date.now() - started) / 1000)} s.`);
}

export default async function globalSetup(config: FullConfig) {
  loadEnvFile();
  const email = process.env.E2E_EMAIL || DEFAULT_EMAIL;
  const password = process.env.E2E_PASSWORD;

  // Starou session vždy zahodíme -- přihlášení s prošlou session je horší
  // než žádné, protože testy pak padají na nesouvisejících místech.
  rmSync(STORAGE_STATE, { force: true });
  mkdirSync(dirname(STORAGE_STATE), { recursive: true });

  const baseURL = config.projects[0]?.use?.baseURL ?? "http://127.0.0.1:3000";
  const browser = await chromium.launch();
  const page = await browser.newPage({ baseURL });
  try {
    const signedIn = password
      ? await signInWithPassword(page, email, password)
      : await signInWithAdminToken(page, email);

    if (!signedIn) {
      // Nepadáme: specy samy rozhodnou, jestli je chybějící session tvrdá
      // chyba (výchozí) nebo vědomě povolená výjimka.
      console.warn("[e2e] Session se nepodařilo vytvořit — workspace testy poběží bez přihlášení.");
      return;
    }
    await page.context().storageState({ path: STORAGE_STATE });
    console.info(`[e2e] Přihlášená session uložena pro ${email}.`);
    await warmRoutes(page);
  } catch (cause) {
    rmSync(STORAGE_STATE, { force: true });
    console.warn(`[e2e] Přihlášení účtu ${email} selhalo: ${cause instanceof Error ? cause.message : String(cause)}`);
  } finally {
    await browser.close();
  }
}
