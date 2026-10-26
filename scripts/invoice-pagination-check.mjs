// Actual PDF renderer, synthetic invoices only; no database writes or email.
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { execFileSync } from 'node:child_process';
import { PDFDocument } from 'pdf-lib';
import sharp from 'sharp';
const require = createRequire(import.meta.url), vr = createRequire(require.resolve('vitest/config'));
const { createServer } = await import(pathToFileURL(vr.resolve('vite')).href);
const out = resolve('docs/redesign/visual-validation/invoice-pagination');
await mkdir(out, { recursive: true });
const server = await createServer({ configFile: false, logLevel: 'error', server: { middlewareMode: true, ws: false, hmr: false }, resolve: { alias: { '@': resolve('src'), 'server-only': resolve('src/test-shims/server-only.ts') } } });
try {
  const { generateIssuedInvoicePdf } = await server.ssrLoadModule('/src/lib/issued-invoice-pdf.ts');
  const { creationDocument } = await server.ssrLoadModule('/src/lib/invoice-creation.ts');
  const { fixture, supplier } = await server.ssrLoadModule('/src/test/invoice-creation-fixtures.ts');
  const results = [];
  for (const count of [30, 200]) {
    const draft = fixture();
    draft.items = Array.from({ length: count }, (_, i) => ({ ...draft.items[0], id: `product-${i}`, description: `PRODUCT_${String(i + 1).padStart(3, '0')} ${'Dodávka výrobku s podrobným popisem. '.repeat(i % 7 === 0 ? 10 : 1)}`, vat_rate: i % 2 ? 12 : 21 }));
    draft.public_note = 'Děkujeme za spolupráci.';
    const bytes = await generateIssuedInvoicePdf(creationDocument(draft, supplier));
    await writeFile(resolve(out, `invoice-${count}.pdf`), bytes);
    const pdf = await PDFDocument.load(bytes), thumbs = [];
    for (let i = 0; i < pdf.getPageCount(); i++) {
      const single = await PDFDocument.create(), [page] = await single.copyPages(pdf, [i]);
      single.addPage(page);
      const base = resolve(out, `invoice-${count}-page-${String(i + 1).padStart(2, '0')}`);
      await writeFile(`${base}.pdf`, await single.save());
      if (process.platform === 'darwin') {
        execFileSync('sips', ['-s', 'format', 'png', `${base}.pdf`, '--out', `${base}.png`], { stdio: 'ignore' });
        const png = await sharp(`${base}.png`).flatten({ background: '#fff' }).png().toBuffer();
        await writeFile(`${base}.png`, png);
        thumbs.push(await sharp(png).resize(397, 562).png().toBuffer());
      }
    }
    for (let offset = 0; offset < thumbs.length; offset += 12) {
      const group = thumbs.slice(offset, offset + 12);
      await sharp({ create: { width: 1227, height: Math.ceil(group.length / 3) * 574, channels: 3, background: '#dae2dd' } }).composite(group.map((input, i) => ({ input, left: i % 3 * 409 + 6, top: Math.floor(i / 3) * 574 + 6 }))).png().toFile(resolve(out, `invoice-${count}-contact-${Math.floor(offset / 12) + 1}.png`));
    }
    results.push({ products: count, pages: pdf.getPageCount(), bytes: bytes.length });
    console.log(`Rendered ${count} products: ${pdf.getPageCount()} pages`);
  }
  await writeFile(resolve(out, 'results.json'), JSON.stringify(results, null, 2));
} finally { await server.close(); }
