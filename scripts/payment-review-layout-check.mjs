// Kontrola rozložení obrazovky kontroly bankovního výpisu (párování plateb).
// Skutečné komponenty se vykreslí v prohlížeči s lokálními daty: apiFetch je
// nahrazený fixturami, žádný účet ani databáze. Spouští se:
//   CHROME_PATH=/opt/pw-browsers/chromium node scripts/payment-review-layout-check.mjs [--quick]
// Výsledky a snímky: <tmp>/payment-review-layout-check/.
import { readFileSync, mkdirSync, writeFileSync, existsSync } from 'node:fs';
import { join, dirname, resolve as resolvePath, relative } from 'node:path';
import { tmpdir } from 'node:os';
import { createRequire } from 'node:module';
import ts from 'typescript';
import { chromium } from '@playwright/test';

const require = createRequire(import.meta.url);
const root = resolvePath(dirname(new URL(import.meta.url).pathname), '..');
const output = join(tmpdir(), 'payment-review-layout-check');
mkdirSync(output, { recursive: true });
const quick = process.argv.includes('--quick');

// ---------------------------------------------------------------- bundling
// Moduly se sbírají procházením importů od vstupní komponenty, takže nové
// soubory (karta platby, výběr faktury …) kontrola najde sama.
const STUBBED = new Set(['next/link', 'next/navigation', '@/lib/api-client', '@/lib/confirm-action', '@/lib/sign-out', '@/components/company-logo', '@/lib/use-access-role', '@/components/esko/esko-assistant', 'swr', 'react', 'react/jsx-runtime', 'react-dom', 'react-dom/client', 'scheduler']);
const modules = {};
const globalCss = [];
const moduleCss = [];
function resolveSpec(from, spec) {
  let base;
  if (spec.startsWith('@/')) base = join(root, 'src', spec.slice(2));
  else if (spec.startsWith('.')) base = resolvePath(dirname(from), spec);
  else return null;
  for (const ext of ['', '.ts', '.tsx', '/index.ts', '/index.tsx']) {
    const candidate = base + ext;
    if (existsSync(candidate) && !candidate.endsWith('/') && (ext || /\.(tsx?|css)$/.test(candidate))) return candidate;
  }
  throw new Error(`Cannot resolve ${spec} from ${relative(root, from)}`);
}
function moduleClassName(path, name) {
  return `m_${relative(root, path).replace(/[^a-z0-9]+/gi, '_')}__${name}`;
}
function scopeModuleCss(path) {
  const globals = [];
  let css = readFileSync(path, 'utf8').replace(/:global\(([^()]*(?:\([^()]*\)[^()]*)*)\)/g, (_match, inner) => `__GLOBAL${globals.push(inner) - 1}__`);
  css = css.replace(/\.(-?[_a-zA-Z][\w-]*)/g, (_match, name) => `.${moduleClassName(path, name)}`);
  return css.replace(/__GLOBAL(\d+)__/g, (_match, index) => globals[Number(index)]);
}
function collect(path) {
  const id = relative(root, path);
  if (modules[id]) return id;
  const code = ts.transpileModule(readFileSync(path, 'utf8'), { compilerOptions: { jsx: ts.JsxEmit.ReactJSX, module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText;
  const deps = {};
  modules[id] = { code, deps };
  for (const [, spec] of code.matchAll(/require\("([^"]+)"\)/g)) {
    if (STUBBED.has(spec)) { deps[spec] = spec; continue; }
    if (spec.endsWith('.css')) {
      const cssPath = resolveSpec(path, spec);
      if (spec.endsWith('.module.css')) {
        if (!moduleCss.some(item => item.path === cssPath)) moduleCss.push({ path: cssPath, css: scopeModuleCss(cssPath) });
        deps[spec] = `css-module:${relative(root, cssPath)}`;
      } else {
        if (!globalCss.includes(cssPath)) globalCss.push(cssPath);
        deps[spec] = 'css';
      }
      continue;
    }
    const target = resolveSpec(path, spec);
    if (!target) throw new Error(`Unexpected UI dependency ${spec} in ${id}`);
    deps[spec] = collect(target);
  }
  return id;
}
const shellId = collect(join(root, 'src/components/layout/app-shell.tsx'));
const clientId = collect(join(root, 'src/app/(workspace)/invoices/payments/payments-client.tsx'));
const fromReactDom = createRequire(require.resolve('react-dom/package.json'));
const resolvePackage = (name) => { try { return require.resolve(`${name}/package.json`); } catch { return fromReactDom.resolve(`${name}/package.json`); } };
const packageFile = (name, file) => readFileSync(join(dirname(resolvePackage(name)), 'cjs', file), 'utf8');
const vendor = {
  react: packageFile('react', 'react.production.js'),
  'react/jsx-runtime': packageFile('react', 'react-jsx-runtime.production.js'),
  'react-dom': packageFile('react-dom', 'react-dom.production.js'),
  'react-dom/client': packageFile('react-dom', 'react-dom-client.production.js'),
  scheduler: packageFile('scheduler', 'scheduler.production.js'),
};
const css = [
  'src/app/globals.css', 'src/app/minimal.css', 'src/app/styles/responsive.css',
  ...globalCss.map(path => relative(root, path)),
].filter((path, index, all) => all.indexOf(path) === index).map(path => readFileSync(join(root, path), 'utf8')).join('\n') + '\n' + moduleCss.map(item => item.css).join('\n');

// ---------------------------------------------------------------- fixtures
const LONG = 'Mezinárodní stavební, obchodní a logistická společnost s velmi dlouhým názvem a ještě delším dodatkem s.r.o.';
function invoice(index, stress) {
  return {
    id: `inv-${index}`,
    invoice_number: stress ? `FV-2026-DLOUHECISLOFAKTURY-${100000 + index}` : `2026${String(index + 1).padStart(4, '0')}`,
    counterparty_name: stress ? `${LONG} ${index}` : ['Novák stavby s.r.o.', 'Kavárna U Mostu', 'Jana Dvořáková', 'Truhlářství Beneš'][index % 4],
    amount: stress ? 999999999.99 : [12100, 4840, 30250, 1815][index % 4],
    paid_amount: 0,
    currency: 'CZK',
    variable_symbol: stress ? `20269${String(index).padStart(5, '0')}` : `2026${String(index + 1).padStart(4, '0')}`,
  };
}
function entry(index, overrides, stress) {
  const base = {
    id: `entry-${index}`,
    line_number: index + 2,
    fingerprint: `fp-${index}`,
    disposition: 'accepted',
    reason: null,
    amount: stress ? 999999999.99 : 12100,
    currency: 'CZK',
    booked_on: '2026-10-08',
    variable_symbol: stress ? `20269${String(index).padStart(5, '0')}` : '20260001',
    counterparty_name: stress ? `${LONG} ${index}` : 'Novák stavby s.r.o.',
    counterparty_account: stress ? 'CZ6508000000192000145399' : '123456789/0800',
    counterparty_account_verified: true,
    proposal_kind: null,
    proposal_confidence: null,
    proposal_reason: null,
    proposed_invoice_ids: [],
    bank_payment_id: null,
    processing_error: null,
    overlap_warning: false,
    overlap_acknowledged_by: null,
    unrelated_at: null,
  };
  return { ...base, ...overrides };
}
// Každý druh platby, který obrazovka umí ukázat.
function kinds(index, stress) {
  const kind = index % 9;
  const inv = `inv-${index % 30}`;
  switch (kind) {
    case 0: return entry(index, { bank_payment_id: `pay-${index}`, proposal_kind: 'exact', proposal_confidence: 'safe', proposal_reason: 'Sedí variabilní symbol i částka.', proposed_invoice_ids: [inv] }, stress);
    case 1: return entry(index, { proposal_kind: 'exact', proposal_confidence: 'review', proposal_reason: 'Stejný plátce a přesná částka, ale jiný variabilní symbol.', proposed_invoice_ids: [inv] }, stress);
    case 2: return entry(index, { proposal_kind: 'combination', proposal_confidence: 'review', proposal_reason: 'Součet dvou otevřených faktur stejného odběratele odpovídá platbě.', proposed_invoice_ids: [inv, `inv-${(index + 1) % 30}`], amount: stress ? 999999999.99 : 16940 }, stress);
    case 3: return entry(index, { proposal_kind: 'manual', proposal_confidence: 'review', variable_symbol: null, counterparty_name: stress ? `${LONG} bez symbolu` : 'Neznámý plátce' }, stress);
    case 4: return entry(index, { disposition: 'ignored', reason: 'Odchozí platba', amount: stress ? -999999999.99 : -2500 }, stress);
    case 5: return entry(index, { disposition: 'duplicate', reason: 'Tento řádek už byl importován z jiného výpisu.' }, stress);
    case 6: return entry(index, { disposition: 'error', reason: 'Řádek nemá platnou částku.', amount: null, currency: null, counterparty_name: null }, stress);
    case 7: return entry(index, { proposal_kind: 'exact', proposal_confidence: 'review', proposal_reason: 'Sedí částka.', proposed_invoice_ids: [inv], amount: stress ? 499999999.99 : 6050 }, stress);
    default: return entry(index, { overlap_warning: true, proposal_kind: 'manual', proposal_confidence: 'review' }, stress);
  }
}
function scenario(name) {
  const stress = name === 'stress';
  const count = name === 'empty' ? 0 : stress ? 40 : 9;
  const invoices = Array.from({ length: stress ? 30 : 8 }, (_, index) => invoice(index, stress));
  const entries = Array.from({ length: count }, (_, index) => kinds(index, stress));
  const totals = {
    accepted: entries.filter(item => item.disposition === 'accepted').length,
    ignored: entries.filter(item => item.disposition === 'ignored' || item.disposition === 'duplicate').length,
    errors: entries.filter(item => item.disposition === 'error').length,
  };
  const importRow = { id: 'imp-1', revision: 3, duplicate: false, status: 'review' };
  const preview = {
    import: importRow,
    account_mismatch: name === 'mismatch',
    statement_account: name === 'mismatch' ? '19-2000145399/0800' : '6786420257/0100',
    expected_account: '6786420257/0100',
    statement_bank: { code: '0100', name: 'Komerční banka', verified: true },
    totals,
    entries: entries.map(({ id, ...rest }) => rest),
    proposal_invoices: invoices,
    total_entries: entries.length,
    request_id: 'req-1',
  };
  const allocations = entries.filter(item => item.bank_payment_id).map(item => ({ statement_entry_id: item.id, invoice_id: item.proposed_invoice_ids[0], amount: item.amount, is_manual_partial: false, is_committed: true }));
  const detail = {
    progress: { booked: allocations.length, errors: totals.errors, remaining: totals.accepted - allocations.length },
    match_reasons: Object.fromEntries(entries.filter(item => item.bank_payment_id).map(item => [item.bank_payment_id, 'Sedí variabilní symbol i částka.'])),
    own_transfers: stress ? { 'entry-12': 'Platba přišla z účtu 6844160247/0100, který patří vaší firmě.' } : {},
    import: importRow,
    totals,
    total_entries: entries.length,
    entries,
    allocations,
    proposal_invoices: invoices,
    total: entries.length,
  };
  return { name, preview, detail, invoices, fail: name === 'error' };
}

// ---------------------------------------------------------------- browser
function pageHtml(fixture) {
  return `<!doctype html><html lang="cs"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Párování – kontrola rozložení</title><style>${css}</style></head><body><div id="root"></div><script>${mountScript(fixture)}</script></body></html>`;
}
function mountScript(fixture) {
  return `(() => {
    const modules = ${JSON.stringify(modules)};
    const vendor = ${JSON.stringify(vendor)};
    const fixture = ${JSON.stringify(fixture)};
    const moduleClass = ${moduleClassName.toString()};
    window.__confirmations = [];
    window.__requests = [];
    const cache = {};
    function vendorRequire(name) {
      if (cache[name]) return cache[name].exports;
      const module = cache[name] = { exports: {} };
      new Function('module', 'exports', 'require', 'process', vendor[name])(module, module.exports, vendorRequire, { env: { NODE_ENV: 'production' } });
      return module.exports;
    }
    const React = vendorRequire('react');
    class ApiRequestError extends Error { constructor(message, status, code, requestId) { super(message); this.status = status; this.code = code; this.requestId = requestId; } }
    const delay = (value) => new Promise(resolve => setTimeout(() => resolve(value), 5));
    async function apiFetch(url, init = {}) {
      const method = (init.method || 'GET').toUpperCase();
      window.__requests.push({ url: String(url), method, body: typeof init.body === 'string' ? init.body : null });
      const path = String(url).split('?')[0];
      if (path === '/api/payments/imports' && method === 'POST') {
        if (fixture.fail) throw new ApiRequestError('Výpis se nepodařilo přečíst: soubor nemá platnou hlavičku výpisu (řádek 1). Zkontrolujte, že jde o export ve formátu GPC nebo CSV z internetového bankovnictví.', 400, 'invalid', 'req-0123456789abcdef');
        return delay(fixture.preview);
      }
      if (path === '/api/payments/imports' && method === 'GET') return delay({ imports: [] });
      if (path === '/api/payments/invoice-candidates') {
        const q = new URL(String(url), 'http://x').searchParams.get('q') || '';
        const list = fixture.invoices.filter(item => !q || (item.invoice_number + ' ' + item.counterparty_name + ' ' + item.variable_symbol).toLowerCase().includes(q.toLowerCase()));
        return delay({ invoices: list.slice(0, 25), total: list.length });
      }
      if (path.startsWith('/api/payments/imports/') && method === 'GET') return delay(fixture.detail);
      if (path.startsWith('/api/settings/bank-accounts')) return delay({ accounts: [] });
      return delay({ revision: 4 });
    }
    const stubs = {
      react: React,
      'react/jsx-runtime': vendorRequire('react/jsx-runtime'),
      'react-dom': vendorRequire('react-dom'),
      'react-dom/client': vendorRequire('react-dom/client'),
      'next/link': { __esModule: true, default: ({ children, prefetch, ...props }) => React.createElement('a', props, children) },
      'next/navigation': { useRouter: () => ({ push() {}, replace() {}, refresh() {} }), usePathname: () => '/invoices/payments', useSearchParams: () => new URLSearchParams(fixture.search || '') },
      '@/lib/api-client': { apiFetch, ApiRequestError },
      '@/lib/confirm-action': { confirmAction: (options) => { window.__confirmations.push(options); return Promise.resolve(false); } },
      '@/lib/sign-out': { signOutCurrentSession: () => {} },
      '@/components/company-logo': { CompanyLogo: () => React.createElement('span', null, 'Splatno') },
      '@/lib/use-access-role': { useAccessRole: () => 'admin', useAccessProfile: () => ({ role: 'admin', name: 'Účetní', email: 'ucetni@example.cz', companyName: 'Firma s.r.o.' }), AccessProfileProvider: ({ children }) => children },
      '@/components/esko/esko-assistant': { EskoAssistant: () => null },
      swr: { __esModule: true, default: () => ({ data: undefined }) },
      css: {},
    };
    const loaded = {};
    function load(id) {
      if (loaded[id]) return loaded[id].exports;
      const { code, deps } = modules[id];
      const module = loaded[id] = { exports: {} };
      const localRequire = (spec) => {
        const target = deps[spec];
        if (stubs[target]) return stubs[target];
        if (target && target.startsWith('css-module:')) {
          const path = target.slice('css-module:'.length);
          return { __esModule: true, default: new Proxy({}, { get: (_t, key) => typeof key === 'string' ? moduleClass(path, key) : undefined }) };
        }
        if (!target) throw new Error('Unknown dependency ' + spec + ' in ' + id);
        return load(target);
      };
      new Function('module', 'exports', 'require', 'process', code)(module, module.exports, localRequire, { env: { NODE_ENV: 'production' } });
      return module.exports;
    }
    const { AppShell } = load(${JSON.stringify(shellId)});
    const { PaymentsClient } = load(${JSON.stringify(clientId)});
    const initialData = { payments: [], open_invoices: fixture.invoices, can_manage: true, gpc_enabled: true, runtime_mode: 'production-database', assistance_flags: { camt: false } };
    vendorRequire('react-dom/client').createRoot(document.getElementById('root')).render(
      React.createElement(AppShell, { initialProfile: { role: 'admin', name: 'Účetní', email: 'ucetni@example.cz', companyName: 'Firma s.r.o.' } }, React.createElement(PaymentsClient, { initialData })));
  })();`;
}
// moduleClassName uses relative()/root in Node; the browser gets precomputed ids.
// Replace the function body with a pure version for the browser.
const browserModuleClassName = `function moduleClassName(path, name) { return 'm_' + path.replace(/[^a-z0-9]+/gi, '_') + '__' + name; }`;

// ---------------------------------------------------------------- rules
// Runs in the page. Returns a list of findings; empty = pass.
function measure({ width }) {
  const problems = [];
  const main = document.querySelector('main');
  // checkVisibility: obsah sbaleného <details> má obdélníky, ale vidět není.
  const visible = (element) => element.getClientRects().length > 0 && element.checkVisibility({ visibilityProperty: true, opacityProperty: false });
  const textOf = (element) => (element.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 40);
  const name = (element) => (typeof element.className === 'string' && element.className.split(' ').filter(Boolean)[0]) || element.tagName.toLowerCase();
  const review = document.querySelector('.gpc-preview');

  // 1) Overflow: stránka, prvky v main i obsah karet.
  if (document.documentElement.scrollWidth > innerWidth + 1) problems.push({ rule: 1, pageOverflow: document.documentElement.scrollWidth - innerWidth });
  for (const element of main.querySelectorAll('*')) {
    if (!visible(element)) continue;
    const style = getComputedStyle(element);
    if (style.display === 'inline' || style.display === 'contents') continue;
    const rect = element.getBoundingClientRect();
    if (!rect.width || !rect.height) continue;
    if (rect.right > innerWidth + 1 || rect.left < -1) { problems.push({ rule: 1, outsideViewport: name(element), text: textOf(element), left: Math.round(rect.left), right: Math.round(rect.right) }); continue; }
    if (element.scrollWidth > element.clientWidth + 2 && !['auto', 'scroll'].includes(style.overflowX) && element.tagName !== 'INPUT' && element.tagName !== 'SELECT') problems.push({ rule: 1, clippedContent: name(element), text: textOf(element), scrollWidth: element.scrollWidth, clientWidth: element.clientWidth });
  }
  for (const card of document.querySelectorAll('.gpc-entry')) {
    if (!visible(card)) continue;
    const box = card.getBoundingClientRect();
    for (const element of card.querySelectorAll('*')) {
      if (!visible(element)) continue;
      const rect = element.getBoundingClientRect();
      if (!rect.width) continue;
      if (rect.right > box.right + 1 || rect.left < box.left - 1) problems.push({ rule: 1, outsideCard: name(element), text: textOf(element) });
    }
  }

  // 2) Překryv textu sourozenců (obdélníky textu, ne bloků).
  const scopes = [...document.querySelectorAll('.gpc-entry, .gpc-file-summary, .payments-hero, .gpc-confirm-bar, .payment-review-summary, .payment-commit-bar')].filter(visible);
  for (const scope of scopes) {
    const boxes = [];
    const walker = document.createTreeWalker(scope, NodeFilter.SHOW_TEXT);
    while (walker.nextNode()) {
      const node = walker.currentNode;
      if (!node.textContent.trim() || !visible(node.parentElement)) continue;
      const range = document.createRange();
      range.selectNodeContents(node);
      for (const rect of range.getClientRects()) if (rect.width > 1 && rect.height > 1) boxes.push({ rect, node: node.parentElement, text: node.textContent.trim().slice(0, 24) });
    }
    for (let a = 0; a < boxes.length; a++) for (let b = a + 1; b < boxes.length; b++) {
      if (boxes[a].node === boxes[b].node) continue;
      const r1 = boxes[a].rect, r2 = boxes[b].rect;
      if (Math.min(r1.right, r2.right) - Math.max(r1.left, r2.left) > 2 && Math.min(r1.bottom, r2.bottom) - Math.max(r1.top, r2.top) > 2) {
        problems.push({ rule: 2, textOverlap: [boxes[a].text, boxes[b].text] });
      }
    }
  }

  // 3) Centrovaný sloupec: stejné left/width a stejné okraje vlevo i vpravo.
  const mainStyle = getComputedStyle(main);
  const mainRect = main.getBoundingClientRect();
  const contentLeft = mainRect.left + parseFloat(mainStyle.paddingLeft);
  const contentRight = mainRect.right - parseFloat(mainStyle.paddingRight);
  const columnParts = ['.payments-hero', '.gpc-panel', '.payment-review-summary', '.gpc-entry-list', '.payment-commit-bar, .gpc-confirm-bar'].map(selector => document.querySelector(selector)).filter(element => element && visible(element));
  const reference = columnParts[0]?.getBoundingClientRect();
  if (reference) {
    const leftGap = reference.left - contentLeft;
    const rightGap = contentRight - reference.right;
    if (Math.abs(leftGap - rightGap) > 1) problems.push({ rule: 3, notCentred: { leftGap: Math.round(leftGap), rightGap: Math.round(rightGap) } });
  }
  if (review) {
    const column = document.querySelector('.gpc-panel').getBoundingClientRect();
    for (const selector of ['.payment-review-summary', '.gpc-entry-list', '.payment-commit-bar']) {
      const element = document.querySelector(selector);
      if (!element || !visible(element)) { problems.push({ rule: 3, missingColumnPart: selector }); continue; }
    }
    const hero = document.querySelector('.payments-hero').getBoundingClientRect();
    if (Math.abs(hero.left - column.left) > 1 || Math.abs(hero.width - column.width) > 1) problems.push({ rule: 3, heroNotAligned: true });
    for (const element of [document.querySelector('.payment-review-summary'), document.querySelector('.gpc-entry-list'), document.querySelector('.payment-commit-bar')].filter(Boolean)) {
      const rect = element.getBoundingClientRect();
      const inner = document.querySelector('.gpc-preview').getBoundingClientRect();
      if (Math.abs(rect.left - inner.left) > 1 || Math.abs(rect.width - inner.width) > 1) problems.push({ rule: 3, columnMisaligned: name(element), left: Math.round(rect.left), width: Math.round(rect.width), expected: [Math.round(inner.left), Math.round(inner.width)] });
    }
  }

  // 4) Čitelnost a dotyk: text >= 12 px, ovládací prvky >= 44 px.
  const tiny = new Map();
  const walker = document.createTreeWalker(main, NodeFilter.SHOW_TEXT);
  while (walker.nextNode()) {
    const parent = walker.currentNode.parentElement;
    if (!walker.currentNode.textContent.trim() || !visible(parent)) continue;
    const size = parseFloat(getComputedStyle(parent).fontSize);
    if (size < 12) tiny.set(name(parent) + ':' + size, textOf(parent));
  }
  for (const [key, text] of tiny) problems.push({ rule: 4, tinyText: key, text });
  const small = new Map();
  for (const control of main.querySelectorAll('button, a.btn, [role="button"], input:not([type="file"]):not([type="hidden"]), select, summary')) {
    if (!visible(control)) continue;
    let rect = control.getBoundingClientRect();
    // Zaškrtávátko se počítá s celým svým popiskem.
    if (control.matches('input[type="checkbox"], input[type="radio"]') && control.closest('label')) rect = control.closest('label').getBoundingClientRect();
    if (rect.height < 43.5 || rect.width < 43.5) small.set(name(control) + ':' + Math.round(rect.width) + 'x' + Math.round(rect.height), textOf(control));
  }
  for (const [key, text] of small) problems.push({ rule: 4, smallControl: key, text });

  // 6) Vnořené posuvníky (na mobilu žádné, jinak jen výběr faktury).
  for (const element of main.querySelectorAll('*')) {
    if (!visible(element)) continue;
    const style = getComputedStyle(element);
    if (!['auto', 'scroll'].includes(style.overflowY) || element.scrollHeight <= element.clientHeight + 1) continue;
    if (width < 768 || !element.matches('.invoice-picker-list')) problems.push({ rule: 6, nestedScroll: name(element), scrollHeight: element.scrollHeight, clientHeight: element.clientHeight });
  }

  // 7) Částky a symboly: nezalomené a neuseknuté.
  const pattern = /-?\d{1,3}(?:[\s\u00a0\u202f]\d{3})*,\d{2}[\s\u00a0\u202f]?(?:Kč|€|EUR|CZK)|\b\d{6,10}\b/g;
  const tokens = document.createTreeWalker(review || main, NodeFilter.SHOW_TEXT);
  const broken = new Set();
  while (tokens.nextNode()) {
    const node = tokens.currentNode;
    if (!visible(node.parentElement)) continue;
    for (const match of node.textContent.matchAll(pattern)) {
      const range = document.createRange();
      range.setStart(node, match.index);
      range.setEnd(node, match.index + match[0].length);
      const rects = [...range.getClientRects()].filter(rect => rect.width > 0);
      const lines = new Set(rects.map(rect => Math.round(rect.top)));
      const box = range.getBoundingClientRect();
      let clipper = node.parentElement;
      let clipped = box.right > innerWidth + 1;
      while (clipper && clipper !== main) {
        const style = getComputedStyle(clipper);
        if (style.overflowX !== 'visible' || style.textOverflow === 'ellipsis') {
          const outer = clipper.getBoundingClientRect();
          if (box.right > outer.right + 1 || box.left < outer.left - 1) clipped = true;
        }
        clipper = clipper.parentElement;
      }
      if (lines.size > 1 || clipped) broken.add(`${match[0]}:${lines.size > 1 ? 'wrapped' : 'clipped'}`);
    }
  }
  for (const item of broken) problems.push({ rule: 7, brokenValue: item });

  // 8) Karta platby: počet zón podle vlastní šířky.
  for (const card of [...document.querySelectorAll('.gpc-entry')].filter(visible).slice(0, 12)) {
    const zones = [...card.querySelectorAll(':scope [data-zone]')].filter(visible);
    const cardWidth = card.getBoundingClientRect().width;
    const expected = cardWidth < 520 ? 1 : cardWidth < 820 ? 2 : 3;
    if (!zones.length) { problems.push({ rule: 8, cardWithoutZones: textOf(card) }); continue; }
    const columns = new Set(zones.map(zone => Math.round(zone.getBoundingClientRect().left))).size;
    if (columns !== expected) problems.push({ rule: 8, wrongZones: columns, expected, cardWidth: Math.round(cardWidth) });
  }
  return problems;
}

// 5) Poslední karta nad spodní lištou + lišta na obrazovce během kontroly.
async function stickyBar(page) {
  return page.evaluate(async () => {
    const problems = [];
    const list = document.querySelector('.gpc-entry-list');
    const bar = document.querySelector('.payment-commit-bar, .gpc-confirm-bar');
    if (!list || !bar) return problems;
    const cards = [...list.querySelectorAll('.gpc-entry')];
    if (!cards.length) return problems;
    cards[0].scrollIntoView({ block: 'start' });
    await new Promise(requestAnimationFrame);
    const button = bar.querySelector('button.btn.primary, button');
    const rect = button.getBoundingClientRect();
    if (list.getBoundingClientRect().bottom > innerHeight && (rect.bottom > innerHeight + 1 || rect.top < 0)) problems.push({ rule: 5, commitButtonOffscreen: Math.round(rect.top) });
    scrollTo(0, document.documentElement.scrollHeight);
    for (const scroller of document.querySelectorAll('main, .gpc-panel')) scroller.scrollTop = scroller.scrollHeight;
    await new Promise(requestAnimationFrame);
    const last = cards[cards.length - 1].getBoundingClientRect();
    const barRect = bar.getBoundingClientRect();
    if (last.bottom > barRect.top + 1 && last.top < barRect.bottom) problems.push({ rule: 5, lastCardUnderBar: Math.round(last.bottom - barRect.top) });
    scrollTo(0, 0);
    return problems;
  });
}

// ---------------------------------------------------------------- run
const executablePath = process.env.CHROME_PATH || ['/opt/pw-browsers/chromium', 'C:/Program Files/Google/Chrome/Application/chrome.exe'].find(existsSync);
const browser = await chromium.launch({ executablePath, headless: true });
const widths = quick ? [320, 390, 768, 1280, 1920] : [320, 360, 375, 390, 414, 430, 480, 600, 768, 820, 1024, 1180, 1280, 1366, 1440, 1600, 1920, 2560];
const heights = quick ? [900] : [600, 900];
const scenarios = ['normal', 'stress', 'empty', 'error', 'mismatch'];
const shots = new Set(['normal@320', 'normal@390', 'normal@768', 'normal@1280', 'normal@1920', 'normal@zoom', 'mismatch@390', 'mismatch@1280', 'stress@390', 'stress@1440', 'error@390', 'empty@1280']);
const results = [];
const label = process.env.SHOT_LABEL || 'current';
try {
  for (const name of scenarios) {
    const fixture = scenario(name);
    const html = pageHtml(fixture).replace(moduleClassName.toString(), browserModuleClassName);
    writeFileSync(join(output, `${name}.html`), html);
    for (const zoom of [1, 2]) {
      const page = await browser.newPage({ deviceScaleFactor: zoom });
      const errors = [];
      page.on('pageerror', error => errors.push(error.message));
      await page.setViewportSize(zoom === 2 ? { width: 720, height: 450 } : { width: 1280, height: 900 });
      await page.setContent(html);
      await page.waitForSelector('input[type="file"]', { state: 'attached', timeout: 5000 });
      await page.setInputFiles('input[type="file"]', { name: 'vypis-rijen-2026.gpc', mimeType: 'application/octet-stream', buffer: Buffer.from('074') });
      if (fixture.fail) await page.waitForSelector('.form-error', { timeout: 5000 });
      else await page.waitForSelector(name === 'empty' ? '.gpc-preview' : '.gpc-entry', { timeout: 5000 });
      await page.waitForTimeout(150);
      const sizes = zoom === 2 ? [[720, 450]] : widths.flatMap(width => heights.map(height => [width, height]));
      for (const [width, height] of sizes) {
        await page.setViewportSize({ width, height });
        await page.evaluate(() => new Promise(requestAnimationFrame));
        const failures = await page.evaluate(measure, { width });
        failures.push(...await stickyBar(page));
        if (errors.length) failures.push({ browserErrors: [...errors] });
        results.push({ scenario: name, width, height, zoom, failures });
        const key = `${name}@${zoom === 2 ? 'zoom' : width}`;
        if (shots.has(key) && (zoom === 2 || height === 900)) {
          await page.evaluate(() => scrollTo(0, 0));
          await page.screenshot({ path: join(output, `${label}-${key.replace('@', '-')}.png`), fullPage: true });
        }
      }
      await page.close();
    }
  }
} finally { await browser.close(); }
writeFileSync(join(output, `${label}-results.json`), JSON.stringify(results, null, 2));
const byRule = {};
for (const result of results) for (const failure of result.failures) {
  const rule = failure.rule ?? 'other';
  byRule[rule] = (byRule[rule] ?? 0) + 1;
}
const failed = results.filter(result => result.failures.length);
console.log(JSON.stringify({ output, checked: results.length, failedViews: failed.length, findingsByRule: byRule }, null, 2));
if (failed.length) process.exitCode = 1;
