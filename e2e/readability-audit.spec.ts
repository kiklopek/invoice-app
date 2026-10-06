import { expect, test } from "@playwright/test";
import { writeFileSync } from "node:fs";
import { requireWorkspaceSession } from "./session";

// Čitelnost a ovladatelnost měřená na vykreslené stránce, ne v textu CSS.
//
// V CSS je přes dvě stě deklarací font-size pod 12 px, jenže většinu z nich
// přebíjí pozdější typografická vrstva -- z textu souboru se nedá poznat, co
// uživatel opravdu vidí. Tenhle spec čte computed style viditelných prvků:
//
//   1. text menší než 12 px,
//   2. pole formuláře pod 16 px na dotykovém zařízení (iOS Safari při
//      zaostření takového pole přiblíží celou stránku),
//   3. dotykové plochy menší než 44 × 44 px na dotykovém zařízení.
const PAGES = [
  "/dashboard", "/invoices", "/invoices/new", "/invoices/import",
  "/invoices/payments", "/invoices/archive", "/customers", "/reports",
  "/reminders", "/settings",
];

const MIN_TEXT_PX = 12;
const MIN_TOUCH_INPUT_PX = 16;
const MIN_TOUCH_TARGET_PX = 44;

test.describe("čitelnost a dotykové plochy", () => {
  for (const path of PAGES) {
    test(`${path} nemá nečitelný text ani malé ovládání`, async ({ page }, testInfo) => {
      test.skip(testInfo.project.name === "desktop-safari", "Měří se v Chromiu");
      await page.goto(path);
      if (await requireWorkspaceSession(page, `čitelnost ${path}`)) return;
      await page.waitForLoadState("networkidle");

      const touch = Boolean(testInfo.project.use.hasTouch);
      const problems = await page.evaluate(({ minText, minInput, minTarget, touch }) => {
        const found: string[] = [];
        const describe = (element: Element) => {
          const cls = typeof element.className === "string" && element.className ? `.${element.className.trim().split(/\s+/).join(".")}` : "";
          const text = (element.textContent || element.getAttribute("aria-label") || "").trim().replace(/\s+/g, " ").slice(0, 30);
          return `${element.tagName.toLowerCase()}${cls} „${text}“`;
        };
        const visible = (element: Element) => {
          const rect = element.getBoundingClientRect();
          const style = getComputedStyle(element);
          return rect.width > 0 && rect.height > 0 && style.visibility !== "hidden" && style.display !== "none" && Number(style.opacity) > 0;
        };
        const seen = new Set<string>();
        const add = (message: string) => { if (!seen.has(message)) { seen.add(message); found.push(message); } };

        // Text: jen prvky, které samy nesou neprázdný textový uzel.
        for (const element of document.body.querySelectorAll("*")) {
          if (element.closest("svg, [aria-hidden='true'], .sr-only, .visually-hidden")) continue;
          const ownText = [...element.childNodes].some((node) => node.nodeType === Node.TEXT_NODE && node.textContent?.trim());
          if (!ownText || !visible(element)) continue;
          const size = Number.parseFloat(getComputedStyle(element).fontSize);
          if (size < minText) add(`text ${size}px: ${describe(element)}`);
        }

        if (touch) {
          for (const element of document.querySelectorAll("input:not([type=checkbox]):not([type=radio]):not([type=hidden]):not([type=file]), select, textarea")) {
            if (!visible(element)) continue;
            const size = Number.parseFloat(getComputedStyle(element).fontSize);
            if (size < minInput) add(`pole ${size}px (iOS zoom): ${describe(element)}`);
          }
          for (const element of document.querySelectorAll("button, a[href], [role=button], select, input[type=checkbox], input[type=radio]")) {
            // Skip-link je záměrně mimo obrazovku, dokud na něj nepřejde klávesnice.
            if (!visible(element) || element.closest("p, .skip-link")) continue;
            const rect = element.getBoundingClientRect();
            if (rect.height < minTarget || rect.width < minTarget) add(`dotyk ${Math.round(rect.width)}×${Math.round(rect.height)}: ${describe(element)}`);
          }
        }
        return found;
      }, { minText: MIN_TEXT_PX, minInput: MIN_TOUCH_INPUT_PX, minTarget: MIN_TOUCH_TARGET_PX, touch });

      writeFileSync(testInfo.outputPath("problemy.txt"), problems.join("\n"));
      await testInfo.attach("problemy.txt", { body: problems.join("\n") || "žádné", contentType: "text/plain" });
      expect(problems, problems.slice(0, 40).join("\n")).toEqual([]);
    });
  }
});
