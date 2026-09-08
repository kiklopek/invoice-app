import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const source = (path: string) => readFileSync(join(process.cwd(), path), "utf8");
const route = source("src/app/api/cron/check-due/route.ts");
const migration = source("supabase/migrations/20260908160937_optimize_reminder_queue.sql");
const vercel = source("vercel.json");

describe("durable reminder queue optimization", () => {
  it("plans only invoices whose indexed next reminder is due", () => {
    expect(route).toContain('.lte("next_reminder_at", startedAt)');
    expect(route).toContain('.order("next_reminder_at", { ascending: true })');
    expect(route).toContain("PLANNER_INVOICE_LIMIT = 1000");
    expect(route).toContain("Dávkové načtení historie upomínek");
  });

  it("claims a bounded queue batch without blocking concurrent workers", () => {
    expect(migration.toLowerCase()).toContain("for update skip locked");
    expect(migration).toContain("least(greatest(target_limit, 1), 25)");
    expect(route).toContain("WORKER_BATCH_LIMIT = 25");
    expect(route).toContain("WORKER_MAX_RUNTIME_MS = 45_000");
    expect(route).toContain("release_claimed_reminder_jobs");
  });

  it("keeps the queue durable and records phase metrics", () => {
    for (const column of ["available_at", "lease_token", "lease_expires_at", "queued", "processed", "remaining", "planner_duration_ms", "worker_duration_ms"]) {
      expect(migration).toContain(column);
    }
    expect(route).toContain("complete_claimed_reminder_send");
    expect(route).toContain("fail_claimed_reminder_job");
    expect(route).toContain('idempotencyKey: `reminder-${job.id}`');
  });

  it("uses a daily schedule supported by Vercel Hobby", () => {
    expect(JSON.parse(vercel).crons).toContainEqual({ path: "/api/cron/check-due", schedule: "0 6 * * *" });
  });
});
