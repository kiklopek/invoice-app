import { spawn } from 'node:child_process';
import { readFile,writeFile } from 'node:fs/promises';
import { releaseAuditEnv as env } from './release-audit-env.mjs';
const previous=await readFile('next-env.d.ts');
// Build with explicit non-production credentials; never sends mail or writes
// to the main Supabase. This proves compilation, not deployed configuration.
let log='';
try {
  const code=await new Promise((done,reject)=>{const child=spawn(process.execPath,['scripts/next-clean-env.mjs','build','--webpack'],{env,windowsHide:true});child.stdout.on('data',b=>log+=b);child.stderr.on('data',b=>log+=b);child.on('error',reject);child.on('close',done);});
  await writeFile('docs/audits/2026-10-03-release/build.log',log);
  console.log(code===0?'Production compilation PASS (synthetic configuration)':'Production compilation FAIL; see build.log');process.exitCode=code;
}finally{await writeFile('next-env.d.ts',previous);}
