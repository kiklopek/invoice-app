// One review page for all mockups: per page the two pillars (today, unchanged) and the
// proposal for each target size. HTML prototypes are embedded live; Figma exports and
// screenshots of the fixed app are shown as images.
//   node scripts/responsive-mockups/html/review.mjs  → docs/responsive/mockups/review.html
import { writeFile, access } from "node:fs/promises";
import { resolve } from "node:path";

const DIR = resolve("docs/responsive/mockups");
const REF = "../handoff/reference"; // relative to DIR (images are local, not in git)
const SIZES = [[1024, 768, "tablet na šířku"], [1180, 820, "iPad Air na šířku"], [1920, 1080, "velký monitor"], [2560, 1440, "27\" monitor"]];
const PAGES = [
  { id: "invoices", label: "Faktury", source: "HTML prototyp (směr schválený ve Figmě)", item: (w, h) => ({ html: `invoices-${w}x${h}.html` }) },
  { id: "dashboard", label: "Nástěnka", source: "HTML prototyp", item: (w, h) => ({ html: `dashboard-${w}x${h}.html` }) },
  { id: "customers", label: "Zákazníci", source: "HTML prototyp", item: (w, h) => ({ html: `customers-${w}x${h}.html` }) },
  { id: "invoice-create", label: "Tvorba faktury", source: "HTML prototyp (stránka se posouvá)", item: (w, h) => ({ html: `invoice-create-${w}x${h}.html` }) },
  { id: "payments", label: "Platby — nahrání výpisu", source: "už opravená aplikace", item: (w, h) => ({ img: `${REF}/mockups/payments-${w}x${h}.png` }) },
];
const exists = async (p) => access(resolve(DIR, p)).then(() => true, () => false);
const W = 400; // preview width of each target frame
let html = `<!doctype html><html lang="cs"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Kontrola mockupů</title>
<style>
body{font:14px/1.5 Inter,system-ui,sans-serif;margin:0;background:#eef1ec;color:#17251d}
header{position:sticky;top:0;z-index:2;background:#17462f;color:#fff;padding:14px 24px;display:flex;gap:18px;align-items:center;flex-wrap:wrap}
header b{font-size:18px}header a{color:#dcebbd;text-decoration:none;font-weight:600}
section{padding:24px;border-bottom:1px solid #cbd4cd}
h2{margin:0 0 4px}.src{color:#66736b;margin:0 0 14px}
.row{display:flex;gap:18px;overflow-x:auto;padding-bottom:10px;align-items:flex-start}
figure{margin:0;flex:none}figcaption{font-weight:600;margin-bottom:6px;white-space:nowrap}figcaption span{font-weight:400;color:#66736b}
.frame{overflow:hidden;border:1px solid #cbd4cd;border-radius:8px;background:#fff;display:block}
.frame img{display:block;width:100%}
.pillar figcaption{color:#245f42}.pillar .frame{border:3px solid #245f42}
.missing{display:grid;place-items:center;color:#66736b;background:#f5f6f2;font-size:13px;text-align:center;padding:12px}
iframe{border:0;transform-origin:0 0;display:block}
.tip{background:#fff;border:1px solid #cbd4cd;border-radius:10px;padding:12px 16px;margin:16px 24px 0}
</style></head><body>
<header><b>Kontrola responzivních mockupů</b>${PAGES.map((p) => `<a href="#${p.id}">${p.label}</a>`).join("")}</header>
<div class="tip">Zelený rámeček = dnešní pilíř (mobil, MacBook), ten se nemění. Ostatní = návrh. HTML prototypy můžeš otevřít v plné velikosti kliknutím na popisek. Pravidla: <code>docs/responsive/TRANSITION_RULES.md</code>.</div>`;
for (const p of PAGES) {
  html += `<section id="${p.id}"><h2>${p.label}</h2><p class="src">Návrh: ${p.source}</p><div class="row">`;
  for (const [kind, file, cap, w] of [["mobil", `${REF}/pillars/${p.id}--mobil-390.png`, "Pilíř · mobil 390", 190], ["macbook", `${REF}/pillars/${p.id}--macbook-1470x830.png`, "Pilíř · MacBook 1470 × 830", W]]) {
    html += `<figure class="pillar"><figcaption>${cap}</figcaption>${(await exists(file)) ? `<a class="frame" href="${file}" style="width:${w}px"><img src="${file}" alt="${p.label} ${kind}" loading="lazy"></a>` : `<div class="frame missing" style="width:${w}px;height:200px">chybí</div>`}</figure>`;
  }
  for (const [w, h, dev] of SIZES) {
    const it = p.item(w, h); const sc = W / w; const H = Math.round(h * sc);
    let body;
    if (it.html && (await exists(it.html))) body = `<div class="frame" style="width:${W}px;height:${H}px"><iframe src="${it.html}" width="${w}" height="${h}" style="transform:scale(${sc})" loading="lazy"></iframe></div>`;
    else if (it.img && (await exists(it.img))) body = `<a class="frame" href="${it.img}" style="width:${W}px"><img src="${it.img}" alt="${p.label} ${w}x${h}" loading="lazy"></a>`;
    else body = `<div class="frame missing" style="width:${W}px;height:${H}px">${it.alt && (await exists(it.alt)) ? "Ve Figmě je jen rám 1180 bez exportu.<br>Stejné sloupce jako 1024 s railem; sidebar 220 px." : "zatím není"}</div>`;
    const cap = it.html ? `<a href="${it.html}" target="_blank">${w} × ${h}</a>` : `${w} × ${h}`;
    html += `<figure><figcaption>${cap} <span>· ${dev}${it.note ? " · " + it.note : ""}</span></figcaption>${body}</figure>`;
  }
  html += `</div></section>`;
}
html += `</body></html>`;
await writeFile(resolve(DIR, "review.html"), html);
console.log("→ " + resolve(DIR, "review.html"));
