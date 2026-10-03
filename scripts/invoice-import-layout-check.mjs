import { readFileSync, existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createRequire } from 'node:module';
import { runInNewContext } from 'node:vm';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import ts from 'typescript';
import { chromium } from '@playwright/test';

const require = createRequire(import.meta.url);
const output = join(tmpdir(), 'invoice-import-layout-check');
mkdirSync(output, { recursive: true });
let mode = 'document';
let stateIndex = 0;
const stubs = {
  react: { ...React, useState: initial => React.useState(stateIndex++ === 0 ? mode : initial) },
  'next/link': { __esModule: true, default: ({ children, ...props }) => React.createElement('a', props, children) },
  'next/navigation': { useRouter: () => ({}) },
  '@/components/layout/app-shell': { AppFrame: ({ children, className }) => React.createElement('div', { className: 'app-shell' }, React.createElement('aside', { className: 'sidebar' }), React.createElement('div', { className: 'workspace-background', 'data-variant': 'import' }), React.createElement('main', { className }, children)) },
  '@/components/invoice-form': { createEmptyInvoice: () => ({}), InvoiceForm: () => null },
  '@/lib/supabase-browser': {}, '@/lib/document-validation': {}, '@/components/document-preview': {}, '@/lib/document-locate': {}, '@/lib/vat': {},
  '@/lib/workspace-cache': { useInvalidateWorkspaceData: () => () => {} },
  './invoice-import.module.css': { __esModule: true, default: { page: 'import-page-check', start: 'import-start-check', stage: 'import-stage-check', header: 'import-header-check', formats: 'import-formats-check', guidance: 'import-guidance-check' } },
};
function load(path) {
  const code = ts.transpileModule(readFileSync(path, 'utf8'), { compilerOptions: { jsx: ts.JsxEmit.ReactJSX, module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText;
  const mod = { exports: {} };
  runInNewContext(code, { module: mod, exports: mod.exports, process: { env: {} }, require: name => {
    if (stubs[name]) return stubs[name];
    if (name === 'react/jsx-runtime') return require(name);
    throw new Error(`Unexpected dependency: ${name}`);
  } }, { filename: path });
  return mod.exports;
}
stubs['@/components/icons'] = load('src/components/icons.tsx');
const Page = load('src/app/(workspace)/invoices/import/page.tsx').default;
const css = ['src/app/globals.css', 'src/app/minimal.css', 'src/app/styles/responsive.css', 'src/components/layout/workspace-background.css'].map(path => readFileSync(path, 'utf8')).join('\n');
let scoped = readFileSync('src/app/(workspace)/invoices/import/invoice-import.module.css', 'utf8');
for (const [key, value] of Object.entries(stubs['./invoice-import.module.css'].default)) scoped = scoped.replaceAll(`.${key}`, `.${value}`);
scoped = scoped.replace(/:global\(([^)]+)\)/g, '$1');
const executablePath = ['C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'].find(existsSync);
const browser = await chromium.launch({ executablePath, headless: true });
try {
  const page = await browser.newPage();
  for (mode of ['document', 'csv']) {
    stateIndex = 0;
    const markup = renderToStaticMarkup(React.createElement(Page));
    const html = `<!doctype html><html lang="cs"><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><style>${css}\n${scoped}\n@media(max-width:1023px){.sidebar{display:none}}</style><body>${markup}</body></html>`;
    for (const [width, height] of [[320, 780], [390, 844], [768, 1024], [1024, 768], [1280, 720], [1440, 900], [1920, 947]]) {
      await page.setViewportSize({ width, height });
      await page.setContent(html);
      const result = await page.evaluate(() => ({ overflow: document.documentElement.scrollWidth > innerWidth, verticalOverflow: document.documentElement.scrollHeight > innerHeight, input: !!document.querySelector('input[type=file]'), guidance: !!document.querySelector('.import-guidance-check'), heights: [...document.querySelector('.import-stage-check').children].map(el => [el.className, el.getBoundingClientRect().height]) }));
      if (result.overflow || !result.input || !result.guidance || (width >= 1024 && result.verticalOverflow)) throw new Error(`${mode} ${width}: ${JSON.stringify(result)}`);
      console.log(`${mode} ${width}px: OK`);
      if ([390, 1920].includes(width)) await page.screenshot({ path: join(output, `${mode}-${width}.png`), fullPage: true });
    }
  }
  console.log(`Screenshots: ${output}`);
} finally { await browser.close(); }
