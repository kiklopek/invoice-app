// Builds HTML prototypes of the responsive mockups (transition rules v1) for the pages
// that are not in Figma yet. Each file is one exact window size; the CSS uses the same
// mechanisms the implementation will use (container queries, clamp, fill-the-rest),
// so the measuring scripts can verify the rules on the prototype itself.
//
//   node scripts/responsive-mockups/html/build.mjs   → docs/responsive/mockups/*.html
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

const OUT = resolve("docs/responsive/mockups");
export const SIZES = [
  { id: "1024", w: 1024, h: 768, nav: "rail", label: "1024 × 768 · tablet na šířku" },
  { id: "1180", w: 1180, h: 820, nav: 220, label: "1180 × 820 · iPad Air na šířku" },
  { id: "1920", w: 1920, h: 1080, nav: 280, label: "1920 × 1080 · velký monitor" },
  { id: "2560", w: 2560, h: 1440, nav: 320, label: "2560 × 1440 · velký monitor" },
];

const ICON = {
  search: '<circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/>', plus: '<path d="M5 12h14"/><path d="M12 5v14"/>',
  upload: '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" x2="12" y1="3" y2="15"/>',
  bell: '<path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9"/><path d="M10.3 21a1.94 1.94 0 0 0 3.4 0"/>',
  more: '<circle cx="12" cy="12" r="1"/><circle cx="19" cy="12" r="1"/><circle cx="5" cy="12" r="1"/>', down: '<path d="m6 9 6 6 6-6"/>',
  home: '<path d="m3 9 9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/>',
  file: '<path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z"/><path d="M14 2v4a2 2 0 0 0 2 2h4"/><path d="M16 13H8"/><path d="M16 17H8"/>',
  card: '<rect width="20" height="14" x="2" y="5" rx="2"/><line x1="2" x2="22" y1="10" y2="10"/>', mark: '<path d="m19 21-7-4-7 4V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2v16z"/>',
  users: '<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87"/>',
  chart: '<path d="M3 3v18h18"/><path d="m19 9-5 5-4-4-3 3"/>', gear: '<circle cx="12" cy="12" r="3"/><circle cx="12" cy="12" r="8"/>',
  clock: '<circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/>', check: '<path d="M20 6 9 17l-5-5"/>', hourglass: '<path d="M5 22h14"/><path d="M5 2h14"/><path d="M17 22v-4.17a2 2 0 0 0-.59-1.42L12 12l-4.41 4.41A2 2 0 0 0 7 17.83V22"/><path d="M7 2v4.17a2 2 0 0 0 .59 1.42L12 12l4.41-4.41A2 2 0 0 0 17 6.17V2"/>',
  logout: '<path d="M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4"/><polyline points="10 17 15 12 10 7"/><line x1="15" x2="3" y1="12" y2="12"/>',
  arrow: '<path d="M5 12h14"/><path d="m12 5 7 7-7 7"/>', left: '<path d="m15 18-6-6 6-6"/>', right: '<path d="m9 18 6-6-6-6"/>', x: '<path d="M18 6 6 18"/><path d="m6 6 12 12"/>',
  pencil: '<path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z"/>', mail: '<rect width="20" height="16" x="2" y="4" rx="2"/><path d="m22 7-10 5L2 7"/>', phone: '<path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6A19.79 19.79 0 0 1 2.12 4.18 2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72c.13.96.36 1.9.7 2.81a2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45c.91.34 1.85.57 2.81.7A2 2 0 0 1 22 16.92z"/>',
  download: '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" x2="12" y1="15" y2="3"/>', eye: '<path d="M2 12s3-7 10-7 10 7 10 7-3 7-10 7-10-7-10-7Z"/><circle cx="12" cy="12" r="3"/>',
  back: '<path d="m12 19-7-7 7-7"/><path d="M19 12H5"/>', cal: '<rect width="18" height="18" x="3" y="4" rx="2"/><path d="M16 2v4"/><path d="M8 2v4"/><path d="M3 10h18"/>',
};
const i = (n, cls = "") => `<svg class="ic ${cls}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICON[n]}</svg>`;

