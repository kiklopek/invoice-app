// Render the real dashboard and navigation with local fixtures; no account or database writes.
import { readFileSync, mkdirSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
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
const profile = () => ({ role, name: 'Testovací uživatel', email: 'test@example.cz', companyName: 'Mezinárodní společnost s velmi dlouhým názvem s.r.o.' });
const stubs = {
  'next/link': { __esModule: true, default: ({ children, ...props }) => React.createElement('a', props, children) },
  'next/navigation': { useRouter: () => ({}), usePathname: () => '/dashboard' },
  swr: { __esModule: true, default: () => ({ data }) },
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
function htmlFor(stress, empty = false) {
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
const executablePath = process.env.CHROME_PATH || ['C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'].find(existsSync);
const browser = await chromium.launch({ executablePath, headless: true });
const results = [];
try {
  const page = await browser.newPage();
  for (role of ['admin', 'viewer']) {
    for (const scenario of ['normal', 'stress', 'empty']) {
      const html = htmlFor(scenario === 'stress', scenario === 'empty');
      writeFileSync(join(output, `${role}-${scenario}.html`), html);
      const sizes = [320, 360, 390, 479, 480, 600, 601, 767, 768, 820, 821, 900, 1023, 1024, 1180, 1181, 1280, 1440, 1600, 1920, 2560].map(width => [width, 900]);
      sizes.push([844, 390], [1280, 500], [1440, 600], [1920, 600]);
      for (const [width, height] of sizes) {
        await page.setViewportSize({ width, height });
        await page.setContent(html);
        const failures = await page.evaluate(() => {
          const problems = [];
          const actions = document.querySelector('.dashboard-actions');
          if (actions) {
            const column = actions.getBoundingClientRect();
            for (const button of actions.querySelectorAll('.btn')) {
              const rect = button.getBoundingClientRect();
              if (Math.abs(rect.width - column.width) > 1) problems.push({ buttonWidth: rect.width, columnWidth: column.width });
            }
            if (innerWidth >= 1181) {
              const attention = document.querySelector('.dashboard-attention-panel').getBoundingClientRect();
              if (Math.abs(column.left - attention.left) > 1 || Math.abs(column.right - attention.right) > 1) problems.push({ misalignedActionColumn: true, actionsWidth: column.width, attentionWidth: attention.width });
            }
          }
          const table = document.querySelector('.dashboard-invoice-table > table');
          const cards = document.querySelector('.dashboard-invoice-compact-list');
          if (getComputedStyle(table).display !== 'none' && getComputedStyle(cards).display !== 'none') problems.push({ duplicateInvoiceList: true });
          for (const element of document.querySelectorAll('main, .dashboard-command, .dashboard-balance-card > strong, .dashboard-signal, .dashboard-signal strong, .dashboard-actions .btn, .panel-head, .dashboard-invoice-compact-row, .dashboard-invoice-compact-row strong, .dashboard-invoice-compact-meta > span, .dashboard-invoice-compact-statuses .status, .dashboard-timeline-item, .dashboard-timeline-item section p, .dashboard-invoice-table td')) {
            if (!element.getClientRects().length) continue;
            const rect = element.getBoundingClientRect();
            if (!rect.width || !rect.height) continue;
            if (rect.left < -1 || rect.right > innerWidth + 1 || element.scrollWidth > element.clientWidth + 2) problems.push({ element: element.className || element.tagName, text: element.textContent.slice(0, 30), width: Math.round(rect.width), scrollWidth: element.scrollWidth });
          }
          for (const panel of document.querySelectorAll('.invoice-panel, .dashboard-attention-panel')) {
            const list = panel.querySelector('.dashboard-invoice-table, .timeline');
            if (list.getBoundingClientRect().height < 100 && list.querySelector('.invoice-row, .dashboard-timeline-item')) problems.push({ clippedList: panel.className });
            const main = document.querySelector('main');
            if (getComputedStyle(main).overflowY === 'hidden' && panel.getBoundingClientRect().bottom > main.getBoundingClientRect().bottom + 1) problems.push({ clippedPanel: panel.className });
          }
          return problems;
        });
        results.push({ role, scenario, width, height, failures });
        if (role === 'admin' && scenario === 'normal' && [360, 768, 1280, 1920].includes(width) && height === 900) await page.screenshot({ path: join(output, `${width}.png`), fullPage: true });
      }
    }
  }
} finally { await browser.close(); }
writeFileSync(join(output, 'results.json'), JSON.stringify(results, null, 2));
console.log(JSON.stringify({ output, checked: results.length, failures: results.filter(result => result.failures.length) }, null, 2));
if (results.some(result => result.failures.length)) process.exitCode = 1;
