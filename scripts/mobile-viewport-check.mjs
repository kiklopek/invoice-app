import { spawn } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";

const baseUrl = process.env.MOBILE_CHECK_BASE_URL || "http://localhost:3000";
const outputDir = process.env.MOBILE_CHECK_OUTPUT || join(tmpdir(), "invoice-mobile-check");
const settleDelay = Number(process.env.MOBILE_CHECK_SETTLE_MS || 1200);
const fullPageScreenshots = process.env.MOBILE_CHECK_FULL_PAGE === "1";
const routes = (process.env.MOBILE_CHECK_ROUTES || "/login,/register,/forgot-password,/reset-password")
  .split(",")
  .map((route) => route.trim())
  .filter(Boolean);
const allViewports = [
  { name: "320x568", width: 320, height: 568 },
  { name: "360x800", width: 360, height: 800 },
  { name: "390x844", width: 390, height: 844 },
  { name: "430x932", width: 430, height: 932 },
  { name: "768x1024", width: 768, height: 1024 },
  { name: "landscape", width: 844, height: 390 },
];
const requestedViewports = new Set(
  (process.env.MOBILE_CHECK_VIEWPORTS || "")
    .split(",")
    .map((name) => name.trim())
    .filter(Boolean),
);
const viewports = requestedViewports.size
  ? allViewports.filter((viewport) => requestedViewports.has(viewport.name))
  : allViewports;

if (!viewports.length) {
  throw new Error("Nebyl vybrán žádný platný testovací viewport.");
}

const chromeCandidates = [
  process.env.CHROME_PATH,
  "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
  "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
  "/usr/bin/google-chrome",
  "/usr/bin/chromium",
].filter(Boolean);
const chromePath = chromeCandidates.find((candidate) => existsSync(candidate));
if (!chromePath) throw new Error("Chrome/Edge nebyl nalezen. Nastavte CHROME_PATH.");

mkdirSync(outputDir, { recursive: true });
const profileDir = mkdtempSync(join(tmpdir(), "invoice-mobile-chrome-"));
const port = 9333 + Math.floor(Math.random() * 300);
const chrome = spawn(chromePath, [
  "--headless=new",
  "--disable-gpu",
  "--no-sandbox",
  `--remote-debugging-port=${port}`,
  `--user-data-dir=${profileDir}`,
  "about:blank",
], { stdio: "ignore" });

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
async function waitForDebugger() {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    try {
      const response = await fetch(`http://127.0.0.1:${port}/json/version`);
      if (response.ok) return;
    } catch {}
    await delay(100);
  }
  throw new Error("Chrome DevTools se nepodařilo spustit.");
}

class CdpClient {
  constructor(url) {
    this.socket = new WebSocket(url);
    this.nextId = 1;
    this.pending = new Map();
    this.waiters = new Map();
  }

  async open() {
    await new Promise((resolve, reject) => {
      this.socket.addEventListener("open", resolve, { once: true });
      this.socket.addEventListener("error", reject, { once: true });
    });
    this.socket.addEventListener("message", (event) => {
      const message = JSON.parse(String(event.data));
      if (message.id) {
        const pending = this.pending.get(message.id);
        if (!pending) return;
        this.pending.delete(message.id);
        if (message.error) pending.reject(new Error(message.error.message));
        else pending.resolve(message.result);
        return;
      }
      const waiter = this.waiters.get(message.method);
      if (waiter) {
        this.waiters.delete(message.method);
        waiter(message.params);
      }
    });
  }

  send(method, params = {}) {
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.socket.send(JSON.stringify({ id, method, params }));
    });
  }

  event(method, timeout = 10000) {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.waiters.delete(method);
        reject(new Error(`Čekání na ${method} vypršelo.`));
      }, timeout);
      this.waiters.set(method, (params) => {
        clearTimeout(timer);
        resolve(params);
      });
    });
  }
}

let failed = false;
try {
  await waitForDebugger();
  const targetResponse = await fetch(`http://127.0.0.1:${port}/json/new?about:blank`, { method: "PUT" });
  const target = await targetResponse.json();
  const client = new CdpClient(target.webSocketDebuggerUrl);
  await client.open();
  await client.send("Page.enable");
  await client.send("Runtime.enable");

  for (const viewport of viewports) {
    await client.send("Emulation.setDeviceMetricsOverride", {
      width: viewport.width,
      height: viewport.height,
      screenWidth: viewport.width,
      screenHeight: viewport.height,
      deviceScaleFactor: 1,
      mobile: true,
    });
    for (const route of routes) {
      const loaded = client.event("Page.loadEventFired");
      await client.send("Page.navigate", { url: new URL(route, baseUrl).href });
      await loaded;
      await delay(settleDelay);
      const evaluation = await client.send("Runtime.evaluate", {
        returnByValue: true,
        expression: `(() => {
          const width = window.innerWidth;
          const offenders = [...document.body.querySelectorAll('*')]
            .map((element) => ({ element, rect: element.getBoundingClientRect() }))
            .filter(({ element, rect }) => {
              const intentionalScroller = element.closest('.friendly-tabs, .monthly-chart');
              return !intentionalScroller && rect.width > 0 && (rect.right > width + 1 || rect.left < -1);
            })
            .slice(0, 12)
            .map(({ element, rect }) => ({
              tag: element.tagName.toLowerCase(),
              className: typeof element.className === 'string' ? element.className : '',
              left: Math.round(rect.left),
              right: Math.round(rect.right),
              width: Math.round(rect.width),
            }));
          const smallTargets = [...document.querySelectorAll('button, a, input, select, textarea')]
            .filter((element) => {
              const rect = element.getBoundingClientRect();
              const style = getComputedStyle(element);
              return style.display !== 'none' && rect.width > 0 && (rect.height < 44 || rect.width < 32);
            })
            .slice(0, 12)
            .map((element) => ({
              tag: element.tagName.toLowerCase(),
              text: (element.textContent || element.getAttribute('aria-label') || '').trim().slice(0, 50),
              width: Math.round(element.getBoundingClientRect().width),
              height: Math.round(element.getBoundingClientRect().height),
            }));
          return { url: location.pathname, width, scrollWidth: document.documentElement.scrollWidth, offenders, smallTargets };
        })()`,
      });
      const result = evaluation.result.value;
      const safeRoute = basename(route) || "home";
      const screenshot = await client.send("Page.captureScreenshot", {
        format: "png",
        captureBeyondViewport: fullPageScreenshots,
      });
      writeFileSync(join(outputDir, `${safeRoute}-${viewport.name}.png`), screenshot.data, "base64");
      const overflow = result.scrollWidth > result.width + 1 || result.offenders.length > 0;
      if (overflow) failed = true;
      console.log(JSON.stringify({ viewport: viewport.name, requested: route, overflow, ...result }));
    }
  }
  client.socket.close();
} finally {
  chrome.kill();
  await delay(150);
  rmSync(profileDir, { recursive: true, force: true });
}

if (failed) process.exitCode = 1;