const CSS = `
:root{--ink:#17251d;--muted:#66736b;--line:#dde3de;--line-strong:#cbd4cd;--paper:#fff;--canvas:#f5f6f2;--green:#245f42;--green-dark:#17462f;--green-soft:#eaf2ec;--red:#a7473e;--red-soft:#f8eae7;--amber:#94641e;--amber-soft:#f8f0df;--blue:#3f6d62;--blue-soft:#e9f0ed}
*{box-sizing:border-box;margin:0}
html,body{height:100%}
body{font:400 13px/1.45 Inter,"Segoe UI",system-ui,sans-serif;color:var(--ink);background:radial-gradient(ellipse at 88% 10%,#ecf5ef55,transparent 50%),#f9fbf9;font-variant-numeric:tabular-nums;overflow:hidden}
body.scrolls{overflow:auto}
.ic{width:18px;height:18px;flex:none}
.bg{position:fixed;inset:0;z-index:0;pointer-events:none}.bg svg{position:absolute;inset:0;width:100%;height:100%}
.app{display:flex;height:100vh;position:relative;z-index:1}
body.scrolls .app{height:auto;min-height:100vh}
/* navigation (rule 5) */
.nav{flex:none;background:#f9fbf866;border-right:1px solid #e7ede9;display:flex;flex-direction:column;position:sticky;top:0;height:100vh}
.nav .logo{display:flex;align-items:center;gap:var(--logo-gap,8px);font:700 var(--logo,26px)/1 Inter,sans-serif;letter-spacing:-.5px}
.nav .logo img{width:var(--mark,24px);height:var(--mark,24px)}
.nav a{display:flex;align-items:center;color:inherit;text-decoration:none;border-radius:10px}
.nav a.on{background:var(--green-soft);color:var(--green);font-weight:600}
.nav .fill{flex:1}
.nav .user{display:flex;align-items:center;gap:10px}
.avatar{display:grid;place-items:center;width:var(--av,40px);height:var(--av,40px);border-radius:50%;background:var(--green-soft);box-shadow:inset 0 0 0 1px #cfe0d5;color:var(--green);font-weight:700;flex:none}
.nav .user .who{min-width:0;flex:1}.nav .user .who b,.nav .user .who small{display:block;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.nav .user small{color:var(--muted);font-size:var(--nav-small,12px)}.nav .user b{font-size:var(--nav-name,13px)}
.nav .esko{display:flex;align-items:center;gap:12px;padding:6px 14px;font-weight:600;font-size:var(--nav-text,15px);color:var(--green-dark)}.nav .esko img{width:var(--esko,44px);height:auto}
.nav.side a.sub{padding:calc(var(--nav-py,11px) * .5) 14px calc(var(--nav-py,11px) * .5) calc(var(--nav-ic,18px) + 28px);font-size:var(--nav-sub,13px);font-weight:500;border-radius:8px}.nav.side a.sub.on{background:var(--green-soft);color:var(--green);font-weight:600}
.nav.rail{width:84px;align-items:center;padding:27px 6px 18px;gap:4px}
.nav.rail .logo{margin-bottom:22px;--mark:30px}.nav.rail .logo span{display:none}.nav.rail .esko{flex-direction:column;gap:2px;padding:4px 0;font-size:10px}.nav.rail .esko img{width:40px}
.nav.rail a{flex-direction:column;justify-content:center;gap:4px;width:72px;padding:9px 0 8px;font-size:10px;font-weight:500}
.nav.side{padding:calc(42px - var(--logo,26px) / 2) var(--nav-pad,22px) 18px;gap:var(--nav-gap,4px)}
.nav.side .logo{margin-bottom:var(--nav-logo-gap,30px)}
.nav.side a{gap:14px;padding:var(--nav-py,11px) 14px;font-size:var(--nav-text,15px)}
.nav.side a .ic{width:var(--nav-ic,18px);height:var(--nav-ic,18px)}
.nav.side .sep{height:1px;background:#e7ede9;margin:10px 0}
/* main */
.main{flex:1;min-width:0;display:flex;flex-direction:column;padding:20px var(--pad) var(--pad-b,24px);gap:var(--stack,24px)}
body.scrolls .main{min-height:100vh}
.top{display:flex;align-items:center;gap:12px;flex:none}
.search{display:flex;align-items:center;gap:10px;width:var(--search-w,440px);min-width:0;padding:12px 14px;border:1px solid var(--line);border-radius:10px;background:var(--paper);color:var(--muted)}
.search span{white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.top .grow{flex:1}
.btn{display:inline-flex;align-items:center;justify-content:center;gap:8px;padding:11px 16px;border:1px solid var(--line);border-radius:10px;background:var(--paper);font-weight:600;white-space:nowrap}
.btn.primary{background:var(--green);border-color:var(--green);color:#fff}
.btn.round{width:44px;height:44px;padding:0;border-radius:50%}
.head{display:flex;align-items:center;gap:24px;flex:none}
.head .t{flex:1;min-width:0}
.eyebrow{font-size:12px;font-weight:600;letter-spacing:.06em;text-transform:uppercase;color:var(--muted)}
h1{font-size:var(--h1,42px);line-height:1.1;letter-spacing:-.02em;text-wrap:balance}
.sub{color:var(--muted);font-size:14px;margin-top:6px}
.compact-head h1{--h1:32px}.compact-head .sub{display:none}
.card{background:var(--paper);border:1px solid var(--line);border-radius:16px;min-width:0}
.card-h{display:flex;align-items:center;gap:12px;padding:var(--card-p,18px) var(--card-p,18px) 0}
.card-h h2{font-size:var(--card-title,17px);flex:1;min-width:0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.link{color:var(--green);font-weight:600;white-space:nowrap;display:inline-flex;align-items:center;gap:6px}
.pill{display:inline-flex;align-items:center;gap:5px;padding:4px 8px;border-radius:6px;font-size:12px;font-weight:500;white-space:nowrap}
.pill .ic{width:12px;height:12px}
.pill.overdue{background:var(--red-soft);color:var(--red)}.pill.waiting{background:var(--amber-soft);color:var(--amber)}.pill.partial{background:var(--blue-soft);color:var(--blue)}.pill.paid{background:var(--green-soft);color:var(--green)}
.num{white-space:nowrap;font-variant-numeric:tabular-nums}
.ell{white-space:nowrap;overflow:hidden;text-overflow:ellipsis;min-width:0}
.muted{color:var(--muted)}
/* tables that fill the remaining height (rules 2-4) */
.fillcol{display:flex;flex-direction:column;min-height:0;flex:1}
.rows{flex:1;min-height:0;overflow:hidden;display:flex;flex-direction:column}
.row{display:grid;align-items:center;gap:16px;padding:var(--row-py,12px) 16px;border-top:1px solid var(--line)}
.row:first-child{border-top:0}
.thead{display:grid;align-items:center;gap:16px;padding:11px 16px;background:var(--canvas);font-size:11px;font-weight:600;letter-spacing:.04em;text-transform:uppercase;color:var(--muted)}
.foot{display:flex;align-items:center;gap:10px;padding:12px 18px;border-top:1px solid var(--line);flex:none}
.foot .grow{flex:1}
.pg{display:inline-grid;place-items:center;min-width:30px;height:30px;border-radius:8px}.pg.on{background:var(--green);color:#fff;font-weight:600}
.stack2{display:flex;flex-direction:column;gap:3px;min-width:0}
`;

