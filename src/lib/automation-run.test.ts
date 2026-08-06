import { describe, expect, it } from "vitest";
import { AUTOMATION_RUN_STALE_MINUTES, completedAutomationRunStatus, emptyAutomationRunCounters, isAutomationRunStale, manualAutomationRunBlock } from "./automation-run";

describe("automation run monitoring", () => {
  it("marks a completed run with failed sends as partial", () => {
    const counters = emptyAutomationRunCounters();
    expect(completedAutomationRunStatus(counters)).toBe("succeeded");
    counters.failed = 1;
    expect(completedAutomationRunStatus(counters)).toBe("partial");
  });

  it("detects only an old unfinished run as stale", () => {
    const now = Date.parse("2026-08-06T12:00:00Z");
    expect(isAutomationRunStale({ status: "running", started_at: new Date(now - (AUTOMATION_RUN_STALE_MINUTES + 1) * 60_000).toISOString() }, now)).toBe(true);
    expect(isAutomationRunStale({ status: "running", started_at: new Date(now - 10 * 60_000).toISOString() }, now)).toBe(false);
    expect(isAutomationRunStale({ status: "succeeded", started_at: "2020-01-01T00:00:00Z" }, now)).toBe(false);
  });

  it("blocks a concurrent or immediately repeated manual run", () => {
    const now = Date.parse("2026-08-06T12:00:00Z");
    expect(manualAutomationRunBlock({ status: "running", started_at: new Date(now - 30_000).toISOString() }, now)).toBe("running");
    expect(manualAutomationRunBlock({ status: "succeeded", started_at: new Date(now - 30_000).toISOString() }, now)).toBe("cooldown");
    expect(manualAutomationRunBlock({ status: "succeeded", started_at: new Date(now - 61_000).toISOString() }, now)).toBeNull();
    expect(manualAutomationRunBlock({ status: "running", started_at: new Date(now - (AUTOMATION_RUN_STALE_MINUTES + 1) * 60_000).toISOString() }, now)).toBeNull();
  });
});
