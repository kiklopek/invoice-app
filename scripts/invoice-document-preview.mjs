// Synthetic documents only. Render the actual production PDF for visual review.
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { execFileSync } from 'node:child_process';
import sharp from 'sharp';
const require=createRequire(import.meta.url),vr=createRequire(require.resolve('vitest/config'));
const {createServer}=await import(pathToFileURL(vr.resolve('vite')).href);
const out=resolve('docs/redesign/visual-validation/invoice-creation');await mkdir(out,{recursive:true});
const server=await createServer({configFile:false,logLevel:'error',server:{middlewareMode:true,ws:false,hmr:false},resolve:{alias:{'@':resolve('src'),'server-only':resolve('src/test-shims/server-only.ts')}}});
try {
 const {generateIssuedInvoicePdf}=await server.ssrLoadModule('/src/lib/issued-invoice-pdf.ts');
 const {creationDocument}=await server.ssrLoadModule('/src/lib/invoice-creation.ts');
 const {fixture,supplier}=await server.ssrLoadModule('/src/test/invoice-creation-fixtures.ts');
 for(const variant of ['standard','mixed','nonpayer','branded']){
  const draft=fixture();if(variant==='mixed')draft.items.push({...draft.items[0],id:'second',description:'Grafické a konzultační služby',unit_price:'1250.1234',quantity:'2.5',discount:'5',vat_rate:12});
  if(variant==='nonpayer')draft.payment_method='cash';
  const bytes=await generateIssuedInvoicePdf(creationDocument(draft,variant==='nonpayer'?{...supplier,vat_payer:false,dic:''}:variant==='branded'?{...supplier,logo_path:'/brand/drevohlavica.png'}:supplier));
  await writeFile(resolve(out,`invoice-${variant}.pdf`),bytes);
  const pngPath=resolve(out,`invoice-${variant}.png`);
  execFileSync('sips',['-s','format','png',resolve(out,`invoice-${variant}.pdf`),'--out',pngPath]);
  const png=await sharp(pngPath).flatten({background:'#fff'}).png().toBuffer();
  await writeFile(pngPath,png);console.log('Rendered '+variant);
 }
} finally {await server.close();}