const NAV = [["home", "Nástěnka"], ["file", "Faktury"], ["card", "Platby"], ["mark", "Upomínky"], ["users", "Zákazníci"], ["chart", "Reporty"]];
const SUBS = { Faktury: ["Importovat fakturu", "Vystavit fakturu", "Přidat ručně", "Archiv faktur"], Platby: ["Historie a archiv"], Nastavení: ["E-mailová šablona", "Předplatné"] };
// Navigation scale per width (rule 5): wider screens get a wider sidebar with larger text,
// icons, logo and Esko, so it never looks small and empty next to a large workspace.
const NAVSPEC = {
  220: { py: 11, gap: 4, text: 15, ic: 18, logo: 26, mark: 24, esko: 44, av: 40, sub: 13, name: 13, small: 12, pad: 22, logoGap: 30 },
  280: { py: 15, gap: 6, text: 18, ic: 22, logo: 30, mark: 28, esko: 60, av: 46, sub: 15, name: 15, small: 13, pad: 26, logoGap: 44 },
  320: { py: 15, gap: 8, text: 21, ic: 26, logo: 36, mark: 34, esko: 84, av: 54, sub: 17, name: 17, small: 15, pad: 30, logoGap: 60 },
};
const logo = '<div class="logo"><img src="assets/splatno-mark.svg" alt=""><span>splatno</span></div>';
const esko = '<a class="esko"><img src="assets/mascot-wave.webp" alt="">Esko</a>';
function nav(size, active, activeSub) {
  if (size.nav === "rail") return `<nav class="nav rail">${logo}${NAV.map(([ic, l]) => `<a class="${l === active ? "on" : ""}">${i(ic)}${l}</a>`).join("")}<a>${i("gear")}Nastavení</a><div class="fill"></div>${esko}<div class="avatar">UU</div></nav>`;
  const n = NAVSPEC[size.nav];
  const vars = `--nav-py:${n.py}px;--nav-gap:${n.gap}px;--nav-text:${n.text}px;--nav-ic:${n.ic}px;--logo:${n.logo}px;--mark:${n.mark}px;--esko:${n.esko}px;--av:${n.av}px;--nav-sub:${n.sub}px;--nav-name:${n.name}px;--nav-small:${n.small}px;--nav-pad:${n.pad}px;--nav-logo-gap:${n.logoGap}px`;
  const expand = (l) => l === active || size.h >= 1300 || (size.h >= 1000 && l === "Faktury");
  const subs = (l) => SUBS[l].map((x) => `<a class="sub${x === activeSub ? " on" : ""}">›&nbsp; ${x}</a>`).join("");
  const items = NAV.map(([ic, l]) => `<a class="${l === active ? "on" : ""}">${i(ic)}${l}</a>` + (expand(l) && SUBS[l] ? SUBS[l].map((x) => `<a class="sub${x === activeSub ? " on" : ""}">›&nbsp; ${x}</a>`).join("") : "")).join("");
  return `<nav class="nav side" data-nav style="width:${size.nav}px;${vars}">${logo}${items}<div class="sep"></div><a>${i("gear")}Nastavení</a>${size.h >= 1300 ? subs("Nastavení") : ""}<div class="fill" data-nav-fill></div>${esko}<div class="user"><div class="avatar">UU</div><div class="who"><b>Ukázkový uživatel</b><small>Ukázková firma s.r.o.</small></div>${i("logout", "muted")}</div></nav>`;
}
const BG = `<div class="bg" aria-hidden="true"><svg viewBox="0 0 1536 1024" preserveAspectRatio="none"><defs><linearGradient id="u" x1="0" y1="0" x2=".7" y2="1"><stop stop-color="#e0eee5" stop-opacity=".12"/><stop offset="1" stop-color="#dcece3" stop-opacity=".45"/></linearGradient><linearGradient id="l" x1="0" y1="0" x2="1" y2="1"><stop stop-color="#d3e6db" stop-opacity=".5"/><stop offset="1" stop-color="#eff6f1" stop-opacity=".06"/></linearGradient></defs><path d="M700-60H1536V170C1374 67 1253 83 1110 131C971 178 888 167 765 128C871 113 943 50 1003-30Z" fill="url(#u)"/><path d="M-120 685C112 723 165 860 310 973C359 1011 420 1050 485 1080H-120Z" fill="url(#l)"/><path d="M-120 760C74 781 128 905 260 1022L350 1080H-120Z" fill="#dbece1" opacity=".47"/><path d="M-120 835C38 818 111 943 204 1040L240 1080H-120Z" fill="#cee3d6" opacity=".32"/></svg></div>`;
function topbar(size) {
  const sw = size.w <= 1024 ? 300 : size.w <= 1180 ? 320 : size.w >= 2560 ? 520 : 440;
  return `<div class="top" style="--search-w:${sw}px"><div class="search">${i("search")}<span>Hledat fakturu, zákazníka nebo částku…</span></div><div class="grow"></div><span class="btn">${i("upload")}Importovat fakturu</span><span class="btn primary">${i("plus")}Nová faktura</span><span class="btn round">${i("bell")}</span></div>`;
}
const PAGE_VARS = (s) => {
  const big = s.w >= 2560 ? 2 : s.w >= 1900 ? 1 : 0;
  return { pad: [24, 28, 40, 48][SIZES.indexOf(s)], stack: s.h <= 830 ? 18 : 24, h1: [42, 45, 48][big], compactHead: s.w < 1300, big };
};
function doc(size, title, body, { scrolls = false, extraCss = "", script = "" } = {}) {
  return `<!doctype html><html lang="cs"><head><meta charset="utf-8"><meta name="viewport" content="width=${size.w}"><title>${title} · ${size.label}</title><style>${CSS}${extraCss}</style></head><body class="${scrolls ? "scrolls" : ""}" data-size="${size.id}">${BG}${body}<script>${FIT_SCRIPT}${script}</script></body></html>`;
}
// "Automaticky" rows-per-page: keep only whole rows that fit, spread the rest into row
// padding (max +18 px per row, split top/bottom) so no gap is left below the last row (rule 4).
const FIT_SCRIPT = `
function fitRows(){for(const box of document.querySelectorAll('.rows[data-fit]')){const rows=[...box.children];rows.forEach(r=>r.style.display='');const avail=box.clientHeight;let used=0,kept=0;for(const r of rows){if(used+r.offsetHeight<=avail+0.5){used+=r.offsetHeight;kept++;}else r.style.display='none';}
const extra=Math.min(18,Math.floor((avail-used)/Math.max(1,kept)));rows.slice(0,kept).forEach(r=>{const cs=getComputedStyle(r);r.style.paddingTop=(parseFloat(cs.paddingTop)+Math.floor(extra/2))+'px';r.style.paddingBottom=(parseFloat(cs.paddingBottom)+Math.ceil(extra/2))+'px';});
const total=+box.dataset.total;const info=box.parentElement.querySelector('[data-info]');if(info)info.textContent='Zobrazuji 1–'+kept+' z '+total+' '+box.dataset.noun;const pages=Math.ceil(total/kept);const pg=box.parentElement.querySelector('[data-pages]');if(pg)pg.innerHTML=(pages<=4?Array.from({length:pages},(_,n)=>n+1):[1,2,'…',pages]).map(n=>'<span class="pg'+(n===1?' on':'')+'">'+n+'</span>').join('');box.dataset.kept=kept;}}
function fitNav(){const n=document.querySelector('[data-nav]');if(!n)return;const f=n.querySelector('[data-nav-fill]');const items=[...n.querySelectorAll(':scope > a:not(.esko):not(.sub)')];const spare=f.getBoundingClientRect().height-24;if(spare<=0)return;const add=Math.min(14,Math.floor(spare/items.length/2));items.forEach(a=>{const cs=getComputedStyle(a);a.style.paddingTop=(parseFloat(cs.paddingTop)+add)+'px';a.style.paddingBottom=(parseFloat(cs.paddingBottom)+add)+'px';});}
document.fonts.ready.then(()=>{fitNav();fitRows();});`;

