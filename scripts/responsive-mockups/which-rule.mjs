// Lists the CSS rules that set a given property on the first element matching a selector.
//   node scripts/responsive-mockups/which-rule.mjs /invoices/payments 1470x830 "main.content" padding-bottom
import { chromium } from "@playwright/test";
import { startHarness, installNetwork } from "../responsive-audit/harness.mjs";
import { fixtures, NOW } from "../responsive-audit/fixtures.mjs";
const [route, size, sel, prop] = process.argv.slice(2); const [w, h] = size.split("x").map(Number);
const browser = await chromium.launch(); const hs = await startHarness(process.cwd(), "which", 4395);
const c = await browser.newContext({ viewport: { width: w, height: h } }); const p = await c.newPage();
const d = await fixtures(process.cwd()); await p.clock.setFixedTime(new Date(NOW)); await p.addInitScript(x => { window.__AUDIT_DATA__ = x; }, d); await installNetwork(p, d, "normal", []);
await p.goto(hs.url + route, { waitUntil: "networkidle" });
const cdp = await c.newCDPSession(p); await cdp.send("DOM.enable"); await cdp.send("CSS.enable");
const { root } = await cdp.send("DOM.getDocument"); const { nodeId } = await cdp.send("DOM.querySelector", { nodeId: root.nodeId, selector: sel });
const m = await cdp.send("CSS.getMatchedStylesForNode", { nodeId });
for (const r of m.matchedCSSRules) { const props = r.rule.style.cssProperties.filter(x => (x.name === prop || prop.startsWith(x.name + "-") || x.name.startsWith(prop)) && x.value); if (!props.length) continue;
  const media = (r.rule.media || []).map(x => x.text).join(" & ");
  console.log(`${r.rule.selectorList.text.slice(0, 90)}  ${media ? "@" + media : ""}\n    ${props.map(x => x.name + ": " + x.value).join("; ")}   [${(r.rule.origin)} ${r.rule.styleSheetId ? "" : ""}]`); }
await hs.server.close(); await browser.close();
