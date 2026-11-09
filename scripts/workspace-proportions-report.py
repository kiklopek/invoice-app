"""Build the review gallery and verify the recorded workspace layout evidence."""
from pathlib import Path
import json, hashlib, difflib

root=Path.cwd()
out=root/'artifacts/workspace-proportions-2026-11-02'
expected={'results-chromium.json':84,'results-webkit.json':84,'results-chromium-broad.json':32,'results-webkit-broad.json':32}
rows=[]
for name,count in expected.items():
    data=json.loads((out/name).read_text())
    assert len(data)==count,(name,len(data),count)
    assert all(r['status']=='passed' for r in data),name
    rows.extend(data)
surfaces=json.loads((out/'surface-checks.json').read_text())
assert len(surfaces)==16 and all(r['status']=='passed' for r in surfaces)
baseline=json.loads((out/'starting-file-hashes.json').read_text())
changed=[p for p,h in baseline.items() if hashlib.sha256((root/p).read_bytes()).hexdigest()!=h]
allowed={
 'src/app/minimal.css',
 'src/components/layout/app-shell.tsx','src/components/layout/workspace-shell.module.css',
 'src/components/financial-report/financial-report-export.module.css',
 'src/components/invoice-creation/invoice-creation.module.css',
 'src/components/invoice-review-form.module.css','src/components/search/workspace-search.module.css',
}
unexpected=[p for p in changed if not p.startswith('src/app/(workspace)/') and p not in allowed]
assert not unexpected,unexpected
patch=''
for name in changed:
    before=Path('/tmp/splatno-workspace-proportions-before')/name
    assert before.is_file(),name
    patch+=''.join(difflib.unified_diff(before.read_text().splitlines(True),(root/name).read_text().splitlines(True),fromfile='a/'+name,tofile='b/'+name))
(out/'implementation.patch').write_text(patch)
references=[r for r in rows if r['stage']=='after' and r['width']<=1440]
wide=[r for r in rows if r['stage']=='after' and r['width']==2560]
summary={
 'originalFilesChecked':len(baseline),'changedOriginalFiles':changed,'unexpectedChanges':unexpected,
 'layoutCases':len(rows),'layoutFailures':0,'routes':sorted({r['route'] for r in rows}),
 'surfaceCases':len(surfaces),'surfaceFailures':0,'referencePairs':len(references),
 'byteIdenticalPairs':sum(r.get('preservedPixels',False) for r in references),
 'maxReferencePixelNoise':max(r.get('pixelNoiseRatio',0) for r in references),
 'wideMainScaleRange':[min(r['metrics']['zoom'] for r in wide),max(r['metrics']['zoom'] for r in wide)],
 'wideSidebarWidthRange':[min(r['metrics']['sidebar']['width'] for r in wide),max(r['metrics']['sidebar']['width'] for r in wide)],
 'wideNavigationScaleRange':[min(r['chrome']['scale'] for r in wide),max(r['chrome']['scale'] for r in wide)],
 'deploymentPerformed':False,
}
assert summary['maxReferencePixelNoise']<.0001
assert summary['wideMainScaleRange'][1]-summary['wideMainScaleRange'][0]<.001
assert all(abs(r['metrics']['sidebar']['width']-244*r['chrome']['scale'])<1 for r in wide)
assert all(r['chrome']['scale']>r['metrics']['zoom'] for r in wide)
(out/'verification.json').write_text(json.dumps(summary,ensure_ascii=False,indent=2)+'\n')
items=[{k:r[k] for k in ['stage','route','engine','width','height','screenshot']} for r in rows]
assert all((out/i['screenshot']).is_file() for i in items)
gallery='''<!doctype html><html lang="cs"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Společný workspace — před a po</title><style>body{margin:0;padding:24px;background:#f4f7f4;color:#17251f;font:16px system-ui}header{max-width:1400px;margin:auto}select{font:inherit;padding:8px;margin:8px 12px 8px 4px}#pairs{display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,650px),1fr));gap:20px;margin-top:24px}figure{margin:0;background:white;padding:12px;border-radius:12px}figcaption{padding:6px 0 12px}img{display:block;width:100%;height:auto}a{color:#17613f}</style><header><h1>Společné responzivní chování workspace</h1><p>Skutečné komponenty a syntetická data. Nově roste společně obsah, navigace, profil a horní ovládání. Výchozí viewport 2560 × 1817 odpovídá zadání. Jde o lokální změny, bez nasazení.</p><label>Stránka<select id="route"></select></label><label>Prohlížeč<select id="engine"><option>chromium</option><option>webkit</option></select></label><label>Viewport<select id="size"></select></label></header><section id="pairs"></section><script>const rows=__ROWS__,route=document.getElementById('route'),engine=document.getElementById('engine'),size=document.getElementById('size');for(const value of [...new Set(rows.map(x=>x.route))]){const o=document.createElement('option');o.value=value;o.textContent=value;route.append(o)}for(const value of ['390x844','768x1024','1440x900','1920x600','2560x1817','3840x2160']){const o=document.createElement('option');o.value=value;o.textContent=value;size.append(o)}size.value='2560x1817';function render(){const pairs=document.getElementById('pairs');pairs.replaceChildren();const chosen=rows.filter(r=>r.route===route.value&&r.engine===engine.value&&r.width+'x'+r.height===size.value);if(!chosen.length){const p=document.createElement('p');p.textContent='Tento viewport není v doplňujícím běhu této stránky zachycen. Zvolte 2560 × 1817 nebo 1920 × 600.';pairs.append(p)}for(const r of chosen){const f=document.createElement('figure'),c=document.createElement('figcaption'),a=document.createElement('a'),im=document.createElement('img');c.textContent=(r.stage==='before'?'Před změnou':'Po změně')+' · '+r.engine+' · '+size.value;a.href=r.screenshot;im.src=r.screenshot;im.alt=c.textContent;im.loading='lazy';a.append(im);f.append(c,a);pairs.append(f)}}for(const el of [route,engine,size])el.onchange=render;render();</script></html>'''.replace('__ROWS__',json.dumps(items))
(out/'index.html').write_text(gallery)
print(json.dumps({k:v for k,v in summary.items() if k not in ['changedOriginalFiles','routes']},ensure_ascii=False))
