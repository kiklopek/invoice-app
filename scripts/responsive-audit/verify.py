"""Read-only integrity and artifact checks. Run from repository root."""
from pathlib import Path
import hashlib, json, re, subprocess
root=Path.cwd()
out=root/'artifacts/responsive-audit/2026-11-02'
baseline=json.loads((out/'original-file-hashes.json').read_text())
changed=[name for name,digest in baseline.items() if not (root/name).is_file() or hashlib.sha256((root/name).read_bytes()).hexdigest()!=digest]
missing=[]
for p in [root/'RESPONSIVE_DESIGN_SYSTEM.md',*(root/'docs/responsive-audit').glob('*.md')]:
 for target in re.findall(r'\]\(([^)]+)\)',p.read_text()):
  if '://' in target or target.startswith('#'): continue
  target=target.split('#')[0]
  if not (p.parent/target).exists(): missing.append({'file':str(p.relative_to(root)),'target':target})
syntax=[]
for p in (root/'scripts/responsive-audit').glob('*.mjs'):
 check=subprocess.run(['node','--check',str(p)],capture_output=True,text=True)
 if check.returncode: syntax.append({'file':p.name,'error':check.stderr})
summary=json.loads((out/'summary.json').read_text())
result={'originalFilesChecked':len(baseline),'changedOriginalFiles':changed,'missingDocumentTargets':missing,'javascriptSyntaxErrors':syntax,'renderCases':sum(v['cases'] for v in summary['caseFiles'].values()),'renderFailures':sum(v['renderFailures'] for v in summary['caseFiles'].values()),'documentOverflows':sum(v['documentOverflows'] for v in summary['caseFiles'].values()),'referenceStatus':'not_captured','visualBaselines':'not_approved'}
auth=summary.get('authOnboarding',{})
result['additionalAuthOnboardingCases']=auth.get('cases',0)
result['additionalAuthOnboardingFailures']=auth.get('failed',0)
(out/'integrity-verification.json').write_text(json.dumps(result,ensure_ascii=False,indent=2)+'\n')
print(json.dumps(result,ensure_ascii=False,indent=2))
raise SystemExit(bool(changed or missing or syntax or result['renderFailures'] or result['additionalAuthOnboardingFailures']))