// ---------------------------------------------------------------- data (synthetic)
const INV = Array.from({ length: 16 }, (_, k) => {
  const st = ["overdue", "overdue", "waiting", "partial", "waiting", "paid", "overdue", "waiting"][k % 8];
  const amt = ["266 189,00", "15 730,00", "243 687,00", "24 142,00", "106 192,00", "29 900,00", "12 500,00", "9 116,00"][k % 8] + " Kč";
  return { no: `FV-2026-${String(k + 1).padStart(4, "0")}`, cust: k === 2 ? "Ukázkový odběratel s velmi dlouhým názvem společnosti a.s." : `Ukázkový odběratel ${k + 1} s.r.o.`, amt, due: `${14 + (k % 14)}. 10. 2026`, st };
});
const PILL = { overdue: ["Po splatnosti", "clock"], waiting: ["Čeká na úhradu", "hourglass"], partial: ["Částečně uhrazeno", null], paid: ["Zaplaceno", "check"] };
const pill = (st) => `<span class="pill ${st}">${PILL[st][1] ? i(PILL[st][1]) : ""}${PILL[st][0]}</span>`;

// ---------------------------------------------------------------- Nástěnka
function dashboard(s) {
  const v = PAGE_VARS(s);
  const narrow = s.w < 1300;
  const kpi = (ic, tone, label, value, sub) => `<div class="card kpi ${tone}"><span class="kpi-ic">${i(ic)}</span><div class="stack2"><span class="kpi-l">${label}</span><b class="kpi-v num">${value}</b><span class="kpi-s num">${sub}</span></div></div>`;
  const months = ["lis", "pro", "led", "úno", "bře", "dub", "kvě", "čvn", "čvc", "srp", "zář", "říj"];
  const bars = months.map((m, k) => { const a = [30, 40, 55, 70, 25, 45, 60, 72, 50, 48, 62, 66][k], b = [20, 15, 25, 30, 10, 12, 30, 28, 4, 20, 26, 30][k], c = [6, 6, 8, 20, 4, 4, 14, 16, 0, 10, 8, 12][k]; return `<div class="bar"><div class="stack" style="height:${a + b + c}%"><i style="flex:${c};background:#e2706a"></i><i style="flex:${b};background:#f3c48f"></i><i style="flex:${a};background:var(--green)"></i></div><span>${m}</span></div>`; }).join("");
  const recCols = narrow ? "minmax(0,1fr) 118px 88px 132px 20px" : `130px minmax(0,1fr) ${s.w >= 2560 ? 150 : 140}px 110px ${s.w >= 2560 ? 160 : 150}px 20px`;
  const recent = INV.map((r) => `<div class="row" style="grid-template-columns:${recCols}">${narrow ? `<div class="stack2"><b class="ell">${r.cust}</b><span class="muted num">${r.no}</span></div>` : `<b class="num">${r.no}</b><span class="ell">${r.cust}</span>`}<b class="num" style="text-align:right">${r.amt}</b><span class="num ${r.st === "overdue" ? "" : "muted"}" style="text-align:right;${r.st === "overdue" ? "color:var(--red)" : ""}">${r.due}</span>${pill(r.st)}${i("more", "muted")}</div>`).join("");
  const rem = Array.from({ length: 12 }, (_, k) => `<div class="row" style="grid-template-columns:10px minmax(0,1fr) ${narrow ? 112 : 140}px 14px"><span class="dot"></span><div class="stack2"><b class="ell">Ukázkový odběratel ${k + 1} s.r.o.</b><span class="muted">${narrow ? "" : "Faktura "}<span class="num">FV-2026-${String(k + 1).padStart(4, "0")}</span>${narrow ? "" : ` · <span class="num">${20 + (k % 8)}. 10. 2026</span>`}</span></div><b class="num" style="text-align:right">${INV[k % 8].amt}</b>${i("right", "muted")}</div>`).join("");
  const body = `<div class="app">${nav(s, "Nástěnka")}<main class="main" style="--pad:${v.pad}px;--stack:${v.stack - 4}px">${topbar(s)}
  <header class="head ${v.compactHead ? "compact-head" : ""}" style="--h1:${narrow ? 32 : v.h1 - 10}px"><div class="t"><div class="eyebrow">Sobota 7. listopadu 2026</div><h1>Dobrý den, Ukázkový uživateli!</h1><p class="sub">25 faktur čeká na úplnou úhradu, z toho 7 po splatnosti.</p></div><span class="btn">${i("cal")}Za celé období${i("down")}</span></header>
  <section class="kpis">${kpi("file", "", "Celkem faktur", "124", "Za celé období")}${kpi("hourglass", "amber", "Čeká na splatnost", "18", "1 020 000,00 Kč")}${kpi("clock", "red", "Po splatnosti", "7", "320 000,00 Kč")}${kpi("check", "green", "Zaplaceno", "99", "1 980 000,00 Kč")}</section>
  <section class="grid2 charts"><div class="card fillcol"><div class="card-h"><h2>Faktury v čase</h2>${i("more", "muted")}</div><div class="legend"><span><i style="background:var(--green)"></i>Uhrazeno</span><span><i style="background:#f3c48f"></i>Čeká na splatnost</span><span><i style="background:#e2706a"></i>Po splatnosti</span></div><div class="plot">${bars}</div></div>
  <div class="card donutcard"><div class="card-h"><h2>Stav faktur</h2></div><div class="donutwrap"><div class="donut"><b class="num">124</b><span>faktur</span></div><ul class="dl"><li><i style="background:var(--green)"></i><span>Zaplaceno</span><b>99</b><em>80 %</em></li><li><i style="background:#f3c48f"></i><span>Čeká na splatnost</span><b>18</b><em>15 %</em></li><li><i style="background:#e2706a"></i><span>Po splatnosti</span><b>7</b><em>6 %</em></li></ul></div></div></section>
  <section class="grid2 lists"><div class="card fillcol"><div class="card-h"><h2>Poslední faktury</h2><span class="link">Zobrazit všechny ${i("arrow")}</span></div><div class="fillcol" style="margin-top:12px"><div class="rows" data-fit data-total="124" data-noun="faktur">${recent}</div></div></div>
  <div class="card fillcol"><div class="card-h"><h2>Nejbližší upomínky</h2><span class="link">12 odesláno</span></div><div class="fillcol" style="margin-top:8px"><div class="rows" data-fit data-total="12" data-noun="upomínek">${rem}</div></div></div></section>
  </main></div>`;
  const kv = [[34, 14], [36, 14], [46, 17], [56, 20]][SIZES.indexOf(s)];
  const css = `
  .kpis{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:14px;flex:none;container-type:inline-size}
  /* rule 12: on wide cards the icon + value block sits in the card's centre, not stuck to the left edge */
  @container (min-width: 1500px){.kpi{justify-content:center;gap:22px}}
  .kpi{display:flex;align-items:center;gap:14px;padding:${s.h <= 830 ? 14 : 18}px 18px;container-type:inline-size}
  .kpi-ic{display:grid;place-items:center;width:clamp(40px,14cqi,68px);height:clamp(40px,14cqi,68px);border-radius:50%;background:var(--green-soft);color:var(--green);flex:none}.kpi-ic .ic{width:42%;height:42%}
  .kpi.amber .kpi-ic{background:var(--amber-soft);color:var(--amber)}.kpi.red .kpi-ic{background:var(--red-soft);color:var(--red)}
  .kpi-l{font-weight:600;font-size:${kv[1] - 1}px;line-height:1.25;text-wrap:balance}
  .kpi-v{font-size:clamp(28px,12cqi,${kv[0]}px);line-height:1.05;letter-spacing:-.02em}
  .kpi.amber .kpi-v{color:var(--amber)}.kpi.red .kpi-v,.kpi.red .kpi-s{color:var(--red)}.kpi.green .kpi-v,.kpi.green .kpi-s{color:var(--green)}
  .kpi-s{font-weight:600;font-size:${kv[1] - 2}px}
  .grid2{display:grid;grid-template-columns:minmax(0,1.75fr) minmax(${narrow ? 280 : 360}px,1fr);gap:14px;min-height:0}
  .charts{flex:${s.h >= 1300 ? "0 0 38%" : s.h >= 1000 ? "0 0 34%" : "0 0 " + (s.h <= 800 ? 200 : 214) + "px"}}
  .lists{flex:1}
  .legend{display:flex;gap:16px;padding:8px 18px 0;color:var(--muted);flex-wrap:wrap}.legend span{display:inline-flex;align-items:center;gap:6px;white-space:nowrap}.legend i{width:9px;height:9px;border-radius:50%}
  .plot{flex:1;min-height:0;display:grid;grid-template-columns:repeat(12,1fr);gap:clamp(6px,1.2vw,22px);padding:10px 18px 12px;align-items:end}
  .bar{height:100%;display:flex;flex-direction:column;align-items:center;gap:6px;min-width:0}.bar .stack{width:min(100%,46px);display:flex;flex-direction:column;border-radius:4px 4px 0 0;overflow:hidden;margin-top:auto}.bar span{color:var(--muted);font-size:12px}
  .donutcard{display:flex;flex-direction:column;container-type:size}
  .donutwrap{flex:1;min-height:0;display:flex;align-items:center;justify-content:center;gap:clamp(16px,6cqi,40px);padding:8px 18px 14px}
  .donut{flex:none;width:clamp(96px,min(62cqh,34cqi),300px);aspect-ratio:1;border-radius:50%;background:conic-gradient(var(--green) 0 80%,#f3c48f 0 95%,#e2706a 0);display:grid;place-content:center;text-align:center;position:relative}
  .donut::before{content:"";position:absolute;inset:16%;border-radius:50%;background:#fff}.donut b,.donut span{position:relative}.donut b{font-size:clamp(24px,9cqi,44px);line-height:1}.donut span{color:var(--muted);font-size:clamp(12px,3.4cqi,16px)}
  .dl{list-style:none;padding:0;display:grid;gap:clamp(8px,3cqh,16px);font-size:clamp(13px,3.4cqi,19px)}.dl li{display:grid;grid-template-columns:10px auto max-content max-content;align-items:center;gap:8px;white-space:nowrap}.dl i{width:9px;height:9px;border-radius:50%}.dl b,.dl em{text-align:right;font-style:normal}.dl em{color:var(--muted)}
  @container (max-width: 360px){.dl{font-size:13px;gap:8px}.dl li{grid-template-columns:10px auto max-content}.dl em{display:none}.donutwrap{gap:14px;padding-inline:14px}}
  .dot{width:9px;height:9px;border-radius:50%;background:#f3c48f}
  .lists .row{font-size:${[13, 13, 14, 15][SIZES.indexOf(s)]}px}
  `;
  return doc(s, "Nástěnka", body, { extraCss: css });
}

