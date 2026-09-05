import { AppFrame } from "@/components/layout/app-shell";

export default function WorkspaceLoading() {
  return <AppFrame><div role="status" aria-live="polite"><span className="import-progress-spinner" aria-hidden="true" /> Načítám stránku…</div></AppFrame>;
}
