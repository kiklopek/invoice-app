import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const source = (path: string) => readFileSync(join(process.cwd(), path), "utf8");
const compact = (path: string) => source(path).replace(/\s+/g, " ");

describe("rychlost přihlášené aplikace", () => {
  it("layout načte firmu a předplatné souběžně", () => {
    // Za sebou to byla dvě kola do databáze před každým vykreslením aplikace.
    const layout = compact("src/app/(workspace)/layout.tsx");
    expect(layout).toMatch(/await Promise\.all\(\[ identity\.service\.from\("organizations"\)[^\]]*loadSubscription\(/);
  });

  it("návrat na záložku prohlížeče načítá data nejvýš jednou za minutu", () => {
    expect(source("src/components/workspace-data-provider.tsx")).toContain("focusThrottleInterval: 60_000");
  });

  it("exceljs se načítá až při exportu, ne s každou API routou", () => {
    const exportLib = source("src/lib/excel-export.ts");
    // `import type` se při kompilaci vymaže; nesmí zůstat běžný import.
    expect(exportLib).not.toMatch(/^import (?!type )[^;]*from "exceljs";/m);
    expect(exportLib).toContain('await import("exceljs")');
  });

  it("detail faktury stahuje formulář (s OCR) až při úpravě", () => {
    const detail = source("src/app/(workspace)/invoices/[id]/invoice-detail-client.tsx");
    expect(detail).not.toMatch(/^import \{ InvoiceForm \}/m);
    expect(detail).toContain("dynamic(");
  });
});
