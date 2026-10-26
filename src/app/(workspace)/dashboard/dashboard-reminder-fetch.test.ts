// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { fetchReminderRead, reminderReadError } from "./dashboard-reminder-fetch";
import { ApiRequestError } from "@/lib/api-client";

afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });
describe("reminder reads", () => {
  it("recovers from a temporary gateway failure with a single GET retry", async () => {
    vi.useFakeTimers();
    const fetch = vi.fn().mockResolvedValueOnce(new Response("{}", { status: 503 }))
      .mockResolvedValueOnce(new Response('{"active":true}'));
    vi.stubGlobal("fetch", fetch);
    const result = fetchReminderRead("/api/settings/reminders");
    await vi.advanceTimersByTimeAsync(1000);
    expect(await result).toEqual({ active: true });
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(fetch.mock.calls.every(([, init]) => !init.method)).toBe(true);
  });
  it("stops after the second transient failure", async () => {
    vi.useFakeTimers();
    const fetch = vi.fn(async () => new Response("{}", { status: 503 }));
    vi.stubGlobal("fetch", fetch);
    const result = expect(fetchReminderRead("/api/settings/reminders")).rejects.toMatchObject({ status: 503 });
    await vi.advanceTimersByTimeAsync(1000);
    await result;
    expect(fetch).toHaveBeenCalledTimes(2);
  });
  it("does not retry forbidden or server data errors", async () => {
    const fetch = vi.fn(async () => new Response("{}", { status: 403 }));
    vi.stubGlobal("fetch", fetch);
    await expect(fetchReminderRead("/api/settings/reminders")).rejects.toMatchObject({ status: 403 });
    expect(fetch).toHaveBeenCalledTimes(1);
  });
  it("keeps the actual failure and request identifier available for diagnosis", () => {
    expect(reminderReadError(new ApiRequestError("Nastavení se nepodařilo načíst.",500,"read_failed","request-123")))
      .toContain("500 · request-123");
    expect(reminderReadError(new ApiRequestError("Timeout",408,"timeout"))).toContain("příliš dlouho");
  });
});
