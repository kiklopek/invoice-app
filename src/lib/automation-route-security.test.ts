import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const route = readFileSync(join(process.cwd(), "src", "app", "api", "cron", "check-due", "route.ts"), "utf8");
const schema = readFileSync(join(process.cwd(), "supabase", "schema.sql"), "utf8");
const migration = readFileSync(join(process.cwd(), "supabase", "migrations", "2026080617_single_automation_run.sql"), "utf8");

describe("manual reminder automation security", () => {
  it("requires same-origin authentication and an accounting role", () => {
    expect(route).toContain("export async function POST(request: Request)");
    expect(route).toContain("isSameOriginMutation(request)");
    expect(route).toContain("await getRequestIdentity()");
    expect(route).toContain("canManageInvoices(identity.membership.role)");
  });

  it("scopes a manual execution to the authenticated organization", () => {
    expect(route).toContain("executeReminderAutomation(identity.membership.organization_id,");
    expect(route).toContain('organizationsQuery.eq("id", targetOrganizationId)');
    expect(route.match(/\.in\("organization_id", startedOrganizationIds\)/g)).toHaveLength(4);
    expect(route).toContain('db.from("invoice_uploads").select("id, path")');
    expect(route).toContain('db.from("invoices").select("id, file_url")');
  });

  it("prevents two running workers for the same organization", () => {
    for (const source of [schema, migration]) {
      expect(source).toContain("reminder_automation_runs_one_running_per_org");
      expect(source).toContain("where status = 'running'");
    }
    expect(route).toContain('startError?.code === "23505"');
    expect(route).toContain("AUTOMATION_RUN_STALE_MINUTES");
    expect(route).toContain("if (targetOrganizationId) return NextResponse.json");
    expect(route).toContain("busyOrganizations++");
    expect(route).toContain("continue;");
  });

  it("records whether a run was scheduled or started by a user", () => {
    for (const source of [schema, migration]) {
      expect(source).toContain("trigger_source");
      expect(source).toContain("triggered_by_email");
    }
    expect(route).toContain('trigger_source: manualTrigger ? "manual" : "scheduled"');
    expect(route).toContain("triggered_by: manualTrigger?.userId");
  });
});
