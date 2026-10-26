import { ImportProcessingView } from "@/components/import-processing-view";

export type DocumentStage = "idle" | "uploading" | "verifying" | "reading" | "recognizing" | "prefilling";
type ProcessingDocument = {
  file: { name: string };
  status: "pending" | "processing" | "ready" | "saved" | "error";
  error?: string;
};

// The extraction request is opaque: reading/recognizing are one honest phase.
// Only a returned response allows us to show preparation as the active phase.
export function processingPresentation(stage: DocumentStage, documents: ProcessingDocument[]) {
  const phase = stage === "prefilling" ? 2 : stage === "reading" || stage === "recognizing" ? 1 : 0;
  return {
    phase,
    completed: documents.filter(item => ["ready", "saved", "error"].includes(item.status)).length,
    failed: documents.filter(item => Boolean(item.error) || item.status === "error").length,
    current: documents.find(item => item.status === "processing")?.file.name,
    description: phase === 0 ? "Načítáme a ověřujeme vaše dokumenty…" : phase === 1
      ? "Čteme dokument a rozpoznáváme údaje z faktury…" : "Připravujeme rozpoznané údaje ke kontrole…",
  };
}

export function OcrProcessingView({ stage, documents, canStop, onStop }: {
  stage: DocumentStage;
  documents: ProcessingDocument[];
  canStop: boolean;
  onStop: () => void;
}) {
  const state = processingPresentation(stage, documents);
  const titles = ["Načtení souborů", "Rozpoznávání textu pomocí OCR", "Příprava ke kontrole"];
  const details = ["Nahráváme dokument a ověřujeme jeho formát.", "Extrahujeme důležité údaje z faktury…", "Připravujeme formulář pro kontrolu rozpoznaných údajů…"];
  const count = `Zpracováno ${state.completed} z ${documents.length} ${documents.length === 1 ? "dokumentu" : "dokumentů"}`;
  return <ImportProcessingView kind="ocr" title="Zpracováváme vaše dokumenty"
    description={state.description} phase={state.phase}
    stages={titles.map((title, index) => ({ title, detail: details[index] }))}
    count={count} progressLabel="Zpracování dokumentů"
    progressText={`${count}. Probíhá zpracování dokumentu.`}
    stagesLabel="Fáze zpracování aktuálního dokumentu"
    totalLabel={documents.length === 1 ? "1 dokument" : `${documents.length} dokumentů`}
    notice="Po dokončení budete moci zkontrolovat rozpoznané údaje a případně je upravit."
    onStop={canStop ? onStop : undefined}
    stopNote="Zastavení ponechá dokončené dokumenty. Právě zpracovávaný dokument se dokončí."
  />;
}
