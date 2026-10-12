import { describe, expect, it } from "vitest";
import { hasCachedData } from "./revalidate-on-revisit";

// Stránka s daty ze serveru (fallbackData) je při první návštěvě čerstvá --
// znovu ji načíst hned po vykreslení je zbytečný druhý dotaz. Při návratu
// ale sdílená SWR cache drží data z dřívější návštěvy a ta mají přednost před
// fallbackData, takže tam se znovu načíst musí (jinak by se ukázal starý stav).
describe("znovu načíst jen při návratu na stránku", () => {
  const cache = new Map<string, { data?: unknown }>([
    ["/api/dashboard", { data: { total: 1 } }],
    ["/api/customers", { data: undefined }],
  ]);

  it("návrat (v cache už jsou data) -> znovu načíst", () => {
    expect(hasCachedData(cache, "/api/dashboard")).toBe(true);
  });

  it("první návštěva (v cache nic) -> stačí data ze serveru", () => {
    expect(hasCachedData(cache, "/api/invoices?page=1")).toBe(false);
    expect(hasCachedData(cache, "/api/customers")).toBe(false);
  });

  it("bez klíče nic", () => {
    expect(hasCachedData(cache, null)).toBe(false);
  });
});
