// Render the real dashboard and navigation with local fixtures; no account or database writes.
import { readFileSync, mkdirSync, writeFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { createRequire } from 'node:module';
import { runInNewContext } from 'node:vm';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import ts from 'typescript';
import { chromium } from '@playwright/test';

const require = createRequire(import.meta.url);
const output = join(tmpdir(), 'dashboard-responsive-check');
mkdirSync(output, { recursive: true });
let role = 'admin';
let data;
let loadError;
const profile = () => ({ role, name: 'Testovací uživatel', email: 'test@example.cz', companyName: 'Mezinárodní společnost s velmi dlouhým názvem s.r.o.' });
const stubs = {
  'next/link': { __esModule: true, default: ({ children, ...props }) => React.createElement('a', props, children) },
  'next/navigation': { useRouter: () => ({}), usePathname: () => '/dashboard' },
  swr: { __esModule: true, default: () => ({ data, error: loadError }) },
  '@/lib/use-access-role': { useAccessRole: () => role, useAccessProfile: profile, AccessProfileProvider: ({ children }) => children },
  '@/lib/confirm-action': { confirmAction: () => Promise.resolve(false) },
  '@/lib/sign-out': { signOutCurrentSession: () => {} },
  '@/components/company-logo': { CompanyLogo: () => React.createElement('span', null, 'Splatno') },
  './dashboard-summary.module.css': { __esModule: true, default: { page: 'dashboard-check', side: 'dashboard-side-check', readOnly: 'dashboard-readonly-check' } },
};
function load(path) {
  const code = ts.transpileModule(readFileSync(path, 'utf8'), { compilerOptions: { jsx: ts.JsxEmit.ReactJSX, module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText;
  const mod = { exports: {} };
  runInNewContext(code, { module: mod, exports: mod.exports, Date, Intl, require: name => {
    if (name.endsWith('.css')) return stubs[name] || {};
    if (stubs[name]) return stubs[name];
    if (name === 'react' || name === 'react/jsx-runtime') return require(name);
    throw new Error(`Unexpected UI dependency: ${name}`);
  } }, { filename: path });
  return mod.exports;
}
stubs['@/components/icons'] = load('src/components/icons.tsx');
stubs['@/lib/role-access'] = load('src/lib/role-access.ts');
stubs['@/lib/user-display'] = load('src/lib/user-display.ts');
stubs['@/components/layout/app-shell'] = load('src/components/layout/app-shell.tsx');
stubs['@/components/mobile-disclosure'] = load('src/components/mobile-disclosure.tsx');
const { DashboardClient } = load('src/app/(workspace)/dashboard/dashboard-client.tsx');
const { AppShell } = stubs['@/components/layout/app-shell'];
const css = ['src/app/globals.css', 'src/app/minimal.css', 'src/app/styles/responsive.css', 'src/components/layout/mobile-navigation.css', 'src/components/layout/workspace-background.css'].map(path => readFileSync(path, 'utf8')).join('\n');
const scoped = readFileSync('src/app/(workspace)/dashboard/dashboard-summary.module.css', 'utf8').replaceAll('.page', '.dashboard-check').replaceAll('.side', '.dashboard-side-check').replaceAll('.readOnly', '.dashboard-readonly-check').replace(/:global\(([^)]+)\)/g, '$1');
function htmlFor(stress, empty = false, error = false) {
  loadError = error ? new Error("P?ehled se nepoda?ilo aktualizovat. VelmiDlouh?Chybov?Zpr?vaBezMezer1234567890123456789012345678901234567890") : undefined;
  const invoices = empty ? [] : Array.from({ length: 18 }, (_, index) => ({
    id: `invoice-${index}`, invoice_number: stress ? 'FV-2026-DLOUHECISLOFAKTURY-1234567890123456789' : `FV-2026-${index + 1}`,
    counterparty_name: stress ? 'Mezinárodní stavební a obchodní společnost s velmi dlouhým názvem s.r.o.' : 'Zákazník s.r.o.',
    counterparty_email: stress ? 'fakturace.dlouhaadresa@velmidlouhadomena-zakaznika.example.cz' : 'faktury@example.cz',
    variable_symbol: '2026123456789', amount: stress ? 999999999999 : 125000, paid_amount: 25000,
    currency: 'CZK', status: ['overdue', 'pending', 'paid', 'cancelled'][index % 4], reminders_sent: 12,
    due_date: '2026-10-15', next_reminder_at: '2026-10-03',
  }));
  const totals = empty ? {} : stress ? { CZK: 999999999999, EUR: 88888888888, CHF: 77777777777 } : { CZK: 350000 };
  data = { active_count: invoices.length, recent: invoices, upcoming: invoices, open_totals: totals, paid_totals: totals, overdue_totals: totals, overdue_count: invoices.length, reminders_sent: 120 };
  const markup = renderToStaticMarkup(React.createElement(AppShell, { initialProfile: profile() }, React.createElement(DashboardClient, { initialData: data })));
  return `<!doctype html><html lang="cs"><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Přehled – kontrola rozložení</title><style>${css}\n${scoped}</style><body>${markup}</body></html>`;
}
// Mount the same components in the browser to verify their real event handlers.
function browserFixture() {
  const packageFile = (name, file) => readFileSync(join(dirname(require.resolve(`${name}/package.json`)), 'cjs', file), 'utf8');
  const sources = {
    react: packageFile('react', 'react.production.js'),
    'react/jsx-runtime': packageFile('react', 'react-jsx-runtime.production.js'),
    'react-dom': packageFile('react-dom', 'react-dom.production.js'),
    'react-dom/client': packageFile('react-dom', 'react-dom-client.production.js'),
    scheduler: packageFile('scheduler', 'scheduler.production.js'),
  };
  for (const [name, path] of Object.entries({
    '@/components/icons': 'src/components/icons.tsx',
    '@/lib/role-access': 'src/lib/role-access.ts',
    '@/lib/user-display': 'src/lib/user-display.ts',
    '@/components/layout/app-shell': 'src/components/layout/app-shell.tsx',
    '@/components/mobile-disclosure': 'src/components/mobile-disclosure.tsx',
    dashboard: 'src/app/(workspace)/dashboard/dashboard-client.tsx',
  })) sources[name] = ts.transpileModule(readFileSync(path, 'utf8'), { compilerOptions: { jsx: ts.JsxEmit.ReactJSX, module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText;
  return `(() => {
    const sources = ${JSON.stringify(sources)};
    const data = ${JSON.stringify(data)};
    const profile = ${JSON.stringify(profile())};
    const cache = {};
    const router = { push: href => window.fixtureRoute = href, replace: () => {}, refresh: () => {} };
    const stubs = {
      'next/link': { __esModule: true, default: ({ children, ...props }) => require('react').createElement('a', props, children) },
      'next/navigation': { useRouter: () => router, usePathname: () => '/dashboard' },
      swr: { __esModule: true, default: () => ({ data }) },
      '@/lib/use-access-role': { useAccessRole: () => profile.role, useAccessProfile: () => profile, AccessProfileProvider: ({ children }) => children },
      '@/lib/confirm-action': { confirmAction: () => Promise.resolve(false) },
      '@/lib/sign-out': { signOutCurrentSession: () => {} },
      '@/components/company-logo': { CompanyLogo: () => require('react').createElement('span', null, 'Splatno') },
      './dashboard-summary.module.css': ${JSON.stringify(stubs['./dashboard-summary.module.css'])},
    };
    function require(name) {
      if (stubs[name]) return stubs[name];
      if (name.endsWith('.css')) return {};
      if (cache[name]) return cache[name].exports;
      if (!sources[name]) throw new Error('Unknown browser dependency: ' + name);
      const module = cache[name] = { exports: {} };
      new Function('module', 'exports', 'require', 'process', sources[name])(module, module.exports, require, { env: { NODE_ENV: 'production' } });
      return module.exports;
    }
    const React = require('react');
    const { AppShell } = require('@/components/layout/app-shell');
    const { DashboardClient } = require('dashboard');
    require('react-dom/client').createRoot(document.body).render(React.createElement(AppShell, { initialProfile: profile }, React.createElement(DashboardClient, { initialData: data })));
  })();`;
}
const executablePath = process.env.CHROME_PATH || ['C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'].find(existsSync);
const browser = await chromium.launch({ executablePath, headless: true });
const results = [];
try {
  const page = await browser.newPage();
  const zoomPage = await browser.newPage({ deviceScaleFactor: 2 });
  const browserErrors = [];
  page.on('pageerror', error => browserErrors.push(error.message));
  for (role of ['admin', 'viewer']) {
    for (const scenario of ['normal', 'stress', 'empty', 'error']) {
      const html = htmlFor(scenario === 'stress', scenario === 'empty', scenario === 'error');
      writeFileSync(join(output, `${role}-${scenario}.html`), html);
      const sizes = [320, 360, 390, 430, 479, 480, 600, 601, 631, 632, 633, 767, 768, 820, 821, 900, 991, 992, 993, 1023, 1024, 1180, 1181, 1280, 1366, 1395, 1396, 1397, 1440, 1600, 1920, 2560].map(width => [width, 900]);
      sizes.push([720, 450, 2], [844, 390], [1280, 500], [1440, 600], [1920, 600], [1181, 700], [1366, 768], [1920, 1080]);
      for (const [width, height, zoom = 1] of sizes) {
        const currentPage = zoom === 2 ? zoomPage : page;
        await currentPage.setViewportSize({ width, height });
        await currentPage.setContent(html);
        await currentPage.evaluate(() => window.scrollTo(0, 0));
        const failures = await currentPage.evaluate(() => {
          const problems = [];
          const mainElement = document.querySelector('main');
          const fixedViewport = matchMedia('(min-width: 1181px) and (min-height: 700px)').matches;
          if (fixedViewport && (document.documentElement.scrollHeight > innerHeight + 1 || Math.abs(mainElement.getBoundingClientRect().height - innerHeight) > 1)) problems.push({ pageScrollsVertically: true });
          const contentWidth = mainElement.clientWidth - parseFloat(getComputedStyle(mainElement).paddingLeft) - parseFloat(getComputedStyle(mainElement).paddingRight);
          for (const [selector, threshold] of [['.dashboard-command', 1080], ['.dashboard-workspace', 960]]) {
            const grid = document.querySelector(selector);
            const columns = getComputedStyle(grid).gridTemplateColumns.split(' ').length;
            if (columns !== (fixedViewport || contentWidth >= threshold ? 2 : 1)) problems.push({ wrongColumns: selector, contentWidth, columns });
          }
          if (document.documentElement.scrollWidth > innerWidth + 1) problems.push({ pageOverflow: true });
          const balance = document.querySelector('.dashboard-balance-card');
          if (['auto', 'scroll'].includes(getComputedStyle(balance).overflowY)) problems.push({ balanceHasScrollbar: true });
          const balanceRect = balance.getBoundingClientRect();
          for (const element of balance.querySelectorAll(':scope > *, .dashboard-balance-actions a')) {
            const rect = element.getBoundingClientRect();
            if (rect.top < balanceRect.top - 1 || rect.bottom > balanceRect.bottom + 1) problems.push({ clippedBalanceContent: element.className || element.tagName });
          }
          for (const element of document.querySelectorAll('main p, main small, main a, main .status, main .dashboard-invoice-compact-meta strong')) {
            if (element.getClientRects().length && parseFloat(getComputedStyle(element).fontSize) < 12) problems.push({ tinyText: element.className || element.tagName });
          }
          for (const element of document.querySelectorAll('.dashboard-invoice-table, .dashboard-attention-panel .timeline')) {
            if (!fixedViewport && element.getBoundingClientRect().height > 421) problems.push({ tooTallList: element.className });
            if (fixedViewport && element.scrollHeight > element.clientHeight + 1) {
              element.scrollTop = element.scrollHeight;
              if (element.scrollTop < element.scrollHeight - element.clientHeight - 1) problems.push({ listCannotScroll: element.className });
              element.scrollTop = 0;
            }
          }
          for (const selector of ['.dashboard-command', '.dashboard-workspace']) {
            const children = [...document.querySelector(selector).children].map(element => element.getBoundingClientRect());
            if (children.length === 2 && Math.min(children[0].right, children[1].right) > Math.max(children[0].left, children[1].left) + 1 && Math.min(children[0].bottom, children[1].bottom) > Math.max(children[0].top, children[1].top) + 1) problems.push({ overlappingPanels: selector });
          }
          const actions = document.querySelector('.dashboard-actions');
          if (actions) {
            const column = actions.getBoundingClientRect();
            for (const button of actions.querySelectorAll('.btn')) {
              const rect = button.getBoundingClientRect();
              if (Math.abs(rect.width - column.width) > 1) problems.push({ buttonWidth: rect.width, columnWidth: column.width });
            }
            if (document.querySelector("main").clientWidth - parseFloat(getComputedStyle(document.querySelector("main")).paddingLeft) - parseFloat(getComputedStyle(document.querySelector("main")).paddingRight) >= 1080) {
              const attention = document.querySelector('.dashboard-attention-panel').getBoundingClientRect();
              if (Math.abs(column.left - attention.left) > 1 || Math.abs(column.right - attention.right) > 1) problems.push({ misalignedActionColumn: true, actionsWidth: column.width, attentionWidth: attention.width });
            }
          }
          const table = document.querySelector('.dashboard-invoice-table > table');
          const cards = document.querySelector('.dashboard-invoice-compact-list');
          if (table && cards && getComputedStyle(table).display !== 'none' && getComputedStyle(cards).display !== 'none') problems.push({ duplicateInvoiceList: true });
          for (const element of document.querySelectorAll('main, .dashboard-command, .dashboard-balance-summary > strong, .dashboard-currency-total, .dashboard-signal, .dashboard-signal strong, .dashboard-actions .btn, .panel-head, .dashboard-invoice-compact-row, .dashboard-invoice-compact-row strong, .dashboard-invoice-compact-meta > span, .dashboard-invoice-compact-statuses .status, .dashboard-timeline-item, .dashboard-timeline-item section p, .dashboard-invoice-table td')) {
            if (!element.getClientRects().length) continue;
            const rect = element.getBoundingClientRect();
            if (!rect.width || !rect.height) continue;
            if (rect.left < -1 || rect.right > innerWidth + 1 || element.scrollWidth > element.clientWidth + 2) problems.push({ element: element.className || element.tagName, text: element.textContent.slice(0, 30), width: Math.round(rect.width), scrollWidth: element.scrollWidth });
          }
          for (const panel of document.querySelectorAll('.invoice-panel, .dashboard-attention-panel')) {
            const list = panel.querySelector('.dashboard-invoice-table, .timeline');
            if (!list) continue;
            if (list.getBoundingClientRect().height < 100 && list.querySelector('.invoice-row, .dashboard-timeline-item')) problems.push({ clippedList: panel.className });
            const main = document.querySelector('main');
            if (getComputedStyle(main).overflowY === 'hidden' && panel.getBoundingClientRect().bottom > main.getBoundingClientRect().bottom + 1) problems.push({ clippedPanel: panel.className });
          }
          return problems;
        });
        // Half-size CSS viewport with double pixel density models desktop zoom 200%.
        results.push({ role, scenario, width, height, zoom, failures });
        if (role === 'admin' && scenario === 'normal' && [360, 768, 1920].includes(width) && height === 900) {
          await page.addScriptTag({ content: browserFixture() });
          await page.waitForTimeout(100);
          const menu = page.locator('.mobile-navigation-toggle');
          if (await menu.isVisible()) {
            await menu.click();
            if (await menu.getAttribute('aria-expanded') !== 'true') failures.push({ menuDidNotOpen: true });
            await page.keyboard.press('Escape');
            if (await menu.getAttribute('aria-expanded') !== 'false') failures.push({ menuDidNotClose: true });
          }
          const disclosure = page.locator('.dashboard-upcoming-disclosure .mobile-disclosure-toggle');
          if (await disclosure.isVisible()) {
            await disclosure.click();
            if (await page.locator('.dashboard-attention-panel').isVisible()) failures.push({ disclosureDidNotClose: true });
            await disclosure.click();
            if (!await page.locator('.dashboard-attention-panel').isVisible()) failures.push({ disclosureDidNotOpen: true });
          }
          const invoice = page.locator('.dashboard-invoice-table .invoice-row').first();
          if (await invoice.isVisible()) {
            await invoice.locator('td').nth(1).click();
            if (await page.evaluate(() => window.fixtureRoute) !== '/invoices/invoice-0') failures.push({ invoiceNavigationFailed: true });
          }
          for (const [selector, href] of [['.dashboard-document-upload', '/invoices/import'], ['.dashboard-add-invoice', '/invoices/new'], ['.dashboard-actions a:last-child', '/invoices/payments']]) {
            if (await page.locator(selector).getAttribute('href') !== href) failures.push({ wrongActionLink: selector });
          }
          if (browserErrors.length) failures.push({ browserErrors: [...browserErrors] });
        }
        if (role === 'admin' && scenario === 'normal' && [360, 768, 1280, 1366, 1920].includes(width) && height === 900) {
          await page.evaluate(() => window.scrollTo(0, 0));
          await page.screenshot({ path: join(output, `${width}.png`), fullPage: true });
        }
      }
    }
  }
} finally { await browser.close(); }
writeFileSync(join(output, 'results.json'), JSON.stringify(results, null, 2));
console.log(JSON.stringify({ output, checked: results.length, failures: results.filter(result => result.failures.length) }, null, 2));
if (results.some(result => result.failures.length)) process.exitCode = 1;
