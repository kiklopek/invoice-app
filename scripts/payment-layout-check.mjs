import { readFileSync, mkdirSync, writeFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
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
  '@/lib/confirm-action': { confirmAction: () => Promise.resolve(false) },
  '@/lib/use-access-role': { useAccessRole: () => 'admin' },
};
const loaded = {};
function resolveModule(from, name) {
  const base = name.startsWith('@/') ? join('src', name.slice(2)) : join(dirname(from), name);
  for (const ext of ['.ts', '.tsx', '/index.ts', '/index.tsx', '']) if (existsSync(base + ext) && /\.tsx?$/.test(base + ext)) return base + ext;
  return null;
}
function load(path) {
  if (loaded[path]) return loaded[path].exports;
  const code = ts.transpileModule(readFileSync(path, 'utf8'), { compilerOptions: { jsx: ts.JsxEmit.ReactJSX, module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText;
  const mod = loaded[path] = { exports: {} };
  runInNewContext(code, { module: mod, exports: mod.exports, Intl, Date, require: name => {
    if (stubs[name]) return stubs[name];
    if (name === 'react' || name === 'react/jsx-runtime') return require(name);
    // CSS moduly kontroly výpisu: na nahrávací stránce se nepoužijí.
    if (name.endsWith('.module.css')) return { __esModule: true, default: new Proxy({}, { get: (_target, key) => String(key) }) };
    const target = (name.startsWith('@/lib/') || name.startsWith('./')) && resolveModule(path, name);
    if (target) return load(target);
    throw new Error(`Unexpected UI dependency: ${name}`);
  } }, { filename: path });
  return mod.exports;
}
stubs['@/components/icons'] = load('src/components/icons.tsx');
const { PaymentsClient } = load('src/app/(workspace)/invoices/payments/payments-client.tsx');
const markup = renderToStaticMarkup(React.createElement(PaymentsClient, { initialData: { payments: [], open_invoices: [], can_manage: true, gpc_enabled: true, runtime_mode: 'production-database' } }));
const css = ['src/app/globals.css', 'src/app/minimal.css', 'src/app/styles/responsive.css', 'src/components/layout/workspace-background.css'].map(path => readFileSync(path, 'utf8')).join('\n');
const scoped = readFileSync('src/app/(workspace)/invoices/payments/payments-upload.module.css', 'utf8').replaceAll('.page', '.payment-upload-check').replaceAll('.stage', '.payment-stage-check').replaceAll('.background', '.payment-background-check').replace(/:global\(([^)]+)\)/g, '$1');
const html = `<!doctype html><html lang="cs"><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><style>${css}\n${scoped}\n@media(max-width: 820px){.sidebar{display:none}}</style><body>${markup}</body></html>`;
writeFileSync(join(output, 'preview.html'), html);
const executablePath = process.env.CHROME_PATH || ['/opt/pw-browsers/chromium', 'C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'].find(existsSync);
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
      panelExcess: document.querySelector('.gpc-panel').scrollHeight - document.querySelector('.gpc-panel').clientHeight, upload: document.querySelector('.gpc-upload-column').scrollHeight, safety: document.querySelector('.gpc-safety-card').scrollHeight,
      progressVisible: !!document.querySelector('.gpc-progress-wrap'),
      uploadWidth: document.querySelector('.gpc-dropzone').getBoundingClientRect().width,
      safetyVisible: getComputedStyle(document.querySelector('.gpc-safety-card')).display !== 'none',
      columns: getComputedStyle(document.querySelector('.gpc-intro-grid')).gridTemplateColumns,
      aligned: Math.abs(document.querySelector('.payments-hero').getBoundingClientRect().x - document.querySelector('.gpc-panel').getBoundingClientRect().x) < 1 && Math.abs(document.querySelector('.payments-hero').getBoundingClientRect().width - document.querySelector('.gpc-panel').getBoundingClientRect().width) < 1,
      centered: Math.abs((document.querySelector('.payment-stage-check').getBoundingClientRect().left + document.querySelector('.payment-stage-check').getBoundingClientRect().right) / 2 - (document.querySelector('.content').getBoundingClientRect().left + document.querySelector('.content').getBoundingClientRect().right) / 2) < 2,
    }));
    // Pravidla 1–4 jako u kontroly výpisu: overflow, překryv textu,
    // centrovaný sloupec, písmo >= 12 px a ovládací prvky >= 44 px.
    const rules = await page.evaluate(() => {
      const problems = [];
      const main = document.querySelector('main');
      const visible = element => element.getClientRects().length > 0 && element.checkVisibility({ visibilityProperty: true });
      for (const element of main.querySelectorAll('*')) {
        if (!visible(element) || ['inline', 'contents'].includes(getComputedStyle(element).display)) continue;
        const rect = element.getBoundingClientRect();
        if (rect.width && (rect.right > innerWidth + 1 || rect.left < -1)) problems.push({ rule: 1, outsideViewport: element.className || element.tagName });
      }
      const texts = document.createTreeWalker(main, NodeFilter.SHOW_TEXT);
      const boxes = [];
      while (texts.nextNode()) {
        const parent = texts.currentNode.parentElement;
        if (!texts.currentNode.textContent.trim() || !visible(parent)) continue;
        const size = parseFloat(getComputedStyle(parent).fontSize);
        if (size < 12) problems.push({ rule: 4, tinyText: `${parent.className || parent.tagName}:${size}`, text: parent.textContent.trim().slice(0, 30) });
        const range = document.createRange();
        range.selectNodeContents(texts.currentNode);
        for (const rect of range.getClientRects()) if (rect.width > 1) boxes.push({ rect, parent });
      }
      for (let a = 0; a < boxes.length; a++) for (let b = a + 1; b < boxes.length; b++) {
        if (boxes[a].parent === boxes[b].parent) continue;
        const r1 = boxes[a].rect, r2 = boxes[b].rect;
        if (Math.min(r1.right, r2.right) - Math.max(r1.left, r2.left) > 2 && Math.min(r1.bottom, r2.bottom) - Math.max(r1.top, r2.top) > 2) problems.push({ rule: 2, textOverlap: [boxes[a].parent.textContent.trim().slice(0, 20), boxes[b].parent.textContent.trim().slice(0, 20)] });
      }
      const style = getComputedStyle(main);
      const content = main.getBoundingClientRect();
      const panel = document.querySelector('.gpc-panel').getBoundingClientRect();
      const left = panel.left - (content.left + parseFloat(style.paddingLeft));
      const right = content.right - parseFloat(style.paddingRight) - panel.right;
      if (Math.abs(left - right) > 1) problems.push({ rule: 3, notCentred: [Math.round(left), Math.round(right)] });
      for (const control of main.querySelectorAll('button, a.btn, a.payments-switch, input:not([type="file"]), label.gpc-dropzone')) {
        if (!visible(control)) continue;
        const rect = control.getBoundingClientRect();
        if (rect.height < 43.5 || rect.width < 43.5) problems.push({ rule: 4, smallControl: `${control.className || control.tagName}:${Math.round(rect.width)}x${Math.round(rect.height)}` });
      }
      return problems;
    });
    if (rules.length) throw new Error(`${width}×${height}: ${JSON.stringify(rules.slice(0, 8))}`);
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
