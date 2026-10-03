import { spawn } from 'node:child_process';
import { releaseAuditEnv as env } from './release-audit-env.mjs';
const child=spawn(process.execPath,['scripts/next-clean-env.mjs','start','--hostname','127.0.0.1','--port','4200'],{env,stdio:'inherit',windowsHide:true});
process.on('SIGINT',()=>child.kill());process.on('SIGTERM',()=>child.kill());
child.on('close',code=>process.exit(code ?? 0));
