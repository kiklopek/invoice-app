import { readFileSync, mkdirSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createRequire } from 'node:module';
import { runInNewContext } from 'node:vm';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import ts from 'typescript';
import { chromium } from '@playwright/test';

// Verify actual upload markup with no session or database writes.
const require = createRequire(import.meta.url);
const output = join(tmpdir(), 'payment-layout-check');
mkdirSync(output, { recursive: true });
const stubs = {
  'next/link': { __esModule: true, default: ({ children, ...props }) => React.createElement('a', props, children) },
  '@/components/layout/app-shell': { AppFrame: ({ children, className }) => React.createElement('div', { className: 'app-shell' }, React.createElement('aside', { className: 'sidebar' }), React.createElement('div', { className: 'workspace-background', 'aria-hidden': true }), React.createElement('main', { className }, children)) },
  './payments-upload.module.css': { __esModule: true, default: { page: 'payment-upload-check', stage: 'payment-stage-check', background: 'payment-background-check' } },
  '@/lib/api-client': { apiFetch: () => Promise.resolve({ imports: [] }), ApiRequestError: class extends Error {} },
  '@/lib/money': { minorUnits: value => Math.round(value * 100) },
  '@/lib/reconciliation-errors': { reconciliationError: value => value },
  '@/lib/confirm-action': { confirmAction: () => Promise.resolve(false) },
  '@/lib/payment-unrelated-rows': { OWN_TRANSFER_LABEL: 'Vlastní převod', UNRELATED_LABEL: 'Nesouvisející platba', buildStatementReviewSubmission: () => ({}) },
};
function load(path) {
  const code = ts.transpileModule(readFileSync(path, 'utf8'), { compilerOptions: { jsx: ts.JsxEmit.ReactJSX, module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText;
  const mod = { exports: {} };
  runInNewContext(code, { module: mod, exports: mod.exports, require: name => {
    if (stubs[name]) return stubs[name];
    if (name === 'react' || name === 'react/jsx-runtime') return require(name);
    throw new Error(`Unexpected UI dependency: ${name}`);
  } }, { filename: path });
  return mod.exports;
}
stubs['@/components/icons'] = load('src/components/icons.tsx');
stubs['./gpc-import-panel'] = load('src/app/(workspace)/invoices/payments/gpc-import-panel.tsx');
const { PaymentsClient } = load('src/app/(workspace)/invoices/payments/payments-client.tsx');
const markup = renderToStaticMarkup(React.createElement(PaymentsClient, { initialData: { payments: [], open_invoices: [], can_manage: true, gpc_enabled: true, runtime_mode: 'production-database' } }));
const css = ['src/app/globals.css', 'src/app/minimal.css', 'src/app/styles/responsive.css', 'src/components/layout/workspace-background.css'].map(path => readFileSync(path, 'utf8')).join('\n');
const scoped = readFileSync('src/app/(workspace)/invoices/payments/payments-upload.module.css', 'utf8').replaceAll('.page', '.payment-upload-check').replaceAll('.stage', '.payment-stage-check').replaceAll('.background', '.payment-background-check').replace(/:global\(([^)]+)\)/g, '$1');
const html = `<!doctype html><html lang="cs"><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><style>${css}\n${scoped}\n@media(max-width: 820px){.sidebar{display:none}}</style><body>${markup}</body></html>`;
writeFileSync(join(output, 'preview.html'), html);
const executablePath = ['C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'].find(existsSync);
const browser = await chromium.launch({ executablePath, headless: true });
try {
  const page = await browser.newPage();
  for (const [width, height] of [[320, 780], [390, 844], [600, 900], [768, 1024], [980, 900], [1024, 768], [1280, 600], [1440, 900], [1920, 947], [2560, 1440]]) {
    await page.setViewportSize({ width, height });
    await page.setContent(html);
    const result = await page.evaluate(() => ({
      overflow: document.documentElement.scrollWidth > innerWidth,
      verticalOverflow: document.documentElement.scrollHeight > innerHeight,
      panelOverflow: document.querySelector('.gpc-panel').scrollHeight > document.querySelector('.gpc-panel').clientHeight,
      progressVisible: !!document.querySelector('.gpc-progress-wrap'),
      uploadWidth: document.querySelector('.gpc-dropzone').getBoundingClientRect().width,
      safetyVisible: getComputedStyle(document.querySelector('.gpc-safety-card')).display !== 'none',
      columns: getComputedStyle(document.querySelector('.gpc-intro-grid')).gridTemplateColumns,
      aligned: Math.abs(document.querySelector('.payments-hero').getBoundingClientRect().x - document.querySelector('.gpc-panel').getBoundingClientRect().x) < 1 && Math.abs(document.querySelector('.payments-hero').getBoundingClientRect().width - document.querySelector('.gpc-panel').getBoundingClientRect().width) < 1,
      centered: Math.abs((document.querySelector('.payment-stage-check').getBoundingClientRect().left + document.querySelector('.payment-stage-check').getBoundingClientRect().right) / 2 - (document.querySelector('.content').getBoundingClientRect().left + document.querySelector('.content').getBoundingClientRect().right) / 2) < 2,
    }));
    if (result.overflow || !result.aligned || !result.centered || result.uploadWidth < 200 || result.progressVisible || (width >= 1024 && (result.verticalOverflow || result.panelOverflow || !result.safetyVisible))) throw new Error(`${width}×${height}: ${JSON.stringify(result)}`);
    console.log(`${width}px: ${JSON.stringify(result)}`);
    if ([390, 1440, 1920].includes(width)) await page.screenshot({ path: join(output, `payments-${width}.png`), fullPage: true });
  }
  const variants = ['dashboard', 'invoices', 'invoice-detail', 'compose', 'import', 'invoice-archive', 'payments', 'payment-archive', 'customers', 'reports', 'reminders', 'settings'];
  const compositions = new Set();
  for (const variant of variants) {
    const composition = await page.evaluate(variant => {
      const background = document.querySelector('.workspace-background');
      background.dataset.variant = variant;
      const style = getComputedStyle(background);
      return ['--ring-x', '--ring-y', '--second-x', '--second-y', '--dots-x', '--dots-y'].map(name => style.getPropertyValue(name).trim()).join('/');
    }, variant);
    compositions.add(composition);
  }
  if (compositions.size !== variants.length) throw new Error('Background variants must have distinct compositions');
  console.log(`Verified ${compositions.size} distinct background compositions`);
  console.log(`Screenshots: ${output}`);
} finally { await browser.close(); }
