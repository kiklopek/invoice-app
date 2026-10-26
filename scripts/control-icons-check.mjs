import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";
import { chromium, expect } from "@playwright/test";
const project = process.cwd(),
  fixture = resolve(".cache/control-icons"),
  output = resolve("docs/redesign/visual-validation/control-icons");
await mkdir(fixture, { recursive: true });
await mkdir(output, { recursive: true });
await writeFile(
  resolve(fixture, "index.html"),
  '<html lang="cs"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><div id="root"></div><script type="module" src="/entry.tsx"></script></html>',
);
await writeFile(
  resolve(fixture, "entry.tsx"),
  `
import React,{useState}from'react';import{createRoot}from'react-dom/client';
import'${project}/src/app/globals.css';import'${project}/src/app/minimal.css';import'${project}/src/app/styles/responsive.css';
import{PopupFitter}from'${project}/src/components/popup-fitter';import{FilterIcon}from'${project}/src/components/filter-icon';import{Icon}from'${project}/src/components/icons';import{ChevronDown}from'${project}/src/components/chevron-down';import{CloseIcon}from'${project}/src/components/close-icon';import{Modal}from'${project}/src/components/modal';import{MobileDisclosure}from'${project}/src/components/mobile-disclosure';import{ToastProvider,useToast}from'${project}/src/components/toast';import{OcrDocumentPicker}from'${project}/src/app/(workspace)/invoices/import/ocr-document-picker';import{MatchingDropdown}from'${project}/src/app/(workspace)/invoices/payments/payment-matching-popover';
import reportStyles from '${project}/src/app/(workspace)/reports/reports.module.css';
import dashboardStyles from '${project}/src/app/(workspace)/dashboard/dashboard-summary.module.css';
import settingsStyles from '${project}/src/app/(workspace)/settings/settings-page.module.css';
import onboardingStyles from '${project}/src/app/(onboarding)/onboarding/onboarding.module.css';
import invoiceStyles from '${project}/src/app/(workspace)/invoices/invoices.module.css';
import reviewStyles from '${project}/src/components/invoice-review-form.module.css';
import matchingStyles from '${project}/src/app/(workspace)/invoices/payments/payment-matching.module.css';
function Choice({name,disabled=false}){return <select aria-label={name} defaultValue="one" disabled={disabled}><option value="one">První možnost</option><option value="two">Druhá možnost</option></select>}
function NativeChoices(){return <section data-native-selects style={{display:'grid',gap:16}}>
<h2>Výběrová pole</h2>
<div className={reportStyles.detailFilters}><label>Reporty<Choice name="Reporty"/></label></div>
<div className={dashboardStyles.page} style={{width:'100%',margin:0,padding:0,minHeight:0}}><label className={dashboardStyles.periodControl}>Období<Choice name="Období nástěnky"/></label><div className={dashboardStyles.chartControls}><label>Graf<Choice name="Možnosti grafu"/></label></div><div className={dashboardStyles.reminderSelector}><label>Plán<Choice name="Plán upomínek nástěnky"/></label></div></div>
<div className={settingsStyles.companyPanel}><label className={settingsStyles.field}>Nastavení<Choice name="Nastavení firmy"/></label><label className={settingsStyles.field}>Zakázané<Choice name="Zakázané nastavení" disabled/></label></div>
<label className={onboardingStyles.control+' '+onboardingStyles.plain}>Onboarding<Choice name="Role pozvaného uživatele"/></label>
<div className={invoiceStyles.filters}><label>Faktury<Choice name="Filtr faktur"/></label></div>
<div className={reviewStyles.fields}><label>Měna<Choice name="Měna faktury"/><span className="ocr-field-meta" aria-hidden="true">✓</span></label></div>
<div className={matchingStyles.filters}><label>Párování<Choice name="Typ bankovní položky"/></label></div>
<label className="payment-assignment-choice">Přiřazení platby<Choice name="Bankovní platba"/></label>
<div className="rule-controls"><Choice name="Pravidlo upomínky"/></div>
<div className="member-add"><Choice name="Role člena"/></div>
<label>Samostatné pole<Choice name="Samostatné pole"/></label>
<label>Více hodnot<select multiple aria-label="Více hodnot" defaultValue={['one']}><option value="one">První</option><option value="two">Druhá</option></select></label>
<label>Seznam<select size={4} aria-label="Viditelný seznam"><option>První</option><option>Druhá</option></select></label>
</section>}
function Demo(){const[expanded,setExpanded]=useState(false),[modal,setModal]=useState(false),[picker,setPicker]=useState(false),[active,setActive]=useState(0);const{showToast}=useToast();return <main style={{maxWidth:700,padding:20,margin:'0 auto',display:'grid',gap:24}}>
<PopupFitter/><h1>Kontrola šipek a zavírání</h1><div data-filter-icons style={{display:"flex",gap:12}}><button aria-label="Filtr společná komponenta" style={{width:44,height:44,display:"grid",placeItems:"center"}}><FilterIcon/></button><button aria-label="Filtr knihovna ikon" style={{width:44,height:44,display:"grid",placeItems:"center"}}><Icon name="filter"/></button></div>
<details data-native><summary style={{display:'flex',alignItems:'center',gap:12,minHeight:44,padding:'8px 14px',border:'1px solid #ccd8d0',borderRadius:8,listStyle:'none',cursor:'pointer'}}>Exportovat<ChevronDown/></summary><p>Otevřená nabídka</p></details>
<button data-controlled aria-expanded={expanded} onClick={()=>setExpanded(!expanded)} style={{display:'flex',alignItems:'center',justifyContent:'space-between',padding:12,minHeight:44}}>Další možnosti<ChevronDown/></button>
<MobileDisclosure label="Mobilní filtry"><p>Obsah filtrů</p></MobileDisclosure>
<div style={{display:'flex'}}><OcrDocumentPicker documents={[{name:'První.pdf',status:'ready'},{name:'Druhá.pdf',status:'ready'}]} activeIndex={active} onSelect={setActive}/></div>
<div><MatchingDropdown label="Přiřadit fakturu" open={picker} onOpenChange={setPicker} trigger={<>Vyberte fakturu<ChevronDown/></>}>{close=><button onClick={close}>Vybrat připravenou fakturu</button>}</MatchingDropdown></div>
<button onClick={()=>setModal(true)}>Otevřít dialog</button><Modal open={modal} onClose={()=>setModal(false)} labelledBy="test-dialog-title"><header><h2 id="test-dialog-title">Testovací dialog</h2><button aria-label="Zavřít dialog" onClick={()=>setModal(false)}><CloseIcon/></button></header><p style={{padding:20}}>Skutečný sdílený dialog s ovládáním klávesnicí.</p></Modal>
<div style={{display:'flex',gap:20,alignItems:'center'}}><button data-circle aria-label="Kulatý křížek" style={{width:20,height:20,borderRadius:'50%',border:'1px solid #ccd8d0'}}><CloseIcon width="14" height="14"/></button><button data-square aria-label="Čtvercový křížek" style={{width:36,height:36,borderRadius:8,border:'1px solid #ccd8d0'}}><CloseIcon/></button><button onClick={()=>showToast({variant:'error',message:'Testovací oznámení'})}>Ukázat oznámení</button></div>
<NativeChoices/></main>};createRoot(document.getElementById('root')).render(<ToastProvider><Demo/></ToastProvider>);`,
);
const require = createRequire(import.meta.url),
  vr = createRequire(require.resolve("vitest/config"));