// ---------------------------------------------------------------- Zákazníci
function customers(s) {
  const v = PAGE_VARS(s);
  const k = SIZES.indexOf(s);
  const withDetail = s.w >= 2560;
  const cols = k <= 1
    ? `minmax(0,1.5fr) minmax(0,1.25fr) 112px ${k === 1 ? "84px" : ""} 132px 20px`
    : `minmax(0,1.6fr) minmax(0,1.35fr) 150px 150px 150px 110px 20px`;
  const head = k <= 1
    ? `<span>Zákazník</span><span>Kontakt</span><span style="text-align:right">Fakturace</span>${k === 1 ? '<span style="text-align:right">Poslední</span>' : ""}<span>Neuhrazeno</span><span></span>`
    : `<span>Zákazník</span><span>Kontakt</span><span style="text-align:right">Fakturace</span><span>Neuhrazeno</span><span>Upomínky</span><span style="text-align:right">Poslední faktura</span><span></span>`;
  const people = Array.from({ length: 20 }, (_, n) => ({
    name: n === 1 ? "Ukázkový odběratel s velmi dlouhým názvem společnosti a.s." : `Ukázkový odběratel ${n + 1} s.r.o.`,
    mail: n === 1 ? "fakturace.oddeleni.dlouhy.nazev@example.invalid" : `kontakt${n + 1}@example.invalid`,
    phone: n % 3 === 2 ? null : "+420 777 123 456", total: INV[n % 8].amt, count: (n % 7) + 1, open: n % 5 === 4 ? null : INV[(n + 3) % 8].amt, tone: ["red", "amber", "red", "amber", "green"][n % 5], rem: n % 2 ? "Standardní" : "Nepřiřazeno",
  }));
  const rows = people.map((p, n) => `<div class="row${withDetail && n === 1 ? " sel" : ""}" style="grid-template-columns:${cols}">
    <div class="cust"><span class="ini">${p.name[0]}</span><div class="stack2"><b class="ell" title="${p.name}">${p.name}</b><span class="muted ell num">IČO 12345678${k >= 2 ? " · Ukázková ulice 123, Praha 110 00" : ""}</span></div></div>
    <div class="stack2"><span class="ell" title="${p.mail}">${i("mail", "s")} ${p.mail}</span><span class="muted ell">${p.phone ? i("phone", "s") + " " + p.phone : '<span class="link">+ Přidat telefon</span>'}</span></div>
    <div class="stack2" style="text-align:right"><b class="num">${p.total}</b><span class="muted num">${p.count} ${p.count === 1 ? "faktura" : p.count < 5 ? "faktury" : "faktur"}</span></div>
    ${k === 1 ? '<span class="muted num" style="text-align:right">1. 9. 2026</span>' : ""}
    <span>${p.open ? `<span class="amt ${p.tone}">${p.open}</span>` : `<span class="pill paid">${i("check")}Uhrazeno</span>`}</span>
    ${k >= 2 ? `<span class="muted">${p.rem}</span><span class="muted num" style="text-align:right">1. 9. 2026</span>` : ""}
    ${i("more", "muted")}</div>`).join("");
  const detail = withDetail ? `<aside class="card detail"><div class="card-h"><h2>Ukázkový odběratel s velmi dlouhým názvem společnosti a.s.</h2>${i("x", "muted")}</div>
    <div class="dbody"><div class="big num">243 686,58 Kč<small>neuhrazeno · 2 faktury po splatnosti</small></div>
    <dl><dt>IČO / DIČ</dt><dd class="num">12345678 · CZ12345678</dd><dt>Adresa</dt><dd>Ukázková ulice 123, Praha 110 00</dd><dt>E-mail</dt><dd class="ell">fakturace.oddeleni.dlouhy.nazev@example.invalid</dd><dt>Telefon</dt><dd class="num">+420 777 123 456</dd><dt>Upomínky</dt><dd>Standardní upomínky</dd></dl>
    <h3>Otevřené faktury</h3>${INV.slice(0, 4).map((r) => `<div class="mini"><div class="stack2"><b class="num">${r.amt}</b><span class="muted"><span class="num">${r.no}</span> · splatnost <span class="num">${r.due}</span></span></div>${pill(r.st)}</div>`).join("")}
    <h3>Poslední platby</h3>${[["28. 10. 2026","15 000,00 Kč","FV-2026-0002"],["2. 10. 2026","243 687,00 Kč","FV-2025-0091"],["14. 9. 2026","8 400,00 Kč","FV-2025-0088"]].map(([d,a,n]) => `<div class="mini"><div class="stack2"><b class="num">${a}</b><span class="muted"><span class="num">${d}</span> · <span class="num">${n}</span></span></div><span class="pill paid">${i("check")}Spárováno</span></div>`).join("")}<div class="fill"></div><span class="btn primary">${i("mail")}Poslat upomínku</span><span class="btn">${i("pencil")}Upravit zákazníka</span></div></aside>` : "";
  const body = `<div class="app">${nav(s, "Zákazníci")}<main class="main" style="--pad:${v.pad}px;--stack:${v.stack}px">${topbar(s)}
  <header class="head ${v.compactHead ? "compact-head" : ""}" style="--h1:${v.compactHead ? 32 : v.h1}px"><div class="t"><div class="eyebrow">Registr zákazníků</div><h1>Zákazníci</h1><p class="sub">Kontakty, fakturace a stav pohledávek na jednom místě.</p></div><span class="btn">${i("download")}Export do Excelu</span></header>
  <div class="split"><section class="card fillcol panel"><div class="filters"><div class="search wide">${i("search")}<span>Název, IČO, DIČ, kontakt, adresa nebo poznámka</span></div><span class="count"><b>26</b> nalezených zákazníků</span></div>
  <div class="thead" style="grid-template-columns:${cols}">${head}</div>
  <div class="rows" data-fit data-total="26" data-noun="zákazníků">${rows}</div>
  <div class="foot"><span class="muted" data-info></span><span class="grow"></span><span class="btn" style="padding:7px 12px">Automaticky ${i("down")}</span>${i("left", "muted")}<span data-pages style="display:inline-flex;gap:4px"></span>${i("right")}</div></section>${detail}</div>
  </main></div>`;
  const css = `
  .split{flex:1;min-height:0;display:flex;gap:24px}.panel{flex:1;overflow:hidden}
  .filters{display:flex;align-items:center;gap:16px;padding:16px 18px;flex:none}.search.wide{flex:1;max-width:620px;width:auto}.count{white-space:nowrap;color:var(--muted)}.count b{color:var(--green);font-size:20px;margin-right:4px}
  .cust{display:flex;align-items:center;gap:12px;min-width:0}.ini{display:grid;place-items:center;width:34px;height:34px;border-radius:9px;background:var(--green-soft);color:var(--green);font-weight:700;flex:none}
  .ic.s{width:13px;height:13px;vertical-align:-2px;color:var(--muted)}
  .amt{display:inline-block;padding:4px 9px;border-radius:999px;font-weight:600;white-space:nowrap}.amt.red{background:var(--red-soft);color:var(--red)}.amt.amber{background:var(--amber-soft);color:var(--amber)}.amt.green{background:var(--green-soft);color:var(--green)}
  .row{font-size:${[13, 13, 14, 15][k]}px}.row.sel{background:var(--green-soft)}
  .detail{width:420px;flex:none;display:flex;flex-direction:column}.detail .card-h h2{white-space:normal;text-wrap:balance;font-size:20px}
  .dbody{flex:1;display:flex;flex-direction:column;gap:14px;padding:16px 22px 22px;font-size:15px}.big{font-size:32px;font-weight:700;color:var(--red);display:flex;flex-direction:column}.big small{font-size:14px;color:var(--muted);font-weight:400}
  dl{display:grid;grid-template-columns:110px minmax(0,1fr);gap:10px 12px}dt{color:var(--muted)}dd{margin:0;min-width:0}
  h3{font-size:15px;margin-top:6px}.mini{display:grid;grid-template-columns:minmax(0,1fr) max-content;gap:12px;align-items:center;padding:10px 12px;border-radius:10px;background:var(--canvas)}
  .dbody .fill{flex:1}.dbody .btn{width:100%;padding-block:14px}
  `;
  return doc(s, "Zákazníci", body, { extraCss: css });
}

