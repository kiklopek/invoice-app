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
