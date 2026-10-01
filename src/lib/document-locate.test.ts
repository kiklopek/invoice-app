import { describe, expect, it } from "vitest";
import { boundsToPercentStyle, documentHighlightFor, locateKindForField, locateValueInLayout, textItemBounds, type LayoutTextItem } from "./document-locate";

it("neukazuje v PDF místo údaje převzatého z ARES nebo uloženého klienta", () => {
  for (const method of ["ares", "customer"]) {
    expect(documentHighlightFor({ field: "counterparty_email", value: "kontakt@example.cz",
      source: { page: 0, text: "Externí zdroj", method, bounds: null } })).toBeNull();
  }
});

function expectBox(actual: { x: number; y: number; width: number; height: number } | undefined, expected: { x: number; y: number; width: number; height: number }) {
  expect(actual).toBeDefined();
  for (const key of ["x", "y", "width", "height"] as const) expect(actual![key]).toBeCloseTo(expected[key], 6);
}

const item = (text: string, x: number, y: number, width = 0.1, height = 0.02): LayoutTextItem => ({ text, bounds: { x, y, width, height } });

describe("locateValueInLayout – částky", () => {
  const items = [item("Celkem k úhradě", 0.1, 0.8, 0.2), item("123 100,20 Kč", 0.6, 0.8, 0.2), item("5", 0.1, 0.1)];

  it("najde částku v jiném zápisu než hodnota z formuláře", () => {
    for (const value of [123100.2, "123100.20", "123 100,20", "123100,2"]) {
      expectBox(locateValueInLayout(value, "amount", items)?.bounds, { x: 0.6, y: 0.8, width: 0.2, height: 0.02 });
    }
  });
  it("nehádá: jiná částka se nenajde", () => {
    expect(locateValueInLayout(123100.3, "amount", items)).toBeNull();
    expect(locateValueInLayout(23100.2, "amount", items)).toBeNull();
  });
  it("nehledá malá celá čísla, která by sedla kamkoli", () => {
    expect(locateValueInLayout(5, "amount", items)).toBeNull();
  });
  it("spojí částku rozdělenou do více položek textové vrstvy", () => {
    const split = [item("123", 0.5, 0.5, 0.03), item("100,20", 0.54, 0.5, 0.06)];
    expectBox(locateValueInLayout(123100.2, "amount", split)?.bounds, { x: 0.5, y: 0.5, width: 0.1, height: 0.02 });
  });
  it("rozezná i zápis s tečkou jako tisícovým oddělovačem", () => {
    expect(locateValueInLayout(1234.5, "amount", [item("1.234,50", 0.2, 0.2)])).not.toBeNull();
  });
});