// ---------------------------------------------------------------- Tvorba faktury
function invoiceCreate(s) {
  const v = PAGE_VARS(s);
  const k = SIZES.indexOf(s);
  const cols = k >= 2 ? 3 : 2; // field columns grow with the form container
  const f = (label, value = "", { span = 1, kind } = {}) => `<label class="f" style="grid-column:span ${Math.min(span, cols)}"><span>${label}</span><span class="in ${value ? "" : "ph"}">${value || "&nbsp;"}${kind === "sel" ? i("down") : kind === "date" ? i("cal") : ""}</span></label>`;
  const items = k >= 2
    ? `<div class="itemrow"><span class="in ph">Název služby nebo zboží</span><span class="in num">1</span><span class="in">ks · kus${i("down")}</span><span class="in num">0</span><span class="in">21 %${i("down")}</span><b class="num">0,00 Kč</b>${i("more", "muted")}</div>`
    : `<div class="fgrid" style="--cols:2">${f("Položka", "", { span: 2 })}${f("Množství", "1")}${f("Jednotka", "ks · kus", { kind: "sel" })}${f("Cena/MJ bez DPH", "0")}${f("DPH", "21 %", { kind: "sel" })}</div>`;
  const previewW = [300, 340, 480, 600][k];
  const body = `<div class="app">${nav(s, "Faktury", "Vystavit fakturu")}<main class="main" style="--pad:${v.pad}px;--stack:${v.stack}px">${topbar(s)}
  <header class="head ${v.compactHead ? "compact-head" : ""}" style="--h1:${v.compactHead ? 32 : v.h1}px"><div class="t"><span class="link" style="color:var(--muted)">${i("back")}Zpět na faktury</span><h1 style="margin-top:6px">Nová faktura</h1><p class="sub">Vytvořte fakturu a odešlete ji zákazníkovi.</p></div></header>
  <div class="editor"><div class="form">
    <section class="card sec"><h2>Základní údaje</h2><div class="fgrid" style="--cols:${cols}">
      <label class="f" style="grid-column:span ${cols}"><span>Odběratel</span><span class="in ph">${i("search", "lead")}Vyberte zákazníka…${i("down")}</span></label>
      ${cols === 3
        ? f("Název / jméno *", "", { span: 2 }) + f("E-mail pro odeslání") + f("Fakturační adresa *", "", { span: 2 }) + f("IČO") + f("DIČ") + f("Měna", "CZK", { kind: "sel" }) + f("Způsob úhrady", "Bankovní převod", { kind: "sel" }) + f("Číslo faktury *", "FV-2026-000027") + f("Variabilní symbol", "2026000027") + f("Bankovní účet *", "123456789/0100", { kind: "sel" })
        : f("Název / jméno *") + f("E-mail pro odeslání") + f("Fakturační adresa *", "", { span: 2 }) + f("IČO") + f("DIČ") + f("Číslo faktury *", "FV-2026-000027") + f("Variabilní symbol", "2026000027")}
      ${f("Datum vystavení *", "19. 10. 2026", { kind: "date" })}${f("Datum splatnosti *", "2. 11. 2026", { kind: "date" })}${f("DUZP *", "19. 10. 2026", { kind: "date" })}
      ${cols === 2 ? f("Měna", "CZK", { kind: "sel" }) + f("Způsob úhrady", "Bankovní převod", { kind: "sel" }) + f("Bankovní účet *", "123456789/0100", { kind: "sel", span: 2 }) : ""}
    </div></section>
    <section class="card sec"><h2>Položky faktury</h2>${k >= 2 ? `<div class="ihead"><span>Položka</span><span>Množství</span><span>Jednotka</span><span>Cena/MJ bez DPH</span><span>DPH</span><span style="text-align:right">Celkem</span><span></span></div>` : ""}${items}
      <div class="sum"><span class="btn">${i("plus")}Přidat položku</span><span class="grow"></span><dl><dt>Bez DPH</dt><dd class="num">0,00 Kč</dd><dt>DPH 21 %</dt><dd class="num">0,00 Kč</dd><dt class="tot">Celkem k úhradě</dt><dd class="tot num">0,00 Kč</dd></dl></div></section>
    <section class="card sec"><h2>Poznámky</h2><div class="fgrid" style="--cols:2"><label class="f"><span>Poznámka na faktuře</span><span class="in area">Děkujeme za spolupráci.</span></label><label class="f"><span>Interní poznámka</span><span class="in area ph">Viditelná pouze ve Splatnu…</span></label></div></section>
    <section class="card sec att"><span>${i("file")}</span><div class="stack2"><b>Přiložte podklad pro interní evidenci</b><span class="muted">PDF, JPG, PNG nebo WEBP · nejvýše 10 MB</span></div><span class="btn">Vybrat soubor</span></section>
  </div>
  <aside class="preview card"><div class="card-h"><h2>Náhled faktury</h2>${k <= 1 ? "" : '<span class="muted">Šablona</span>'}<span class="btn" style="padding:7px 10px">Standardní${i("down")}</span></div>
    <div class="paperwrap"><div class="paper"><div class="ph1"><small>DAŇOVÝ DOKLAD</small><b>Ukázková firma s.r.o.</b><span class="muted">Faktura č. FV-2026-000027</span></div>
      <div class="pdates"><div><small>Vystaveno</small><b>19. 10. 2026</b></div><div><small>DUZP</small><b>19. 10. 2026</b></div><div><small>Splatnost</small><b style="color:var(--green)">2. 11. 2026</b></div></div>
      <div class="pparties"><div><small>Dodavatel</small><b>Ukázková firma s.r.o.</b><span>Ukázková 1, Praha<br>IČO 12345678<br>DIČ CZ12345678</span></div><div><small>Odběratel</small><b>Doplňte odběratele</b><span>Fakturační adresa</span></div></div>
      <div class="pitem"><b>Název položky</b><span>1 ks</span><span>0,00 Kč</span><b>0,00 Kč</b></div>
      <div class="ptot"><span>Celkem bez DPH</span><span>0,00 Kč</span><span>DPH 21 %</span><span>0,00 Kč</span><b>Celkem k úhradě</b><b>0,00 Kč</b></div></div></div>
    <div class="pact"><span class="btn primary">${i("mail")}Vystavit a odeslat fakturu</span><div class="two"><span class="btn">${i("download")}Stáhnout PDF</span><span class="btn">${i("eye")}Zobrazit PDF</span></div><span class="link" style="justify-content:center">Uložit koncept</span></div></aside>
  </div></main></div>`;
  const css = `
  .editor{display:grid;grid-template-columns:minmax(0,1fr) ${previewW}px;gap:${k >= 2 ? 28 : 18}px;align-items:start}
  .form{display:flex;flex-direction:column;gap:18px;min-width:0;container-type:inline-size}
  .sec{padding:20px 22px}.sec h2{font-size:${[17, 17, 18, 20][k]}px;margin-bottom:16px}
  .fgrid{display:grid;grid-template-columns:repeat(var(--cols),minmax(0,1fr));gap:14px 16px}
  .f{display:flex;flex-direction:column;gap:6px;min-width:0;font-size:${[13, 13, 14, 14][k]}px}.f>span:first-child{font-weight:500}
  .in{display:flex;align-items:center;gap:8px;min-height:44px;padding:0 12px;border:1px solid var(--line-strong);border-radius:10px;background:#fff;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;font-size:${[14, 14, 15, 15][k]}px}.in .ic{margin-left:auto;color:var(--muted)}.in .ic.lead{margin-left:0}.in.ph{color:#98a39c}.in.area{align-items:flex-start;padding-top:12px;min-height:96px;white-space:normal}
  .ihead,.itemrow{display:grid;grid-template-columns:minmax(0,2.4fr) 90px 130px 140px 100px 120px 20px;gap:12px;align-items:center}.ihead{font-size:12px;color:var(--muted);font-weight:600;margin-bottom:8px}.itemrow b{text-align:right}
  .sum{display:flex;align-items:flex-end;gap:16px;margin-top:18px;padding-top:16px;border-top:1px solid var(--line)}.sum .grow{flex:1}.sum dl{display:grid;grid-template-columns:auto auto;gap:6px 40px;font-size:14px}.sum dd{margin:0;text-align:right}.sum .tot{color:var(--green);font-weight:700;font-size:17px}
  .att{display:flex;align-items:center;gap:14px}.att .stack2{flex:1}
  /* preview: sticky, fills the window height, never cut (rules 2, 7) */
  .preview{position:sticky;top:20px;display:flex;flex-direction:column;max-height:calc(100vh - 40px);container-type:inline-size}
  .paperwrap{flex:1;min-height:0;overflow:auto;padding:14px 18px 0}
  .paper{border:1px solid var(--line);border-top:3px solid var(--green);border-radius:10px;padding:clamp(14px,6cqi,30px);font-size:clamp(9px,3.1cqi,14px);display:flex;flex-direction:column;gap:clamp(10px,4cqi,22px)}
  .paper small{display:block;color:var(--muted);font-size:.8em;text-transform:uppercase;letter-spacing:.06em}.ph1 b{display:block;font-size:2em;letter-spacing:-.02em}
  .pdates,.pparties{display:grid;grid-template-columns:repeat(3,1fr);gap:8px;padding-top:10px;border-top:1px solid var(--line)}.pparties{grid-template-columns:1fr 1fr}.pparties b,.pdates b{display:block}.pparties span{color:var(--muted)}
  .pitem{display:grid;grid-template-columns:1fr auto auto auto;gap:12px;padding-top:10px;border-top:1px solid var(--line)}
  .ptot{display:grid;grid-template-columns:1fr auto;gap:4px 16px;padding:10px 12px;border-radius:8px;background:var(--canvas)}.ptot b{color:var(--green)}
  .pact{display:flex;flex-direction:column;gap:10px;padding:16px 18px 18px;border-top:1px solid var(--line);flex:none}.pact .btn{width:100%}.pact .two{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:10px}
  `;
  return doc(s, "Tvorba faktury", body, { scrolls: true, extraCss: css });
}

