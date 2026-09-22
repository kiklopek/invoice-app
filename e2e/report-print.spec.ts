import { expect, test } from "@playwright/test";
import { requireWorkspaceSession } from "./session";

// Tenhle spec se roky přeskakoval (chyběla session), takže zestárl: hledal
// `.donut` a `.debtor-table`, které z aplikace zmizely při přechodu na
// segmentované pruhy. `report-print.test.ts` dokonce výslovně vyžaduje,
// aby donut v kódu NEBYL. Test byl proto přepsaný na to, co se tiskne dnes.
test("tištěný report si zachová graf i čitelnou tabulku", async ({ page }) => {
  await page.goto("/reports");
  if (await requireWorkspaceSession(page, "tisk reportu")) return;

  // Graf stavu faktur žije v záložce Pohledávky; výchozí jsou Tržby.
  // Všechny panely zůstávají v DOM (kvůli tisku), takže bez přepnutí by
  // byl prvek sice přítomný, ale skrytý.
  await page.getByRole("tab", { name: "Pohledávky" }).click();
  const segmented = page.locator(".report-segmented-bar").first();
  await expect(segmented).toBeVisible();

  await page.emulateMedia({ media: "print" });

  // Po přepnutí na tisk musí graf zůstat viditelný -- dřív se stávalo, že
  // ho print pravidla schovala spolu s dekoracemi.
  await expect(segmented).toBeVisible();

  // Hlavička účetní tabulky musí mít při tisku viditelný rámeček a barvu
  // textu; bez toho vyjde tabulka na papíře jako beztvarý blok.
  const header = page.locator(".report-accounting-table thead th").first();
  // Tabulka dlužníků je ve stejné záložce.
  await expect(header).toBeVisible();
  const printStyles = await header.evaluate((element) => {
    const style = getComputedStyle(element);
    return { borderWidth: style.borderBottomWidth, color: style.color };
  });
  expect(Number.parseFloat(printStyles.borderWidth)).toBeGreaterThan(0);
  expect(printStyles.color).not.toBe("rgba(0, 0, 0, 0)");
});

test("tisk nezahodí neaktivní záložky reportu", async ({ page }) => {
  await page.goto("/reports");
  if (await requireWorkspaceSession(page, "tisk všech záložek")) return;

  await page.emulateMedia({ media: "print" });
  // Všechny čtyři panely zůstávají v DOM a při tisku se zobrazí -- jinak by
  // se vytiskla jen ta záložka, kterou měl uživatel zrovna otevřenou.
  const panels = page.locator(".report-tab-panel");
  expect(await panels.count()).toBeGreaterThanOrEqual(4);
});
