import { spawn } from 'node:child_process';
import { mkdir,readFile,writeFile,readdir } from 'node:fs/promises';
import { resolve,relative } from 'node:path';
import { createHash } from 'node:crypto';
const output=resolve(process.env.AUDIT_OUTPUT ?? 'docs/audits/2026-10-03-release');
await mkdir(output,{recursive:true});
const run=(command,args)=>new Promise(resolveResult=>{
  const child=spawn(command,args,{shell:false,windowsHide:true});let stdout='',stderr='';
  child.stdout.on('data',b=>stdout+=b);child.stderr.on('data',b=>stderr+=b);
  child.on('error',error=>resolveResult({code:-1,stdout,stderr:stderr+error.message}));
  child.on('close',code=>resolveResult({code,stdout,stderr}));
});
if(process.argv.includes('--snapshot')){
  const revision=await run('git',['rev-parse','HEAD']);
  const status=await run('git',['status','--short']);
  const diff=await run('git',['diff','--binary']);
  await writeFile(resolve(output,'baseline-status.txt'),status.stdout);
  await writeFile(resolve(output,'baseline.patch'),diff.stdout);
  const inventory=[];
  async function walk(dir){for(const entry of await readdir(dir,{withFileTypes:true})){
    const path=resolve(dir,entry.name);if(entry.isDirectory())await walk(path);
    else {const bytes=await readFile(path);inventory.push({path:relative(process.cwd(),path).replaceAll('\\','/'),sha256:createHash('sha256').update(bytes).digest('hex')});}
  }}
  for(const dir of ['src','supabase','e2e','scripts','.github'])await walk(resolve(dir));
  await writeFile(resolve(output,'baseline.json'),JSON.stringify({commit:revision.stdout.trim(),captured_at:new Date().toISOString(),files:inventory},null,2)+'\n');
  console.log('Baseline captured without credentials.');
}else{
  const checks=[['typecheck','node_modules/typescript/bin/tsc',['--noEmit']],['lint','node_modules/eslint/bin/eslint.js',['.','--max-warnings','0']],
    ['unit','node_modules/vitest/vitest.mjs',['run','src','--reporter=json',`--outputFile=${relative(process.cwd(),resolve(output,'unit-results.json'))}`]],
    ['migrations','scripts/check-migrations.mjs',[]]];
  const results=await Promise.all(checks.map(async([name,script,args])=>{
    const start=Date.now(),result=await run(process.execPath,[script,...args]);
    await writeFile(resolve(output,`${name}.log`),result.stdout+result.stderr);
    console.log(`${name}: ${result.code===0?'PASS':'FAIL'}`);
    return {name,exit_code:result.code,duration_ms:Date.now()-start};
  }));
  await writeFile(resolve(output,'checks.json'),JSON.stringify({recorded_at:new Date().toISOString(),results},null,2)+'\n');
  if(results.some(r=>r.exit_code!==0))process.exitCode=1;
}
