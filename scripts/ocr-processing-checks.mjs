import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { expect } from '@playwright/test';

// Actual import page + AppShell and React state. All API/storage responses are
// local fixtures: no real documents are uploaded or invoices saved.
export async function runProcessingChecks({ browser, invoice, sources, decisions, pdfBytes, root }) {
  const output = resolve(root, 'docs/redesign/visual-validation/ocr-processing');
  await mkdir(output, { recursive: true });
  const checks = [], screenshots = [];
  async function session({ width = 1536, height = 1024, count = 1, failUpload = [], failOcr = [] } = {}) {
    const page = await browser.newPage({ viewport: { width, height }, locale: 'cs-CZ', timezoneId: 'Europe/Prague' });
    const errors = [], pending = new Map(), requests = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.route('**/*', async route => {
      const request = route.request(), url = new URL(request.url());
      if (url.hostname !== '127.0.0.1') return route.abort();
      if (!url.pathname.startsWith('/api/')) return route.continue();
      if (url.pathname === '/api/invoices/upload') {
        const name = request.postDataJSON().name;
        requests.push(name);
        if (failUpload.includes(name)) return route.fulfill({ status: 400, json: { error: `Nepodařilo se nahrát ${name}` } });
        return route.fulfill({ json: { path: `test/${name}`, token: 'fixture' } });
      }
      if (url.pathname === '/api/invoices/upload/verify') return route.fulfill({ json: { verified: true } });
      if (url.pathname === '/api/invoices/extract') {
        const path = request.postDataJSON().path, name = path.split('/').at(-1);
        await new Promise(resolve => pending.set(name, resolve));
        if (page.isClosed()) return;
        if (failOcr.includes(name)) return route.fulfill({ status: 503, json: { error: 'Testovací výpadek OCR' } });
        return route.fulfill({ json: { extraction: {
          invoice: { ...invoice, file_url: path, invoice_number: name.replace('.pdf', '') }, confidence: .97,
          warnings: [], document_kind: 'issued_invoice', issuer_matches_organization: true,
          reminder_policy_assignment: { status: 'remembered', counterparty_ico: invoice.counterparty_ico, policy_id: 'default', policy_name: 'Výchozí upomínky' },
          field_sources: sources, field_decisions: decisions,
        } } });
      }
      if (url.pathname === '/api/settings/reminder-policies') return route.fulfill({ json: { policies: [{ id: 'default', name: 'Výchozí upomínky', is_default: true, archived_at: null }] } });
      return route.fulfill({ json: {} });
    });
    await page.goto('http://127.0.0.1:4333/invoices/import');
    await page.locator('input[type=file][multiple]').setInputFiles(Array.from({ length: count }, (_, i) => ({ name: `${2600633 + i}.pdf`, mimeType: 'application/pdf', buffer: pdfBytes })));
    await page.getByRole('button', { name: count === 1 ? 'Nahrát a načíst údaje' : `Nahrát a načíst ${count} dokumentů`, exact: true }).click();
    async function wait(name) { await expect.poll(() => pending.has(name)).toBe(true); }
    async function finish(name) { await wait(name); pending.get(name)(); pending.delete(name); }
    async function close() { for (const release of pending.values()) release(); await page.close(); }
    return { page, pending, wait, finish, close, errors, requests };
  }
  async function shot(page, name) {
    await page.screenshot({ path: resolve(output, `${name}.png`), fullPage: true, animations: 'disabled' });
    const metrics = await page.evaluate(() => {
      const node = document.querySelector('[data-ocr-processing]');
      const { x, y, width, height } = node.getBoundingClientRect();
      return { card: { x, y, width, height }, bodyWidth: document.documentElement.scrollWidth, viewportWidth: innerWidth };
    });
    expect(metrics.bodyWidth).toBeLessThanOrEqual(metrics.viewportWidth);
    expect(await page.locator('[role="progressbar"]').evaluate(node => node.scrollWidth <= node.clientWidth)).toBe(true);
    screenshots.push({ name, ...metrics });
  }
  for (const [width, height] of [[1536, 1024], [1280, 800], [768, 1024], [390, 844]]) {
    const s = await session({ width, height, count: 3 });
    try {
      await s.wait('2600633.pdf');
      await expect(s.page.locator('[data-ocr-processing]')).toBeVisible();
      await expect(s.page.locator('[role="progressbar"]')).toHaveAttribute('aria-valuetext', /Zpracováno 0 z 3/);
      expect(await s.page.locator('[role="progressbar"]').getAttribute('aria-valuenow')).toBeNull();
      await expect(s.page.locator('[aria-current="step"]')).toContainText('Rozpoznávání textu pomocí OCR');
      await expect(s.page.locator('.import-progress, .import-queue-summary, .import-queue-tabs')).toHaveCount(0);
      await shot(s.page, `loading-${width}x${height}`);
      if (width === 1536) await s.page.locator('[data-ocr-processing]').screenshot({ path: resolve(output, 'loading-card.png'), animations: 'disabled' });
      await expect(s.page.locator('[data-ocr-processing] details')).toHaveCount(0);
      await s.finish('2600633.pdf');
      await s.wait('2600634.pdf');
      await expect(s.page.locator('[data-ocr-workspace]')).toBeVisible();
      await expect(s.page.locator('[data-ocr-processing]')).toHaveCount(0);
      await expect(s.page.locator('[data-ocr-background-processing]')).toHaveCount(0);
      await s.page.locator('summary[aria-label="Vybrat fakturu"]').click();
      const processingChoice = s.page.locator('[aria-label="Výběr faktury"] button').nth(1);
      await expect(processingChoice).toContainText('Zpracovávám…');
      await expect(processingChoice.locator('[data-ocr-processing-spinner]')).toBeVisible();
      await expect(processingChoice).toBeDisabled();
      await expect(s.page.locator('[aria-label="Výběr faktury"] button').nth(2)).toContainText('Čeká');
      await expect(s.page.locator('[aria-label="Výběr faktury"] button').nth(2).locator('[data-ocr-processing-spinner]')).toHaveCount(0);
      if (width === 1536) await s.page.screenshot({ path: resolve(output, 'picker-loading.png'), fullPage: true });
      await s.page.keyboard.press('Escape');
      if (width >= 1024) {
        const picker = await s.page.locator('summary[aria-label="Vybrat fakturu"]').boundingBox();
        const input = await s.page.locator('[data-ocr-field="variable_symbol"] input').boundingBox();
        expect(Math.abs(picker.x + picker.width - input.x - input.width)).toBeLessThan(1);
      }
      await s.page.locator('textarea').fill('Kontroluji první fakturu během OCR');
      if (width === 1536) await s.page.screenshot({ path: resolve(output, 'background-review.png'), fullPage: true });
      await s.finish('2600634.pdf');
      await s.wait('2600635.pdf');
      await expect(s.page.locator('[data-ocr-field="invoice_number"] input')).toHaveValue('2600633');
      await expect(s.page.locator('textarea')).toHaveValue('Kontroluji první fakturu během OCR');
      await s.page.locator('summary[aria-label="Vybrat fakturu"]').click();
      await s.page.locator('[aria-label="Výběr faktury"] button').nth(1).click();
      await s.page.locator('textarea').fill('Kontroluji druhou fakturu během OCR');
      await s.finish('2600635.pdf');
      await expect(s.page.locator('[data-ocr-processing-spinner]')).toHaveCount(0);
      await expect(s.page.locator('[data-ocr-field="invoice_number"] input')).toHaveValue('2600634');
      await expect(s.page.locator('textarea')).toHaveValue('Kontroluji druhou fakturu během OCR');
      await s.page.locator('summary[aria-label="Vybrat fakturu"]').click();
      await s.page.locator('[aria-label="Výběr faktury"] button').nth(0).click();
      await expect(s.page.locator('textarea')).toHaveValue('Kontroluji první fakturu během OCR');
      await expect(s.page.getByRole('button', { name: 'Uložit fakturu do Splatna' })).toBeEnabled();
      expect(s.errors).toEqual([]);
      checks.push(`Batch: immediate review/background OCR/draft persistence/stable selection/no overflow at ${width}×${height}`);
    } finally { await s.close(); }
  }
  {
    const s = await session();
    try {
      await s.wait('2600633.pdf');
      await expect(s.page.locator('[role="progressbar"]')).toHaveAttribute('aria-valuetext', /Zpracováno 0 z 1/);
      await s.finish('2600633.pdf');
      await expect(s.page.locator('[data-ocr-workspace]')).toBeVisible();
      await expect(s.page.locator('[data-ocr-batch]')).toHaveCount(0);
      // Returning to import keeps the existing draft and does not show the
      // previously removed "Pokračovat..." banner.
      await s.page.getByRole('button', { name: 'Zpět na import' }).click();
      await expect(s.page.getByRole('heading', { name: 'Vyberte dokumenty faktur' })).toBeVisible();
      await expect(s.page.getByText('Pokračovat v kontrole rozpracovaných dokumentů')).toHaveCount(0);
      expect(s.errors).toEqual([]);
      checks.push('Single document → review → back to import; no resume banner');
    } finally { await s.close(); }
  }
  {
    const s = await session({ count: 3 });
    try {
      await s.finish('2600633.pdf');
      await s.wait('2600634.pdf');
      await s.page.locator('summary[aria-label="Vybrat fakturu"]').click();
      await s.page.getByRole('button', { name: 'Zastavit zpracování' }).click();
      await s.page.keyboard.press('Escape');
      await s.finish('2600634.pdf');
      await expect(s.page.locator('[data-ocr-workspace]')).toBeVisible();
      expect(s.requests).toEqual(['2600633.pdf', '2600634.pdf']);
      await s.page.locator('summary[aria-label="Vybrat fakturu"]').click();
      const choices = s.page.locator('[aria-label="Výběr faktury"] button');
      await expect(choices.nth(0)).toContainText('Ke kontrole');
      await expect(choices.nth(1)).toContainText('Ke kontrole');
      await expect(choices.nth(2)).toBeDisabled();
      expect(s.errors).toEqual([]);
      checks.push('Stop completes current document, retains finished items, leaves next item pending');
    } finally { await s.close(); }
  }
  {
    const s = await session({ count: 3, failUpload: ['2600633.pdf'], failOcr: ['2600634.pdf'] });
    try {
      await s.wait('2600634.pdf');
      await s.finish('2600634.pdf');
      await s.wait('2600635.pdf');
      await expect(s.page.locator('[data-ocr-workspace]')).toBeVisible();
      await expect(s.page.locator('[data-ocr-background-processing]')).toHaveCount(0);
      await s.page.locator('summary[aria-label="Vybrat fakturu"]').click();
      await expect(s.page.locator('[aria-label="Výběr faktury"] button').nth(0)).toContainText('Chyba');
      await expect(s.page.locator('[aria-label="Výběr faktury"] button').nth(2).locator('[data-ocr-processing-spinner]')).toBeVisible();
      await s.page.keyboard.press('Escape');
      await expect(s.page.getByText('Testovací výpadek OCR', { exact: false }).first()).toBeVisible();
      await s.page.screenshot({ path: resolve(output, 'document-errors.png'), fullPage: true });
      await s.finish('2600635.pdf');
      await expect(s.page.locator('[data-ocr-background-processing]')).toHaveCount(0);
      await s.page.locator('summary[aria-label="Vybrat fakturu"]').click();
      await s.page.locator('[aria-label="Výběr faktury"] button').nth(0).click();
      await expect(s.page.getByRole('button', { name: 'Zkusit znovu', exact: true })).toBeVisible();
      await expect(s.page.getByRole('button', { name: 'Přeskočit dokument', exact: true })).toBeVisible();
      expect(s.errors).toEqual([]);
      checks.push('Upload error + OCR error visible in queue; retry/skip retained after processing');
    } finally { await s.close(); }
  }
  {
    const s = await session({ count: 2, failUpload: ['2600633.pdf', '2600634.pdf'] });
    try {
      await expect(s.page.getByText('Nepodařilo se nahrát 2600633.pdf', { exact: true })).toBeVisible();
      await expect(s.page.locator('[data-ocr-processing]')).toHaveCount(0);
      await expect(s.page.getByRole('button', { name: 'Zkusit znovu', exact: true })).toBeEnabled();
      await expect(s.page.getByRole('link', { name: 'Vyplnit ručně' })).toBeVisible();
      expect(s.requests).toEqual(['2600633.pdf', '2600634.pdf']);
      checks.push('Entire batch upload failure exits loading and preserves recovery actions');
    } finally { await s.close(); }
  }
  await writeFile(resolve(output, 'validation.json'), JSON.stringify({ checks, screenshots, api: 'Synthetic intercepted API and storage; real React import page; no live OCR/database writes.' }, null, 2));
  console.log(JSON.stringify({ checks, screenshots }, null, 2));
}