const { createServer } = await import(pathToFileURL(vr.resolve("vite")).href);
const server = await createServer({
  configFile: false,
  root: fixture,
  publicDir: resolve("public"),
  logLevel: "error",
  server: {
    host: "127.0.0.1",
    port: 4353,
    strictPort: true,
    fs: { allow: [project] },
  },
  esbuild: { jsx: "automatic" },
  css: { postcss: { plugins: [] } },
  resolve: {
    alias: [{ find: "@", replacement: resolve("src") }],
    dedupe: ["react", "react-dom"],
  },
});
await server.listen();
const browser = await chromium.launch();
const results = [];
async function clickIcon(page, icon) {
  await icon.scrollIntoViewIfNeeded();
  const r = await icon.boundingBox();
  await page.mouse.click(r.x + r.width / 2, r.y + r.height / 2);
}
async function centered(parent, selector, both = false) {
  const delta = await parent.evaluate(
    (element, { selector, both }) => {
      const r = element.getBoundingClientRect(),
        i = element.querySelector(selector).getBoundingClientRect();
      return Math.max(
        Math.abs(r.top + r.height / 2 - i.top - i.height / 2),
        both ? Math.abs(r.left + r.width / 2 - i.left - i.width / 2) : 0,
      );
    },
    { selector, both },
  );
  expect(delta).toBeLessThan(1.1);
}
async function rotation(icon, open) {
  await expect
    .poll(() =>
      icon.evaluate((element) => {
        const value = getComputedStyle(element).transform;
        return value === "none" ? 1 : new DOMMatrix(value).a;
      }),
    )
    .toBeCloseTo(open ? -1 : 1, 2);
}
try {
  for (const [width, height, reduced] of [
    [1536, 1024, false],
    [390, 844, false],
    [320, 568, false],
    [390, 844, true],
  ]) {
    const page = await browser.newPage({
        viewport: { width, height },
        reducedMotion: reduced ? "reduce" : "no-preference",
      }),
      errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    try {
      await page.goto("http://127.0.0.1:4353");
      const native = page.locator("[data-native] > summary"),
        arrow = native.locator(".ui-chevron");
      await centered(native, ".ui-chevron");
      await rotation(arrow, false);
      expect(
        await arrow.evaluate((el) => getComputedStyle(el).transitionDuration),
      ).toBe(reduced ? "0s" : "0.18s");
      await clickIcon(page, arrow);
      await rotation(arrow, true);
      await centered(native, ".ui-chevron");
      await native.press("Space");
      await rotation(arrow, false);
      const controlled = page.locator("[data-controlled]");
      await clickIcon(page, controlled.locator(".ui-chevron"));
      await expect(controlled).toHaveAttribute("aria-expanded", "true");
      await rotation(controlled.locator(".ui-chevron"), true);
      await controlled.click();
      await rotation(controlled.locator(".ui-chevron"), false);
      const ocr = page.getByLabel("Vybrat fakturu", { exact: true });
      await centered(ocr, ".ui-chevron");
      await clickIcon(page, ocr.locator(".ui-chevron"));
      await rotation(ocr.locator(".ui-chevron"), true);
      await page.getByRole("button", { name: /Druhá.pdf/ }).click();
      await rotation(ocr.locator(".ui-chevron"), false);
      if (width < 768) {
        const mobile = page.getByRole("button", {
          name: "Mobilní filtry",
          exact: true,
        });
        await centered(mobile, ".ui-chevron");
        await clickIcon(page, mobile.locator(".ui-chevron"));
        await expect(mobile).toHaveAttribute("aria-expanded", "true");
        await rotation(mobile.locator(".ui-chevron"), true);
        await mobile.click();
      }
      const match = page.getByRole("button", {
        name: "Přiřadit fakturu",
        exact: true,
      });
      await centered(match, ".ui-chevron");
      await clickIcon(page, match.locator(".ui-chevron"));
      await rotation(match.locator(".ui-chevron"), true);
      const dropdown = page.getByRole("region", { name: "Přiřadit fakturu" }),
        dropdownClose = dropdown.getByRole("button", {
          name: "Zavřít",
          exact: true,
        });
      await centered(dropdownClose, ".ui-close-icon", true);
      await clickIcon(page, dropdownClose.locator(".ui-close-icon"));
      await expect(dropdown).toHaveCount(0);
      await rotation(match.locator(".ui-chevron"), false);
      await page
        .getByRole("button", { name: "Otevřít dialog", exact: true })
        .click();
      const dialog = page.getByRole("dialog", { name: "Testovací dialog" }),
        close = dialog.getByRole("button", {
          name: "Zavřít dialog",
          exact: true,
        });
      await centered(close, ".ui-close-icon", true);
      await clickIcon(page, close.locator(".ui-close-icon"));
      await expect(dialog).toHaveCount(0);
      await centered(page.locator("[data-circle]"), ".ui-close-icon", true);
      await centered(page.locator("[data-square]"), ".ui-close-icon", true);
      await page.getByRole("button", { name: "Ukázat oznámení" }).click();
      const toastClose = page.getByRole("button", { name: "Zavřít oznámení" });
      await centered(toastClose, ".ui-close-icon", true);
      await clickIcon(page, toastClose.locator(".ui-close-icon"));
      await expect(toastClose).toHaveCount(0);
      const fields = page.locator(
        "[data-native-selects] select:not([multiple]):not([size])",
      );
      const arrows = await fields.evaluateAll((elements) =>
        elements.map((element) => {
          const style = getComputedStyle(element);
          return {
            label: element.getAttribute("aria-label"),
            image: style.backgroundImage,
            vertical: style.backgroundPositionY,
            size: parseFloat(style.backgroundSize),
            offset:
              parseFloat(style.getPropertyValue("--select-chevron-offset")) ||
              0,
            padding: parseFloat(style.paddingRight),
            appearance: style.appearance,
          };
        }),
      );
      expect(arrows).toHaveLength(14);
      for (const arrow of arrows) {
        expect(arrow.image, arrow.label).toContain("data:image/svg+xml");
        expect(arrow.vertical, arrow.label).toBe("50%");
        expect(arrow.appearance, arrow.label).toBe("none");
        expect(arrow.padding, arrow.label).toBeGreaterThanOrEqual(
          arrow.offset + arrow.size + 4,
        );
      }
      expect(
        arrows.find((field) => field.label === "Měna faktury").offset,
      ).toBe(36);
      for (const select of await fields.all()) {
        if (await select.isEnabled()) {
          await select.selectOption("two");
          await expect(select).toHaveValue("two");
        }
      }
      for (const label of ["Více hodnot", "Viditelný seznam"])
        expect(
          await page
            .getByLabel(label, { exact: true })
            .evaluate((element) => getComputedStyle(element).backgroundImage),
        ).toBe("none");
      const filterIcons = await page.locator('[data-filter-icons] svg').evaluateAll(nodes => nodes.map(svg => ({
        glyph: svg.innerHTML, stroke: getComputedStyle(svg).strokeWidth,
        width: svg.getBoundingClientRect().width, height: svg.getBoundingClientRect().height,
      })));
      expect(filterIcons).toHaveLength(2);
      expect(filterIcons[0]).toEqual(filterIcons[1]);
      expect(filterIcons[0].stroke).toBe("2px");
      for (const button of await page.locator('[data-filter-icons] button').all()) await centered(button, '.ui-filter-icon', true);
      expect(errors).toEqual([]);
      await page.screenshot({
        path: resolve(
          output,
          `controls-${width}-${reduced ? "reduced" : "animated"}.png`,
        ),
        fullPage: true,
      });
      results.push({ width, height, reduced, passed: true });
      console.log("PASS controls " + width + " reduced=" + reduced);
    } finally {
      await page.close();
    }
  }
} finally {
  await browser.close();
  await server.close();
  await writeFile(
    resolve(output, "validation.json"),
    JSON.stringify(
      {
        scope:
          "Actual native selects with report/dashboard/settings/onboarding/invoice/OCR/matching/member/rule styles plus shared icons, native details, aria-expanded button, MobileDisclosure, OCR picker, MatchingDropdown, Modal and Toast; no external data or mutations",
        results,
      },
      null,
      2,
    ),
  );
}
