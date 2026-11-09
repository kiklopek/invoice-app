"""Summarize the recorded layout implementation checks; does not run tests."""
from pathlib import Path
import json, hashlib, difflib

root=Path.cwd()
out=root/'artifacts/entry-layout-2026-11-02'
baseline=json.loads((out/'starting-file-hashes.json').read_text())
allowed=['src/components/auth/auth-shell.module.css','src/app/(onboarding)/onboarding/onboarding.module.css']
changed=[p for p,h in baseline.items() if hashlib.sha256((root/p).read_bytes()).hexdigest()!=h]
unexpected=[p for p in changed if p not in allowed]
layouts=[]
for p in sorted(out.glob('results-*.json')):layouts.extend(json.loads(p.read_text()))
states=[]
for p in sorted((out/'states').glob('results-*.json')):states.extend(json.loads(p.read_text()))
summary={'originalFilesChecked':len(baseline),'changedOriginalFiles':changed,'unexpectedOriginalChanges':unexpected,'layoutCases':len(layouts),'layoutFailures':[r for r in layouts if r['status']!='passed'],'pixelIdenticalPairs':sum(r.get('preservedBaselinePixels',False) for r in layouts),'stateCases':len(states),'stateFailures':[r for r in states if r['status']!='observed'],'deploymentPerformed':False}
(out/'verification.json').write_text(json.dumps(summary,ensure_ascii=False,indent=2)+'\n')
patch=''
for name,old in [(allowed[0],'starting-auth-shell.css'),(allowed[1],'starting-onboarding.css')]:
    patch+=''.join(difflib.unified_diff((out/old).read_text().splitlines(True),(root/name).read_text().splitlines(True),fromfile='a/'+name,tofile='b/'+name))
(out/'implementation.patch').write_text(patch)
items=[{k:r[k] for k in ['stage','engine','name','width','height','screenshot']} for r in layouts if r.get('screenshot') and r['stage'] in ['before','after','next'] and '-text-' not in r['screenshot'] and '-curve-' not in r['screenshot']]
gallery='''<!doctype html><html lang="cs"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Login a onboarding — implementace</title><style>body{margin:0;padding:24px;background:#f4f7f4;color:#13231b;font:16px system-ui}header{max-width:1200px;margin:auto}h1{font-size:30px}select{font:inherit;padding:8px;margin:8px 16px 8px 4px}#live,#pairs{max-width:1600px;margin:24px auto}#pairs{display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,500px),1fr));gap:16px}figure{margin:0;background:white;padding:12px;border-radius:12px}figcaption{padding:8px}img{display:block;width:100%;height:auto}a{color:#17613f}</style><header><h1>Login, registrace a onboarding — upravené rozložení</h1><p>Lokální změna CSS. Výchozí ukázka odpovídá viewportu 2560 × 1817 ze screenshotu. Bez nasazení.</p><label>Stránka<select id="name"></select></label><label>Prohlížeč<select id="engine"><option>chromium</option><option>webkit</option></select></label><label>Viewport<select id="size"></select></label></header><section id="live"></section><section id="pairs"></section><script>const items=__ITEMS__,nameSelect=document.getElementById('name'),size=document.getElementById('size'),engine=document.getElementById('engine');for(const name of [...new Set(items.map(x=>x.name))]){const o=document.createElement('option');o.value=name;o.textContent=name;nameSelect.append(o)}for(const v of ['390x844','768x1024','1440x900','1920x600','2560x1817','3840x2160']){const o=document.createElement('option');o.value=v;o.textContent=v;size.append(o)}size.value='2560x1817';function figure(row,title){const f=document.createElement('figure'),c=document.createElement('figcaption'),a=document.createElement('a'),im=document.createElement('img');c.textContent=title;a.href=row.screenshot;im.src=row.screenshot;im.alt=title;im.loading='lazy';a.append(im);f.append(c,a);return f}function render(){const live=document.getElementById('live'),pairs=document.getElementById('pairs');live.replaceChildren();pairs.replaceChildren();const rows=items.filter(x=>x.name===nameSelect.value&&x.engine===engine.value&&x.width+'x'+x.height===size.value);const real=rows.find(x=>x.stage==='next');if(real)live.append(figure(real,'Aktuální login/registrace ve skutečném Next.js, včetně Next/font'));for(const stage of ['before','after']){const row=rows.find(x=>x.stage===stage);if(row)pairs.append(figure(row,(stage==='before'?'Před změnou':'Po změně')+' — izolované skutečné komponenty se shodnými daty/font adaptérem'))}}for(const el of [nameSelect,size,engine])el.onchange=render;render();</script></html>'''.replace('__ITEMS__',json.dumps(items))
(out/'index.html').write_text(gallery)
print(json.dumps({k:v for k,v in summary.items() if k not in ['layoutFailures','stateFailures']},ensure_ascii=False))
if unexpected or summary['layoutFailures'] or summary['stateFailures']:raise SystemExit(1)
