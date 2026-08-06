import { describe, expect, it } from "vitest";
import { createCsv, csvCell } from "./csv";

describe("csvCell", () => {
  it("escapuje uvozovky a blokuje vzorce tabulkových procesorů", () => {
    expect(csvCell('Firma "A"')).toBe('"Firma ""A"""');
    expect(csvCell("=HYPERLINK(\"https://example.test\")")).toBe('"\'=HYPERLINK(""https://example.test"")"');
  });

  it("ponechá číselné hodnoty použitelné pro výpočty", () => {
    expect(csvCell(1234.5)).toBe('"1234.5"');
    expect(createCsv([["Částka"], [1234.5]])).toContain('"1234.5"');
  });
});

