export type AutomationRunStatus = "running" | "succeeded" | "partial" | "failed";

export type AutomationRunCounters = {
  checked: number;
  sent: number;
  failed: number;
  skipped: number;
  disabled: number;
  paused: number;
  suppressed: number;
  exhausted: number;
};

export type AutomationRun = AutomationRunCounters & {
  id: string;
  started_at: string;
  finished_at: string | null;
  status: AutomationRunStatus;
  error_message: string | null;
  trigger_source?: "scheduled" | "manual";
  triggered_by_email?: string | null;
};

export const AUTOMATION_RUN_STALE_MINUTES = 90;
export const MANUAL_AUTOMATION_RUN_COOLDOWN_SECONDS = 60;

export function emptyAutomationRunCounters(): AutomationRunCounters {
  return { checked: 0, sent: 0, failed: 0, skipped: 0, disabled: 0, paused: 0, suppressed: 0, exhausted: 0 };
}

export function completedAutomationRunStatus(counters: AutomationRunCounters): Extract<AutomationRunStatus, "succeeded" | "partial"> {
  return counters.failed > 0 ? "partial" : "succeeded";
}

export function isAutomationRunStale(run: Pick<AutomationRun, "status" | "started_at">, now = Date.now()): boolean {
  if (run.status !== "running") return false;
  const startedAt = Date.parse(run.started_at);
  return Number.isFinite(startedAt) && now - startedAt > AUTOMATION_RUN_STALE_MINUTES * 60_000;
}

export function manualAutomationRunBlock(
  run: Pick<AutomationRun, "status" | "started_at"> | null,
  now = Date.now(),
): "running" | "cooldown" | null {
  if (!run) return null;
  if (run.status === "running" && !isAutomationRunStale(run, now)) return "running";
  const startedAt = Date.parse(run.started_at);
  return Number.isFinite(startedAt) && now - startedAt < MANUAL_AUTOMATION_RUN_COOLDOWN_SECONDS * 1000 ? "cooldown" : null;
}
