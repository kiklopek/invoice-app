// @vitest-environment jsdom
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { OcrProcessingView, processingPresentation, type DocumentStage } from "./ocr-processing-view";

const documents = [
  { file: { name: "prvni.pdf" }, status: "saved" as const },
  { file: { name: "druha.pdf" }, status: "processing" as const },
  { file: { name: "treti.pdf" }, status: "pending" as const },
];
afterEach(() => vi.unstubAllGlobals());

describe("OCR processing presentation", () => {
  it.each<[DocumentStage, number]>([["idle", 0], ["uploading", 0], ["verifying", 0], ["reading", 1], ["recognizing", 1], ["prefilling", 2]])("maps %s to the available phase without inventing backend stages", (stage, phase) => {
    expect(processingPresentation(stage, documents)).toMatchObject({ phase, completed: 1, current: "druha.pdf", failed: 0 });
  });
  it("counts completed processing separately from user confirmation and includes failed attempts", () => {
    expect(processingPresentation("reading", [
      { file: { name: "ocr.pdf" }, status: "ready" },
      { file: { name: "manual.pdf" }, status: "ready", error: "OCR se nezdařilo" },
      { file: { name: "failed.pdf" }, status: "error", error: "Chyba nahrání" },
      ...documents,
    ])).toMatchObject({ completed: 4, failed: 2 });
  });
  it("retains the stop action and indeterminate progress without a document disclosure", async () => {
    vi.stubGlobal("React", React);
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    const container = document.createElement("div");
    const root = createRoot(container);
    const onStop = vi.fn();
    try {
      await act(async () => root.render(<OcrProcessingView stage="reading" documents={[
        ...documents, { file: { name: "chyba.pdf" }, status: "error", error: "Nepodporovaný dokument" },
      ]} canStop onStop={onStop}/>));
      expect(container.querySelector('[role="progressbar"]')?.hasAttribute("aria-valuenow")).toBe(false);
      expect(container.querySelector('[role="progressbar"]')?.getAttribute("aria-valuetext")).toContain("Zpracováno 2 z 4");
      expect(container.querySelector("details, summary")).toBeNull();
      expect(container.textContent).not.toContain("Zobrazit dokumenty");
      expect(container.querySelector('li[aria-current="step"] strong')?.textContent).toBe("Rozpoznávání textu pomocí OCR");
      await act(async () => Array.from(container.querySelectorAll("button")).find(button => button.textContent === "Zastavit zpracování")!.click());
      expect(onStop).toHaveBeenCalledOnce();

    } finally {
      await act(async () => root.unmount());
    }
  });
});
