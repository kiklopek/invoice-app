// Actual PDFs from synthetic authoritative-report fixtures; no production access.
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { execFileSync } from 'node:child_process';
import { PDFDocument } from 'pdf-lib';
import sharp from 'sharp';
const require=createRequire(import.meta.url),vr=createRequire(require.resolve('vitest/config'));
const {createServer}=await import(pathToFileURL(vr.resolve('vite')).href);
const out=resolve('docs/redesign/visual-validation/financial-reports');await mkdir(out,{recursive:true});
const server=await createServer({configFile:false,logLevel:'error',server:{middlewareMode:true,ws:false,hmr:false},resolve:{alias:{'@':resolve('src'),'server-only':resolve('src/test-shims/server-only.ts')}}});
try{
 const {generateFinancialReport}=await server.ssrLoadModule('/src/lib/financial-report-pdf.ts'),{financialReportFixture}=await server.ssrLoadModule('/src/test/financial-report-fixtures.ts');
 const results=[];
 for(const name of ['complete','summary','detailed','custom','empty','hundreds']){
  const model=financialReportFixture(name==='empty'?0:name==='hundreds'?300:6);
  if(['summary','detailed','custom'].includes(name))model.options.mode=name;
  if(name==='summary'){model.options.details=false;model.options.customers=false;}
  if(name==='custom'){model.options.sections=['vat','payments'];model.options.orientation='landscape';}
  if(name==='hundreds'){model.options.sections=['revenue'];model.options.customers=false;model.options.charts=false;}
  const {bytes,pageCount}=await generateFinancialReport(model);await writeFile(resolve(out,`${name}.pdf`),bytes);results.push({name,pageCount,bytes:bytes.length});
  const source=await PDFDocument.load(bytes),thumbs=[];
  for(let i=0;i<pageCount;i++){
   const single=await PDFDocument.create(),[page]=await single.copyPages(source,[i]);single.addPage(page);const one=resolve(out,`${name}-page-${String(i+1).padStart(2,'0')}`);await writeFile(`${one}.pdf`,await single.save());
   if(process.platform==='darwin'){execFileSync('sips',['-s','format','png',`${one}.pdf`,'--out',`${one}.png`]);const png=await sharp(`${one}.png`).flatten({background:'#fff'}).png().toBuffer();await writeFile(`${one}.png`,png);thumbs.push(await sharp(png).resize(397,562,{fit:'contain',background:'#fff'}).png().toBuffer());}
  }
  for(let offset=0;offset<thumbs.length;offset+=12){const group=thumbs.slice(offset,offset+12),rows=Math.ceil(group.length/3);await sharp({create:{width:3*409,height:rows*574,channels:3,background:'#dae2dd'}}).composite(group.map((input,i)=>({input,left:(i%3)*409+6,top:Math.floor(i/3)*574+6}))).png().toFile(resolve(out,`${name}-contact-${Math.floor(offset/12)+1}.png`));}
  console.log('Rendered',name,pageCount,'pages');
 }
 await writeFile(resolve(out,'results.json'),JSON.stringify(results,null,2));
}finally{await server.close();}
