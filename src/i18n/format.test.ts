import { describe, expect, it } from "vitest";
import { formatCzk, formatDate, formatNumber } from "./format";

// Mezery v českém formátu jsou nezlomitelné (U+00A0), proto se porovnává
// po jejich převedení na obyčejné.
const plain = (value: string) => value.replace(/ /g, " ");

describe("formátování veřejné části", () => {
  it("čísla podle jazyka", () => {
    expect(plain(formatNumber("cs", 1340000))).toBe("1 340 000");
    expect(formatNumber("en", 1340000)).toBe("1,340,000");
  });

  it("koruny: česky za číslem, anglicky kód měny před číslem", () => {
    expect(plain(formatCzk("cs", 1590))).toBe("1 590 Kč");
    expect(formatCzk("en", 1590)).toBe("CZK 1,590");
  });

  it("datum bez času", () => {
    expect(formatDate("cs", "2026-03-12T10:00:00")).toBe("12. 3. 2026");
    expect(formatDate("en", "2026-03-12T10:00:00")).toBe("12 Mar 2026");
    expect(formatDate("en", "2026-03-12T10:00:00", { short: true })).toBe("12 Mar");
    expect(formatDate("cs", "2026-03-12T10:00:00", { short: true })).toBe("12. 3. 2026");
  });
});
