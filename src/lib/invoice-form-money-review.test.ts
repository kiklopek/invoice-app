import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const source = () => readFileSync(join(process.cwd(), "src/components/invoice-form.tsx"), "utf8");

describe("faktura z dokumentu -- pole 'již uhrazené zálohy'", () => {
  it("nezobrazí pole na každém importu z dokumentu, jen když je co řešit", () => {
    // Bug: `(!editing && Boolean(form.file_url))` otevíralo celý
    // invoice-money-review blok na KAŽDÉ nové faktuře založené z dokumentu,
    // i když OCR (lokální i AI) nenašlo žádnou zálohu -- initial_paid zůstal
    // 0 a přesto se ukázalo needitovatelné "Zbývá k úhradě: 0.00 CZK".
    const code = source();
    expect(code).toContain("{(needsAmountReview || detectedPrepayment) && <div className=\"wide invoice-money-review\">");
    expect(code).not.toContain("(!editing && Boolean(form.file_url))");
  });

  it("pole pro zálohy se řídí stejnou podmínkou (detectedPrepayment), ne přítomností souboru", () => {
    const code = source();
    expect(code).toContain("{!editing && detectedPrepayment && <>");
    expect(code).not.toContain("{!editing && Boolean(form.file_url) && <>");
  });
});
