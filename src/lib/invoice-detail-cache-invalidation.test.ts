import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// Dashboard, Reporty a další už navštívené stránky sdílejí jednu SWR cache
// (WorkspaceDataProvider), která ignoruje fallbackData ze serveru, když pro
// klíč už něco má v paměti. Bez explicitní invalidace by po smazání faktury,
// změně jejího stavu nebo uvolnění platby zůstaly na starých číslech, dokud
// se okno neztratilo a znovu nezískalo fokus.
//
// Test hlídá, že se invalidateWorkspaceData() volá po každé z těchto tří
// mutací -- ne že existuje jen jednou někde v souboru.

const source = readFileSync(
  join(process.cwd(), "src", "app", "(workspace)", "invoices", "[id]", "invoice-detail-client.tsx"),
  "utf8",
);

describe("invalidace sdílené cache po mutacích faktury", () => {
  it("importuje useInvalidateWorkspaceData a volá hook v komponentě", () => {
    expect(source).toContain('from "@/lib/workspace-cache"');
    expect(source).toContain("const invalidateWorkspaceData = useInvalidateWorkspaceData();");
  });

  it("volá se po smazání faktury", () => {
    const deleteFn = source.slice(source.indexOf("async function deleteInvoice"), source.indexOf("async function deleteInvoice") + 800);
    expect(deleteFn).toContain("invalidateWorkspaceData()");
  });

  it("volá se po každé změně stavu/úhrady přes patch()", () => {
    const patchFn = source.slice(source.indexOf("async function patch("), source.indexOf("async function changeStatus"));
    expect(patchFn).toContain("invalidateWorkspaceData()");
  });

  it("volá se po uvolnění platby, protože to taky mění zbývající zůstatek", () => {
    const unassignFn = source.slice(source.indexOf("async function unassignPayment"), source.indexOf("async function deleteInvoice"));
    expect(unassignFn).toContain("invalidateWorkspaceData()");
  });
});

// Tester: po přidání faktury ukazoval seznam a přehled staré údaje až do
// cmd+R. Vytvoření faktury musí invalidovat sdílenou cache i router cache,
// listy se při návratu musí znovu načíst a postranní menu nesmí vynucovat
// 5minutový prefetch cache.
function read(...parts: string[]) {
  return readFileSync(join(process.cwd(), "src", ...parts), "utf8");
}

describe("čerstvá data po vytvoření faktury", () => {
  const importPage = read("app", "(workspace)", "invoices", "import", "page.tsx");
  const newPage = read("app", "(workspace)", "invoices", "new", "page.tsx");

  it("import: create() invaliduje cache a obnoví router", () => {
    expect(importPage).toContain("const invalidateWorkspaceData = useInvalidateWorkspaceData();");
    const start = importPage.indexOf("async function create(");
    const fn = importPage.slice(start, importPage.indexOf("async function loadCsv"));
    expect(fn).toContain("invalidateWorkspaceData()");
    expect(fn).toContain("router.refresh()");
  });

  it("import: importCsv() invaliduje cache a obnoví router", () => {
    const fn = importPage.slice(importPage.indexOf("async function importCsv"), importPage.indexOf("return <AppFrame>"));
    expect(fn).toContain("invalidateWorkspaceData()");
    expect(fn).toContain("router.refresh()");
  });

  it("ruční zadání invaliduje cache a obnoví router", () => {
    expect(newPage).toContain("const invalidateWorkspaceData = useInvalidateWorkspaceData();");
    expect(newPage).toContain("invalidateWorkspaceData()");
    expect(newPage).toContain("router.refresh()");
  });

  it("dashboard a seznam faktur se při připojení znovu načtou", () => {
    expect(read("app", "(workspace)", "dashboard", "dashboard-client.tsx")).not.toContain("revalidateOnMount: false");
    expect(read("app", "(workspace)", "invoices", "invoices-client.tsx")).not.toContain("revalidateOnMount: listKey !== initialKey");
  });

  it("odkazy v postranním menu nevynucují prefetch={true}", () => {
    expect(read("components", "layout", "app-shell.tsx")).not.toContain("prefetch={true}");
  });
});