// ---------------------------------------------------------------- gallery
const PAGES = [["dashboard", "Nástěnka", dashboard], ["customers", "Zákazníci", customers], ["invoice-create", "Tvorba faktury", invoiceCreate]];
await mkdir(OUT, { recursive: true });
const files = [];
for (const [id, , fn] of PAGES) for (const s of SIZES) { const name = `${id}-${s.w}x${s.h}.html`; await writeFile(resolve(OUT, name), fn(s)); files.push(name); }
const gallery = `<!doctype html><html lang="cs"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Responzivní mockupy</title><style>body{font:14px/1.5 Inter,system-ui,sans-serif;margin:24px;background:#f5f6f2;color:#17251d}h2{margin:32px 0 8px}.row{display:flex;gap:24px;flex-wrap:wrap;align-items:flex-start}figure{margin:0}figcaption{font-weight:600;margin-bottom:6px}.frame{overflow:hidden;border:1px solid #cbd4cd;border-radius:8px;background:#fff}iframe{border:0;transform-origin:0 0}</style></head><body><h1>Responzivní mockupy — HTML prototypy</h1><p>Každý rám je jedno okno v plné velikosti, zmenšené pro náhled. Vzorová data. Pravidla: docs/responsive/TRANSITION_RULES.md.</p>
${PAGES.map(([id, label]) => `<h2>${label}</h2><div class="row">${SIZES.map((s) => { const sc = 520 / s.w; return `<figure><figcaption>${s.label}</figcaption><div class="frame" style="width:${Math.round(s.w * sc)}px;height:${Math.round(s.h * sc)}px"><iframe src="${id}-${s.w}x${s.h}.html" width="${s.w}" height="${s.h}" style="transform:scale(${sc})" loading="lazy"></iframe></div></figure>`; }).join("")}</div>`).join("")}</body></html>`;
await writeFile(resolve(OUT, "index.html"), gallery);
console.log(files.length + " mockups + index.html → " + OUT);
