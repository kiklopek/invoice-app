import { readFile } from 'node:fs/promises';
const report=JSON.parse(await readFile(process.argv[2] ?? '.cache/release-e2e.json','utf8'));
let passed=0,failed=0,skipped=0;
function visit(suites){for(const suite of suites ?? []){for(const spec of suite.specs ?? [])for(const test of spec.tests ?? []){
  // Viewport-inapplicable navigation scenarios remain legitimate skips.
  const conditional=(test.annotations ?? []).some(a=>a.type==='skip' && /Postranní panel|Hamburger/.test(a.description ?? ''));
  if(test.status==='skipped' && !conditional)skipped++;
  else if(test.status==='expected')passed++;
  else if(test.status!=='skipped')failed++;
}visit(suite.suites);}}
visit(report.suites);
if(!passed || failed || skipped || report.errors?.length){console.error(`Release E2E refused: passed=${passed}, failed/flaky=${failed}, unexplained skips=${skipped}, errors=${report.errors?.length ?? 0}`);process.exitCode=1;}
else console.log(`Release E2E passed: ${passed} scenarios.`);
