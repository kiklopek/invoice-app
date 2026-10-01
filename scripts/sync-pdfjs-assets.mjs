// Zkopíruje datové soubory pdf.js (worker, cmaps, standardní fonty, WASM dekodéry, ICC)
// z node_modules do public/pdfjs/. Náhled dokladu je načítá ze stejného originu
// (CSP default-src 'self'), ne z CDN. Soubory jsou commitnuté v repu; po změně
// verze pdfjs-dist spusťte `node scripts/sync-pdfjs-assets.mjs` -- test
// src/lib/pdfjs-assets.test.ts hlídá, že se kopie od balíčku nerozešly.
import { copyFileSync, cpSync, mkdirSync, rmSync } from "node:fs";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const target = `${root}public/pdfjs`;

// quickjs-eval spouští skripty uvnitř PDF -- náhled je záměrně nepotřebuje.
rmSync(target, { recursive: true, force: true });
mkdirSync(target, { recursive: true });
for (const dir of ["cmaps", "standard_fonts", "wasm", "iccs"]) {
  cpSync(`${root}node_modules/pdfjs-dist/${dir}`, `${target}/${dir}`, { recursive: true, filter: source => !/quickjs-eval/.test(source) });
}
copyFileSync(`${root}node_modules/pdfjs-dist/build/pdf.worker.min.mjs`, `${target}/pdf.worker.min.mjs`);