describe("locateValueInLayout – data", () => {
  it("najde ISO datum v zápisu 23.9.2026 i 23. 9. 2026", () => {
    expect(locateValueInLayout("2026-09-23", "date", [item("Splatnost 23.9.2026", 0.1, 0.3)])).not.toBeNull();
    expect(locateValueInLayout("2026-09-23", "date", [item("23. 9. 2026", 0.1, 0.3)])).not.toBeNull();
    expect(locateValueInLayout("2026-09-23", "date", [item("2026-09-23", 0.1, 0.3)])).not.toBeNull();
  });
  it("v jednom textovém úseku obkreslí jen datum, ne jeho popisek", () => {
    const text = "Datum splatnosti: 23.9.2026";
    const bounds = locateValueInLayout("2026-09-23", "date", [{ ...item(text, 0.1, 0.3, 0.5), measureText: value => value.length }])?.bounds;
    const start = text.indexOf("23.9.2026");
    expectBox(bounds, { x: 0.1 + 0.5 * start / text.length, y: 0.3, width: 0.5 * "23.9.2026".length / text.length, height: 0.02 });
  });
  it("spojí delší název rozdělený do více úseků", () => {
    const parts = ["WOOD", "&", "PAPER", "a.s."];
    expect(locateValueInLayout("WOOD & PAPER a.s.", "text", parts.map((part, index) => item(part, index * 0.1, 0.4)))).not.toBeNull();
  });
  it("jiné datum se nenajde", () => {
    expect(locateValueInLayout("2026-09-23", "date", [item("24.9.2026", 0.1, 0.3)])).toBeNull();
    expect(locateValueInLayout("2026-09-03", "date", [item("23.9.2026", 0.1, 0.3)])).toBeNull();
  });
  it("u opakovaného data vybere jen místo určené zdrojovým řádkem", () => {
    const repeated = [item("Vystavení 23. 9. 2026", 0.1, 0.2), item("Splatnost 23. 9. 2026", 0.1, 0.4)];
    expect(locateValueInLayout("2026-09-23", "date", repeated)).toBeNull();
    expectBox(locateValueInLayout("2026-09-23", "date", repeated, "Splatnost 23. 9. 2026")?.bounds, repeated[1].bounds);
  });
  it("použije popisek i když PDF rozděluje popisek a hodnotu", () => {
    const split = [item("Vystavení", 0.1, 0.2), item("23. 9. 2026", 0.3, 0.2), item("Splatnost", 0.1, 0.4), item("23. 9. 2026", 0.3, 0.4)];
    expectBox(locateValueInLayout("2026-09-23", "date", split, "Splatnost 23. 9. 2026")?.bounds, split[3].bounds);
  });
  it("box zdrojového řádku použije k výběru hodnoty, ale ne jako zvýraznění", () => {
    const dates = [item("23. 9. 2026", 0.7, 0.2), item("23. 9. 2026", 0.7, 0.5)];
    const lineBox = { x: 0.1, y: 0.48, width: 0.8, height: 0.05 };
    expectBox(locateValueInLayout("2026-09-23", "date", dates, undefined, lineBox)?.bounds, dates[1].bounds);
  });
});

describe("locateValueInLayout – IČO, VS a texty", () => {
  it("najde IČO s mezerami a ne jako část delšího čísla", () => {
    expect(locateValueInLayout("12345678", "ico", [item("IČO: 123 456 78", 0.1, 0.1)])).not.toBeNull();
    expect(locateValueInLayout("12345678", "ico", [item("9912345678", 0.1, 0.1)])).toBeNull();
  });
  it("doplní vedoucí nuly IČO", () => {
    expect(locateValueInLayout("1234567", "ico", [item("IČO 01234567", 0.1, 0.1)])).not.toBeNull();
  });
  it("najde variabilní symbol jako přesnou číselnou řadu", () => {
    expect(locateValueInLayout("426198", "digits", [item("VS: 426198", 0.4, 0.4)])).not.toBeNull();
    expect(locateValueInLayout("42619", "digits", [item("VS: 426198", 0.4, 0.4)])).toBeNull();
  });
  it("najde název bez ohledu na diakritiku, velikost písmen a interpunkci", () => {
    expect(locateValueInLayout("Dvořák s.r.o.", "text", [item("DVORAK, s.r.o.", 0.2, 0.2)])).not.toBeNull();
    expect(locateValueInLayout("Dvořák s.r.o.", "text", [item("Novák s.r.o.", 0.2, 0.2)])).toBeNull();
  });
  it("příliš krátký text nehledá", () => {
    expect(locateValueInLayout("ab", "text", [item("ab", 0.2, 0.2)])).toBeNull();
  });
});

describe("locateKindForField", () => {
  it("mapuje pole formuláře na druh hledání a neumí-li, vrací null", () => {
    expect(locateKindForField("amount")).toBe("amount");
    expect(locateKindForField("due_date")).toBe("date");
    expect(locateKindForField("counterparty_ico")).toBe("ico");
    expect(locateKindForField("variable_symbol")).toBe("digits");
    expect(locateKindForField("invoice_number")).toBe("text");
    expect(locateKindForField("vat_rate")).toBeNull();
    expect(locateKindForField("currency")).toBeNull();
  });
});

describe("boundsToPercentStyle", () => {
  it("převede normalizovaný box na procenta overlaye", () => {
    expect(boundsToPercentStyle({ x: 0.25, y: 0.5, width: 0.5, height: 0.1 })).toEqual({ left: "25%", top: "50%", width: "50%", height: "10%" });
  });
  it("ořízne box přesahující stránku", () => {
    expect(boundsToPercentStyle({ x: -0.1, y: 0.95, width: 0.5, height: 0.2 })).toEqual({ left: "0%", top: "95%", width: "40%", height: "5%" });
  });
});

