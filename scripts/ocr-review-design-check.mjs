import { mkdir, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { chromium, expect } from '@playwright/test';
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';
import sharp from 'sharp';

const root = process.cwd();
const fixture = resolve(root, '.cache/ocr-review-fixture');
const output = resolve(root, 'docs/redesign/visual-validation/ocr-review');
const before = process.argv.includes('--before');
if (before && existsSync(resolve(output, 'current-before.png'))) throw new Error('Baseline already exists');
await mkdir(fixture, { recursive: true });
await mkdir(output, { recursive: true });
const invoice = {
  invoice_number: '1443260157', variable_symbol: '1443260157',
  counterparty_name: 'WOOD & PAPER a.s.', counterparty_ico: '26229854',
  counterparty_dic: 'CZ26229854', counterparty_email: 'fakturace@example.invalid',
  amount_without_vat: 219990.91, vat_rate: 21, amount: 266189,
  currency: 'CZK', issue_date: '2026-09-15', due_date: '2026-09-23',
  reminder_policy_id: 'default', notes: '', source: 'ocr',
};
const sources = Object.fromEntries(Object.entries(invoice).filter(([key]) => !['source', 'notes', 'reminder_policy_id'].includes(key)).map(([key, value], index) => [key, {
  page: ['due_date', 'amount', 'amount_without_vat', 'vat_rate', 'currency'].includes(key) ? 2 : 1,
  line: index + 1, text: String(value), method: 'pdf_text', confidence: .97, bounds: null,
}]));
const decisions = Object.fromEntries(Object.keys(sources).map(key => [key, { status: 'verified', confidence: .97, reasons: [], candidates: [] }]));
const pdf = await PDFDocument.create();
const font = await pdf.embedFont(StandardFonts.Helvetica);
for (let number = 1; number <= 3; number++) {
  const page = pdf.addPage([595, 842]);
  page.drawText(number === 1 ? 'FAKTURA - danovy doklad' : `Priloha faktury / strana ${number}`, { x: 36, y: 800, size: 20, font });
  page.drawRectangle({ x: 28, y: 28, width: 539, height: 740, borderWidth: .7, borderColor: rgb(.2, .25, .22) });
  let y = 744;
  for (const [key, source] of Object.entries(sources).filter(([, source]) => source.page === number)) {
    page.drawText(key.replaceAll('_', ' '), { x: 36, y, size: 11, font, color: rgb(.4, .45, .45) });
    page.drawText(source.text, { x: 220, y, size: 15, font });
    source.bounds = { x: 220 / 595, y: (842 - y - 15 * .75) / 842, width: font.widthOfTextAtSize(source.text, 15) / 595, height: 15 / 842 };
    y -= 48;
  }
  page.drawText('Nazev polozky / sluzby', { x: 36, y: 354, size: 10, font });
  page.drawText('Mnozstvi     Cena bez DPH     DPH       Celkem', { x: 270, y: 354, size: 10, font });
  for (let row = 0; row < 15; row++) {
    const lineY = 338 - row * 18;
    page.drawLine({ start: { x: 28, y: lineY - 4 }, end: { x: 567, y: lineY - 4 }, thickness: .3, color: rgb(.75, .79, .77) });
    page.drawText(`Polozka ${row + 1} - fakturovane sluzby`, { x: 36, y: lineY, size: 9, font });
    page.drawText(`${row + 1} ks`, { x: 278, y: lineY, size: 9, font });
    page.drawText('1 200,00', { x: 345, y: lineY, size: 9, font });
    page.drawText('21 %', { x: 438, y: lineY, size: 9, font });
    page.drawText('1 452,00', { x: 495, y: lineY, size: 9, font });
  }
  page.drawText('Testovaci doklad pro vizualni kontrolu - zadna skutecna faktura', { x: 36, y: 44, size: 9, font });
}
const pdfBytes = Buffer.from(await pdf.save());
const imageBytes = await sharp(Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="595" height="842"><rect width="595" height="842" fill="white"/><text x="60" y="110" font-size="22">1443260157</text><text x="60" y="160" font-size="18">Original image invoice fixture</text></svg>`)).png().toBuffer();
await writeFile(resolve(fixture, 'invoice.pdf'), pdfBytes);
await writeFile(resolve(fixture, 'index.html'), '<html lang="cs"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><div id="root"></div><script type="module" src="/entry.tsx"></script></html>');
await writeFile(resolve(fixture, 'link.tsx'), `import{createElement}from'react';export default function Link({href,children,prefetch:_p,...props}){return createElement('a',{...props,href},children)}`);
await writeFile(resolve(fixture, 'image.tsx'), `import{createElement}from'react';export default function Image({src,alt,unoptimized:_u,preload:_pr,priority:_pi,fill:_f,...props}){return createElement('img',{...props,src,alt})}`);
await writeFile(resolve(fixture, 'navigation.tsx'), `export function usePathname(){return location.pathname}export function useRouter(){return{push:url=>window.__navigation=url,replace:()=>{},prefetch:()=>{},refresh:()=>{}}}export function useSearchParams(){return new URLSearchParams(location.search)}`);
await writeFile(resolve(fixture, 'storage.ts'), `export function createClient(){return{storage:{from:()=>({uploadToSignedUrl:async()=>({error:null})})}}}`);
await writeFile(resolve(fixture, 'entry.tsx'), `
import{createElement}from'react';import{createRoot}from'react-dom/client';
import '${root}/src/app/globals.css';import '${root}/src/app/minimal.css';import '${root}/src/app/styles/responsive.css';import '${root}/src/app/styles/invoice-cards.css';
import{AppShell}from'${root}/src/components/layout/app-shell';import{WorkspaceDataProvider}from'${root}/src/components/workspace-data-provider';import{ToastProvider}from'${root}/src/components/toast';import Page from '${root}/src/app/(workspace)/invoices/import/page';
const profile={role:'admin',name:'Tomáš Adamec',email:'tomas@example.invalid',companyName:'Demo firma s.r.o.'};
createRoot(document.getElementById('root')).render(createElement(WorkspaceDataProvider,null,createElement(ToastProvider,null,createElement(AppShell,{initialProfile:profile},createElement(Page)))));`);
const require = createRequire(import.meta.url);
const viteRequire = createRequire(require.resolve('vitest/config'));
const { createServer } = await import(pathToFileURL(viteRequire.resolve('vite')).href);
const originalFiles = ['src/app/(workspace)/invoices/import/page.tsx', 'src/components/invoice-form.tsx', 'src/components/document-preview.tsx'];
const originals = new Map(before ? originalFiles.map(path => [resolve(root, path), execFileSync('git', ['show', `HEAD:${path}`], { encoding: 'utf8' })]) : []);
const server = await createServer({ define: { 'process.env.NEXT_PUBLIC_OCR_PROVIDER': JSON.stringify('local') }, configFile: false, root: fixture, publicDir: resolve(root, 'public'), logLevel: 'error',
  plugins: [{ name: 'original-baseline', enforce: 'pre', load: id => originals.get(id) }],
  server: { host: '127.0.0.1', port: 4333, strictPort: true, fs: { allow: [root] } }, esbuild: { jsx: 'automatic' }, css: { postcss: { plugins: [] } },
  resolve: { alias: [
    { find: /^next\/link$/, replacement: resolve(fixture, 'link.tsx') },
    { find: /^next\/image$/, replacement: resolve(fixture, 'image.tsx') },
    { find: /^next\/navigation$/, replacement: resolve(fixture, 'navigation.tsx') },
    { find: '@/lib/supabase-browser', replacement: resolve(fixture, 'storage.ts') },
    { find: '@', replacement: resolve(root, 'src') },
  ], dedupe: ['react', 'react-dom'] },
});
await server.listen();
const browser = await chromium.launch({ headless: true });
if (process.argv.includes('--processing')) {
  try {
    const { runProcessingChecks } = await import('./ocr-processing-checks.mjs');
    await runProcessingChecks({ browser, invoice, sources, decisions, pdfBytes, root });
  } finally { await browser.close(); await server.close(); }
  process.exit(0);
}
const results = [], checks = [];
async function open(width = 1536, height = 1024, scenario = 'normal', count = 1) {
  const page = await browser.newPage({ viewport: { width, height }, locale: 'cs-CZ', timezoneId: 'Europe/Prague' });
  const errors = [], saves = [];
  if (scenario === 'identifiers') await page.addInitScript(() => {
    delete HTMLElement.prototype.showPopover;
    delete HTMLElement.prototype.hidePopover;
  });
  page.on('pageerror', error => errors.push(error.message));
  let extractionCount = 0;
  await page.route('**/*', async route => {
    const request = route.request(), url = new URL(request.url());
    if (url.hostname !== '127.0.0.1') return route.abort();
    if (!url.pathname.startsWith('/api/')) return route.continue();
    if (url.pathname === '/api/invoices/upload') return route.fulfill({ json: { path: `test/${request.postDataJSON().name}`, token: 'fixture' } });
    if (url.pathname === '/api/invoices/upload/verify') return route.fulfill({ json: { verified: true } });
    if (url.pathname === '/api/invoices/extract') {
      extractionCount++;
      if (scenario === 'ocr-error') return route.fulfill({ status: 503, json: { error: 'Testovací výpadek OCR' } });
      const currentInvoice = { ...invoice, file_url: request.postDataJSON().path, ...(count > 1 ? { invoice_number: `${invoice.invoice_number.slice(0, -1)}${extractionCount}` } : {}) };
      const currentDecisions = structuredClone(decisions);
      const currentSources = structuredClone(sources);
      if (scenario === 'image') currentSources.invoice_number = { ...currentSources.invoice_number, method: 'ocr', bounds: { x: .1, y: .1, width: .3, height: .04 } };
      if (scenario === 'review') {
        currentDecisions.due_date = { status: 'review', confidence: .6, reasons: ['Datum splatnosti vyžaduje ověření.'], candidates: [
          { value: '2026-09-23', page: 2, text: '2026-09-23', method: 'pdf_text', confidence: .6, role: 'document' },
          { value: '2026-09-24', page: 3, text: '2026-09-24', method: 'ocr', confidence: .5, role: 'document' },
        ] };
        currentDecisions.counterparty_email = { status: 'missing', confidence: 0, reasons: ['Doplňte e-mail pro upomínky.'], candidates: [] };
        currentInvoice.counterparty_email = '';
        delete currentSources.counterparty_email;
      }
      if (scenario === 'identifiers') {
        currentInvoice.counterparty_ico = '';
        currentInvoice.counterparty_dic = '';
        for (const [field, reason] of [
          ['counterparty_ico', 'IČO bez jednoznačné vazby na sekci odběratele nebylo přiřazeno. Zkontrolujte IČO ručně.'],
          ['counterparty_dic', 'DIČ uvedené u jiné osoby nebo firmy nebylo přiřazeno odběrateli. Zkontrolujte DIČ ručně.'],
        ]) {
          currentDecisions[field] = { status: 'missing', confidence: 0, reasons: [reason], candidates: [] };
          delete currentSources[field];
        }
      }
      if (scenario === 'many-warnings') {
        for (const field of ['invoice_number', 'due_date', 'counterparty_ico', 'counterparty_email', 'amount']) {
          currentDecisions[field] = { status: 'review', confidence: .55, reasons: ['Zkontrolujte tento údaj proti originálnímu dokladu.'], candidates: [] };
        }
      }
      if (scenario === 'prepayment') currentInvoice.money_evidence = { original_total: invoice.amount, total_source: 'read', adjustment: 0, adjustment_reason: '', adjustment_confirmed: false, initial_paid: 1000, initial_paid_confirmed: false, multi_rate: false };
      return route.fulfill({ json: { extraction: { invoice: currentInvoice, confidence: .97, warnings: scenario === 'review' ? ['Datum splatnosti vyžaduje ověření.', 'E-mail nebyl rozpoznán.'] : [], document_kind: 'issued_invoice', issuer_matches_organization: true,
        reminder_policy_assignment: { status: 'remembered', counterparty_ico: invoice.counterparty_ico, policy_id: 'default', policy_name: 'Výchozí upomínky' }, field_sources: currentSources, field_decisions: currentDecisions } } });
    }
    if (url.pathname === '/api/settings/reminder-policies') return route.fulfill({ json: { policies: [{ id: 'default', name: 'Výchozí upomínky', is_default: true, archived_at: null }, { id: 'other', name: 'Individuální upomínky', is_default: false, archived_at: null }] } });
    if (url.pathname === '/api/customers/search') return route.fulfill({ json: { customers: [{ id: 'customer', name: 'Nový odběratel', ico: '12345678', dic: 'CZ12345678', email: 'novy@example.invalid' }] } });
    if (url.pathname === '/api/invoices/reminder-policy-preference') return route.fulfill({ json: { assignment: null } });
    if (url.pathname === '/api/invoices' && request.method() === 'POST') {
      saves.push(request.postDataJSON());
      if (scenario === 'duplicate') return route.fulfill({ status: 409, json: { error: 'Faktura s tímto číslem již existuje.' } });
      await new Promise(resolve => setTimeout(resolve, 150));
      return route.fulfill({ json: { invoice: { id: 'saved-invoice' } } });
    }
    return route.fulfill({ json: {} });
  });
  await page.goto('http://127.0.0.1:4333/invoices/import');
  await page.locator('input[type=file][multiple]').setInputFiles(Array.from({ length: count }, (_, i) => ({ name: `144326015${count > 1 ? i + 1 : 7}.${scenario === 'image' ? 'png' : 'pdf'}`, mimeType: scenario === 'image' ? 'image/png' : 'application/pdf', buffer: scenario === 'image' ? imageBytes : pdfBytes })));
  await page.getByRole('button', { name: count === 1 ? 'Nahrát a načíst údaje' : `Nahrát a načíst ${count} dokumentů`, exact: true }).click();
  await expect(page.locator('#manual-invoice-form form')).toBeVisible();
  if (scenario !== 'ocr-error') await expect(page.locator(scenario === 'image' ? '.document-preview-image img' : '.document-preview canvas').first()).toBeAttached();
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(200);
  return { page, errors, saves };
}
async function check(name, fn) { await fn(); checks.push(name); console.log('PASS', name); }
try {
  for (const [width, height] of before ? [[1536, 1024]] : [[1536, 1024], [1440, 900], [1280, 800], [768, 1024], [390, 844]]) {
    const { page, errors } = await open(width, height);
    const metrics = await page.evaluate(() => {
      const rect = selector => { const r = document.querySelector(selector)?.getBoundingClientRect(); return r ? { x: r.x, y: r.y, width: r.width, height: r.height } : null; };
      return { viewport: { width: innerWidth, height: innerHeight }, body: { width: document.documentElement.scrollWidth, height: document.documentElement.scrollHeight },
        sidebar: rect('.sidebar'), topbar: rect('[data-workspace-topbar]'), header: rect('[data-ocr-header]'), form: rect('[data-ocr-form-panel]'), preview: rect('[data-ocr-document-panel]'), actions: rect('[aria-label="Uložení faktury"]'),
        inputs: document.querySelectorAll('#manual-invoice-form input, #manual-invoice-form select, #manual-invoice-form textarea').length,
        formContentHeight: document.querySelector('[data-ocr-form-panel]')?.scrollHeight,
        firstSectionHeight: document.querySelector('[data-ocr-section]')?.getBoundingClientRect().height,
        documentViewportHeight: document.querySelector('.document-preview-scroller')?.getBoundingClientRect().height };
    });
    if (!before) {
      expect(metrics.body.width).toBeLessThanOrEqual(width);
      expect(metrics.inputs).toBe(14);
      if (width >= 1024) {
        expect(metrics.body.height).toBeGreaterThan(height);
        expect(await page.locator('[data-ocr-form-panel]').evaluate(node => getComputedStyle(node).overflowY)).toBe('visible');
        expect(metrics.preview.x).toBeGreaterThan(metrics.form.x);
        expect(await page.locator('[data-ocr-form-panel] input').first().evaluate(node => node.getBoundingClientRect().height)).toBe(42);
        expect(await page.locator('[data-ocr-section]').first().evaluate(node => node.getBoundingClientRect().height)).toBeLessThan(380);
      }
      expect(errors).toEqual([]);
    }
    await page.screenshot({ path: resolve(output, before ? 'current-before.png' : width === 1536 ? 'current-after.png' : `after-${width}x${height}.png`) });
    if (!before && width === 390) await page.screenshot({ path: resolve(output, 'after-mobile-full.png'), fullPage: true });
    results.push(metrics);
    await page.close();
  }
  if (!before) {
    await check('Whole-page scrolling with sticky PDF, zoom, source highlighting and persistent page', async () => {
      const { page, errors } = await open();
      const formPanel = page.locator('[data-ocr-form-panel]');
      const preview = page.locator('.document-preview-scroller');
      await page.mouse.move(5, 5);
      await page.evaluate(() => window.scrollTo(0, 250));
      expect(await page.evaluate(() => scrollY)).toBeGreaterThan(100);
      expect(await formPanel.evaluate(node => node.scrollTop)).toBe(0);
      expect(await preview.evaluate(node => node.scrollTop)).toBe(0);
      const sticky = await page.locator('[data-ocr-document-panel]').boundingBox();
      expect(sticky.y).toBeGreaterThanOrEqual(19);
      expect(sticky.y).toBeLessThanOrEqual(21);
      await page.screenshot({path: resolve(output, 'page-scroll-sticky.png')});
      await page.getByRole('button', { name: 'Další strana', exact: true }).click();
      await expect(page.locator('.document-preview-pages')).toHaveText('Strana 2 / 3');
      const input = page.locator('[data-ocr-field="due_date"] input');
      await input.focus();
      await expect(page.locator('[data-page="2"] [data-highlight]')).toBeVisible();
      await page.setViewportSize({ width: 1440, height: 900 });
      await expect(page.locator('[data-page="2"] [data-highlight]')).toBeVisible();
      const normalized = () => page.locator('[data-page="2"] [data-highlight]').evaluate(node => ({ left: parseFloat(node.style.left), width: parseFloat(node.style.width) }));
      const first = await normalized();
      await page.getByRole('button', { name: 'Přiblížit', exact: true }).click();
      await expect(page.locator('.document-preview-zoom > span')).toHaveText('125 %');
      expect(await normalized()).toEqual(first);
      await page.locator('textarea').fill('Poznámka bez změny stránky náhledu');
      await expect(page.locator('.document-preview-pages')).toHaveText('Strana 2 / 3');
      expect(errors).toEqual([]);
      await page.close();
    });
    await check('Uncertain values, actionable summary, alternatives and missing email', async () => {
      const { page } = await open(1536, 1024, 'review');
      await expect(page.locator('.ocr-review-summary')).toContainText('2 údaje');
      await page.locator('.ocr-review-summary').click();
      await expect(page.locator('[data-ocr-field="due_date"] input')).toBeFocused();
      const warning = page.locator('[data-ocr-field="due_date"] .ocr-field-meta');
      const details = page.locator('[data-ocr-source]');
      await expect(details).not.toBeVisible();
      await expect(page.locator('.ocr-inline-reason, .ocr-extra-reasons')).toHaveCount(0);
      await warning.hover();
      await expect(details).toBeVisible();
      await expect(details).toContainText('Datum splatnosti vyžaduje ověření.');
      await page.mouse.move(5, 5);
      await expect(details).not.toBeVisible();
      await warning.focus();
      await expect(details).toBeVisible();
      await page.keyboard.press('Escape');
      await expect(details).not.toBeVisible();
      await page.getByRole('button', { name: 'Použít 2026-09-24', exact: false }).click();
      await expect(page.locator('[data-ocr-field="due_date"] input')).toHaveValue('2026-09-24');
      await page.locator('[data-ocr-field="counterparty_email"] input').fill('doplneny@example.invalid');
      await page.screenshot({ path: resolve(output, 'verification-required.png') });
      await page.close();
    });
    await check('Identifier warning tooltips work without native Popover API and remain readable on hover', async () => {
      const { page } = await open(1536, 1024, 'identifiers');
      await expect(page.locator('.ocr-inline-reason, .ocr-extra-reasons')).toHaveCount(0);
      for (const field of ['counterparty_ico', 'counterparty_dic']) {
        const icon = page.locator(`[data-ocr-field="${field}"] .ocr-field-meta.missing`);
        const popup = page.locator(`[data-ocr-source]`);
        await expect(icon).toBeVisible();
        await expect(popup).not.toBeVisible();
        await icon.hover();
        await expect(popup).toBeVisible();
        await expect(popup).toContainText(field === 'counterparty_ico' ? 'Zkontrolujte IČO ručně.' : 'Zkontrolujte DIČ ručně.');
        await page.mouse.move(5, 5);
        await expect(popup).not.toBeVisible();
      }
      await page.screenshot({ path: resolve(output, 'identifier-warnings-icons.png') });
      await page.locator('[data-ocr-field="counterparty_ico"] .ocr-field-meta.missing').hover();
      await expect(page.locator('[data-ocr-source]')).toBeVisible();
      await page.locator('[data-ocr-source]').hover();
      await expect(page.locator('[data-ocr-source]')).toContainText('Zkontrolujte IČO ručně.');
      await page.screenshot({ path: resolve(output, 'identifier-warning-tooltip.png') });
      await expect(page.locator('[data-ocr-source]')).toBeVisible();
      await page.mouse.move(5, 5);
      await expect(page.locator('[data-ocr-source]')).toHaveCount(0);
      await page.close();
    });
    await check('Native email validation, original OCR monetary rules, variable-symbol copy and complete save payload', async () => {
      const { page, saves } = await open();
      await page.locator('[data-ocr-field="variable_symbol"] input').fill('1');
      await page.getByRole('button', { name: 'Použít číslo faktury jako variabilní symbol' }).click();
      await expect(page.locator('[data-ocr-field="variable_symbol"] input')).toHaveValue(invoice.invoice_number);
      await page.locator('[data-ocr-field="vat_rate"] input').fill('12');
      await expect(page.locator('[data-ocr-field="amount"] input')).toHaveValue(String(invoice.amount));
      await page.locator('[data-ocr-field="counterparty_email"] input').fill('neplatny');
      await page.getByRole('button', { name: 'Uložit fakturu do Splatna', exact: true }).click();
      expect(saves).toHaveLength(0);
      await expect(page.locator('[data-ocr-field="counterparty_email"] input')).toBeFocused();
      await page.locator('[data-ocr-field="counterparty_email"] input').fill('opraveny@example.invalid');
      await page.locator('.reminder-policy-field select').selectOption('other');
      await page.locator('textarea').fill('Kontrola provedena');
      await page.getByRole('button', { name: 'Uložit fakturu do Splatna', exact: true }).click();
      await expect(page.getByRole('button', { name: 'Ukládám…' })).toBeDisabled();
      await expect.poll(() => saves.length).toBe(1);
      expect(saves[0]).toMatchObject({ variable_symbol: invoice.invoice_number, counterparty_email: 'opraveny@example.invalid', vat_rate: 12, amount: invoice.amount, reminder_policy_id: 'other', notes: 'Kontrola provedena' });
      await page.close();
    });
    await check('Duplicate errors remain available and return to import has no resume banner', async () => {
      const { page, saves } = await open(1536, 1024, 'duplicate');
      await page.locator('textarea').fill('Rozepsaná poznámka');
      await page.getByRole('button', { name: 'Uložit fakturu do Splatna', exact: true }).click();
      await expect(page.locator('#manual-invoice-form .form-error')).toContainText('již existuje');
      await expect(page.locator('[data-save-error]')).toBeFocused();
      expect(saves).toHaveLength(1);
      await page.getByRole('button', { name: 'Zpět na import', exact: true }).click();
      await expect(page.getByRole('heading', { name: 'Vyberte dokumenty faktur' })).toBeVisible();
      await expect(page.getByRole('button', { name: 'Pokračovat v kontrole rozpracovaných dokumentů' })).toHaveCount(0);
      await page.close();
    });
    await check('Batch save advances to next document and skipping remains available', async () => {
      const { page, saves } = await open(1536, 1024, 'normal', 2);
      await page.locator('textarea').fill('Koncept první faktury');
      await page.locator('summary[aria-label="Vybrat fakturu"]').click();
      await page.getByRole('group', {name: 'Výběr faktury'}).getByRole('button', {name: /1443260152.pdf/}).click();
      await expect(page.locator('[data-ocr-field="invoice_number"] input')).toHaveValue('1443260152');
      await page.locator('textarea').fill('Koncept druhé faktury');
      await page.locator('summary[aria-label="Vybrat fakturu"]').click();
      await page.getByRole('group', {name: 'Výběr faktury'}).getByRole('button', {name: /1443260151.pdf/}).click();
      await expect(page.locator('textarea')).toHaveValue('Koncept první faktury');
      await expect(page.locator('.document-preview-pages')).toHaveText('Strana 1 / 3');
      await page.locator('summary[aria-label="Vybrat fakturu"]').click();
      await page.screenshot({path: resolve(output, 'invoice-picker.png')});
      await page.keyboard.press('Escape');
      await page.getByRole('button', { name: 'Uložit fakturu do Splatna', exact: true }).click();
      await expect(page.locator('[data-ocr-header]')).toContainText('1/2');
      await expect(page.locator('[data-ocr-field="invoice_number"] input')).toHaveValue('1443260152');
      expect(saves).toHaveLength(1);
      await page.getByRole('button', { name: 'Přeskočit', exact: true }).click();
      await expect(page.locator('[data-ocr-batch]')).toHaveCount(0);
      await page.close();
    });
    await check('Mobile switches preserve edits and document state', async () => {
      const { page } = await open(390, 844);
      await page.locator('[data-ocr-field="invoice_number"] input').fill('999999999');
      await page.getByRole('tab', { name: 'Doklad', exact: true }).click();
      await expect(page.locator('.document-preview')).toBeVisible();
      await page.getByRole('button', { name: 'Další strana', exact: true }).click();
      await page.getByRole('tab', { name: 'Údaje', exact: true }).click();
      await expect(page.locator('[data-ocr-field="invoice_number"] input')).toHaveValue('999999999');
      await page.getByRole('tab', { name: 'Doklad', exact: true }).click();
      await expect(page.locator('.document-preview-pages')).toHaveText('Strana 2 / 3');
      await page.screenshot({ path: resolve(output, 'mobile-document.png') });
      await page.close();
    });
    await check('OCR failure retains original document, manual fields and retry', async () => {
      const { page } = await open(1536, 1024, 'ocr-error');
      await expect(page.locator('.document-preview canvas').first()).toBeVisible();
      await expect(page.getByRole('button', { name: 'Zkusit OCR znovu' })).toBeVisible();
      expect(await page.locator('#manual-invoice-form input, #manual-invoice-form select, #manual-invoice-form textarea').count()).toBe(14);
      await page.screenshot({ path: resolve(output, 'ocr-unavailable.png') });
      await page.close();
    });
    await check('Prepayment confirmation controls survive redesign', async () => {
      const { page, saves } = await open(1536, 1024, 'prepayment');
      await page.getByRole('button', { name: 'Uložit fakturu do Splatna', exact: true }).click();
      expect(saves).toHaveLength(0);
      await page.locator('.invoice-money-confirm input').check();
      await page.getByRole('button', { name: 'Uložit fakturu do Splatna', exact: true }).click();
      await expect.poll(() => saves.length).toBe(1);
      expect(saves[0].money_evidence.initial_paid_confirmed).toBe(true);
      await page.close();
    });
    await check('Customer matching preserves all customer fields', async () => {
      const { page } = await open();
      await page.locator('[data-ocr-field="counterparty_name"] input').fill('Nový');
      await page.locator('.customer-search-results button').click();
      await expect(page.locator('[data-ocr-field="counterparty_name"] input')).toHaveValue('Nový odběratel');
      await expect(page.locator('[data-ocr-field="counterparty_ico"] input')).toHaveValue('12345678');
      await expect(page.locator('[data-ocr-field="counterparty_dic"] input')).toHaveValue('CZ12345678');
      await expect(page.locator('[data-ocr-field="counterparty_email"] input')).toHaveValue('novy@example.invalid');
      await page.close();
    });
    await check('Image preview retains original mapped OCR region and zoom', async () => {
      const { page } = await open(1536, 1024, 'image');
      await page.locator('[data-ocr-field="invoice_number"] input').focus();
      await expect(page.locator('.document-preview-image [data-highlight]')).toBeVisible();
      expect(await page.locator('[data-highlight]').evaluate(node => node.style.left)).toBe('10%');
      await page.getByRole('button', { name: 'Přiblížit', exact: true }).click();
      await expect(page.locator('.document-preview-zoom > span')).toHaveText('125 %');
      expect(await page.locator('[data-highlight]').evaluate(node => node.style.left)).toBe('10%');
      await page.screenshot({ path: resolve(output, 'image-preview.png') });
      await page.close();
    });
    await check('Source details remain accessible outside the scrolling card and close on Escape', async () => {
      const { page } = await open();
      await page.locator('[data-ocr-field="invoice_number"] .ocr-field-meta').focus();
      const popup = page.locator('[data-ocr-source]');
      await expect(popup).toBeVisible();
      await expect(popup).toContainText('1443260157');
      const box = await popup.boundingBox();
      expect(box.x).toBeGreaterThanOrEqual(0);
      expect(box.y + box.height).toBeLessThanOrEqual(1024);
      await page.screenshot({ path: resolve(output, 'source-details.png') });
      await page.keyboard.press('Escape');
      await expect(page.locator('[data-ocr-source]')).toHaveCount(0);
      await expect(page.locator('[data-ocr-source]')).not.toBeVisible();
      await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
      await expect(page.locator('[data-ocr-field="amount"] input')).toBeVisible();
      await expect(page.locator('textarea')).toBeInViewport();
      await page.screenshot({ path: resolve(output, 'form-financial-fields.png') });
      await page.close();
    });
    await check('Five review warnings stay compact with a naturally scrolling form', async () => {
      const { page } = await open(1536, 1024, 'many-warnings');
      await expect(page.locator('.ocr-review-summary')).toContainText('5 údajů');
      await expect(page.locator('.ocr-inline-reason, .ocr-extra-reasons')).toHaveCount(0);
      await expect(page.locator('.ocr-field-meta.review')).toHaveCount(5);
      expect(await page.evaluate(() => document.documentElement.scrollHeight)).toBeGreaterThan(1024);
      const form = await page.locator('[data-ocr-form-panel]').boundingBox();
      const preview = await page.locator('[data-ocr-document-panel]').boundingBox();
      expect(form.y).toBe(preview.y);
      expect(form.height).toBeGreaterThan(preview.height);
      expect(await page.locator('.ocr-review-summary').evaluate(node => node.getBoundingClientRect().height)).toBeLessThanOrEqual(34);
      await page.screenshot({ path: resolve(output, 'verification-required-multiple.png') });
      await page.close();
    });
  }
  await writeFile(resolve(output, before ? 'before-validation.json' : 'validation.json'), JSON.stringify({ results, checks, data: 'Synthetic OCR and API fixtures; real React components and PDF.js renderer; no production writes.' }, null, 2));
  console.log(JSON.stringify({ viewports: results.length, functional: checks.length, output }, null, 2));
} finally { await browser.close(); await server.close(); }
