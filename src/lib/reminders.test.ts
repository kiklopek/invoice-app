import { describe, expect, it } from "vitest";
import {
  buildReminderSchedule,
  decideReminderAction,
  hasReminderAttemptBudget,
  initialNextReminderAt,
  isLatestEligibleReminder,
  MAX_AUTOMATIC_REMINDER_ATTEMPTS,
  todayInTimeZone,
} from "./reminders";

describe("buildReminderSchedule", () => {
  it("omezí automatické pokusy pro jednu fázi upomínky", () => {
    expect(hasReminderAttemptBudget({ id: "a", scheduled_for: "2026-08-01", status: "failed", attempt_count: 2 }, MAX_AUTOMATIC_REMINDER_ATTEMPTS)).toBe(true);
    expect(hasReminderAttemptBudget({ id: "a", scheduled_for: "2026-08-01", status: "failed", attempt_count: 3 }, MAX_AUTOMATIC_REMINDER_ATTEMPTS)).toBe(false);
  });

  it("vytvoří termíny přes hranici měsíce a správné fáze", () => {
    expect(buildReminderSchedule("2026-03-02", [-3, 0, 7, 14])).toEqual([
      { threshold: -3, scheduledFor: "2026-02-27", stage: "before_due" },
      { threshold: 0, scheduledFor: "2026-03-02", stage: "on_due" },
      { threshold: 7, scheduledFor: "2026-03-09", stage: "overdue" },
      { threshold: 14, scheduledFor: "2026-03-16", stage: "escalation" },
    ]);
  });

  it("odstraní duplicitní prahy a jediný kladný práh ponechá jako overdue", () => {
    expect(buildReminderSchedule("2026-01-01", [7, 7])).toEqual([
      { threshold: 7, scheduledFor: "2026-01-08", stage: "overdue" },
    ]);
  });

  it("odmítne kalendářně neplatné datum", () => {
    expect(() => buildReminderSchedule("2026-02-30", [0])).toThrow("Neplatné datum");
  });
});

describe("decideReminderAction", () => {
  const schedule = buildReminderSchedule("2026-08-10", [-3, 0, 7, 14]);

  it("vybere nejnovější splatnou fázi a starší označí jako zastaralé", () => {
    const result = decideReminderAction(schedule, "2026-08-18", []);
    expect(result.candidate?.scheduledFor).toBe("2026-08-17");
    expect(result.obsolete.map(item => item.scheduledFor)).toEqual(["2026-08-07", "2026-08-10"]);
    expect(result.nextFuture?.scheduledFor).toBe("2026-08-24");
  });

  it("opakovaně nabídne neúspěšnou upomínku", () => {
    const result = decideReminderAction(schedule, "2026-08-17", [
      { id: "log", scheduled_for: "2026-08-17", status: "failed" },
    ]);
    expect(result.candidate?.stage).toBe("overdue");
  });

  it("neodešle znovu již odeslanou ani právě zpracovávanou upomínku", () => {
    for (const status of ["sent", "queued"] as const) {
      const result = decideReminderAction(schedule, "2026-08-17", [
        { id: "log", scheduled_for: "2026-08-17", status },
      ]);
      expect(result.candidate).toBeNull();
    }
  });

  it("po vypršení patnáctiminutového zámku obnoví přerušené zpracování", () => {
    const result = decideReminderAction(schedule, "2026-08-17", [{
      id: "log",
      scheduled_for: "2026-08-17",
      status: "queued",
      updated_at: "2026-08-17T09:00:00.000Z",
    }], new Date("2026-08-17T09:16:00.000Z"));
    expect(result.candidate?.scheduledFor).toBe("2026-08-17");
  });

  it("nepřevezme čerstvě zpracovávanou upomínku", () => {
    const result = decideReminderAction(schedule, "2026-08-17", [{
      id: "log",
      scheduled_for: "2026-08-17",
      status: "queued",
      updated_at: "2026-08-17T09:10:00.000Z",
    }], new Date("2026-08-17T09:16:00.000Z"));
    expect(result.candidate).toBeNull();
  });
});

describe("next reminder", () => {
  it("novou starou fakturu naplánuje nejdříve na dnešek, ne do minulosti", () => {
    expect(initialNextReminderAt("2026-07-01", [-3, 0, 7, 14], "2026-08-06")).toBe("2026-08-06");
  });

  it("počítá firemní den v pražské časové zóně", () => {
    expect(todayInTimeZone(new Date("2026-08-05T22:30:00Z"))).toBe("2026-08-06");
  });
});

describe("manual retry", () => {
  const schedule = buildReminderSchedule("2026-08-10", [-3, 0, 7, 14]);

  it("povolí pouze nejnovější aktuálně splatnou fázi", () => {
    expect(isLatestEligibleReminder(schedule, "2026-08-17", "2026-08-17", "overdue")).toBe(true);
    expect(isLatestEligibleReminder(schedule, "2026-08-17", "2026-08-10", "on_due")).toBe(false);
  });

  it("nepovolí budoucí ani chybně označenou fázi", () => {
    expect(isLatestEligibleReminder(schedule, "2026-08-09", "2026-08-10", "on_due")).toBe(false);
    expect(isLatestEligibleReminder(schedule, "2026-08-17", "2026-08-17", "escalation")).toBe(false);
  });
});