describe("textItemBounds", () => {
  // Viewport 600x800 px, scale 1, výchozí převrácení osy y (PDF -> obrazovka).
  const upright = { transform: [1, 0, 0, -1, 0, 800], width: 600, height: 800 };
  it("počítá box rovného textu z transformace položky", () => {
    // text na PDF souřadnici (60, 700), výška 10, šířka 120
    const box = textItemBounds([1, 0, 0, 1, 60, 700], 120, 10, upright);
    expect(box.x).toBeCloseTo(0.1);
    expect(box.y).toBeCloseTo(90 / 800);
    expect(box.width).toBeCloseTo(0.2);
    expect(box.height).toBeCloseTo(10 / 800);
  });
  it("počítá box i na stránce otočené o 90°", () => {
    // viewport po otočení: 800x600, text jde shora dolů
    const rotated = { transform: [0, 1, 1, 0, 0, 0], width: 800, height: 600 };
    const box = textItemBounds([1, 0, 0, 1, 100, 200], 120, 10, rotated);
    // v pixelech: počátek (200,100), šířka textu jde po ose y o 120, výška po ose x o 10
    expect(box.x).toBeCloseTo(200 / 800);
    expect(box.y).toBeCloseTo(100 / 600);
    expect(box.width).toBeCloseTo(10 / 800);
    expect(box.height).toBeCloseTo(120 / 600);
  });
  it("respektuje posunutý MediaBox (offset ve viewportu)", () => {
    const shifted = { transform: [1, 0, 0, -1, -50, 750], width: 600, height: 800 };
    const box = textItemBounds([1, 0, 0, 1, 110, 650], 60, 10, shifted);
    expect(box.x).toBeCloseTo(0.1);
    expect(box.y).toBeCloseTo(90 / 800);
  });
  it("umístí rámeček podle skutečného náběhu písma kolem základní čáry", () => {
    const box = textItemBounds([1, 0, 0, 1, 60, 700], 120, 10, upright, 0.8);
    expect(box.y).toBeCloseTo(92 / 800);
    expect(box.height).toBeCloseTo(10 / 800);
  });
});

describe("documentHighlightFor", () => {
  const box = { x: 0.1, y: 0.2, width: 0.3, height: 0.02 };
  const source = { page: 2, text: "Celkem 123 100,20", method: "pdf_text" as const, bounds: box };

  it("použije box zdroje, který hodnotu skutečně přečetl", () => {
    expect(documentHighlightFor({ field: "amount", value: 123100.2, source })).toEqual({ page: 2, bounds: box, method: "pdf_text", text: "Celkem 123 100,20", value: 123100.2, kind: "amount" });
  });
  it("odvozený zdroj nese box řádku JINÉ hodnoty -- nikdy se nekreslí jako její místo", () => {
    const derived = { ...source, method: "derived" as const };
    const result = documentHighlightFor({ field: "amount_without_vat", value: 101736, source: derived });
    expect(result?.bounds).toBeNull();
    expect(result?.kind).toBe("amount");
    expect(result?.value).toBe(101736);
  });
  it("kandidát použije vlastní box, bez něj hledá v textové vrstvě", () => {
    const candidate = { page: 1, text: "VS 426198", value: "426198", method: "pdf_text" as const, bounds: box };
    expect(documentHighlightFor({ field: "variable_symbol", value: "1", candidate })?.bounds).toEqual(box);
    expect(documentHighlightFor({ field: "variable_symbol", value: "1", candidate: { ...candidate, bounds: undefined } })).toMatchObject({ bounds: null, value: "426198", kind: "digits" });
    expect(documentHighlightFor({ field: "variable_symbol", value: "1", candidate: { ...candidate, method: "derived" as const } })?.bounds).toBeNull();
  });
  it("měna se samostatně nezvýrazňuje (její box je řádek částky)", () => {
    expect(documentHighlightFor({ field: "currency", value: "CZK", source })).toBeNull();
    expect(documentHighlightFor({ field: "vat_rate", value: 21, source })).toBeNull();
  });
  it("bez zdroje i kandidáta není co ukázat", () => {
    expect(documentHighlightFor({ field: "amount", value: 1 })).toBeNull();
  });
});
