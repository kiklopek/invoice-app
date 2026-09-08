import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const source = (path: string) => readFileSync(join(process.cwd(), path), "utf8");

describe("workspace navigation performance", () => {
  it("loads initial workspace data in Server Components", () => {
    for (const path of [
      "src/app/(workspace)/dashboard/page.tsx",
      "src/app/(workspace)/invoices/page.tsx",
      "src/app/(workspace)/invoices/[id]/page.tsx",
      "src/app/(workspace)/reports/page.tsx",
      "src/app/(workspace)/reminders/page.tsx",
      "src/app/(workspace)/settings/page.tsx",
    ]) {
      const page = source(path);
      expect(page, path).not.toContain('"use client"');
      expect(page, path).toContain("getCachedRequestIdentity");
      expect(page, path).toMatch(/load[A-Z][A-Za-z]+PageData/);
    }
  });

  it("hydrates interactive pages from server data and keeps an in-memory SWR cache", () => {
    for (const path of [
      "src/app/(workspace)/dashboard/dashboard-client.tsx",
      "src/app/(workspace)/invoices/invoices-client.tsx",
      "src/app/(workspace)/invoices/[id]/invoice-detail-client.tsx",
      "src/app/(workspace)/reports/reports-client.tsx",
      "src/app/(workspace)/reminders/reminders-client.tsx",
      "src/app/(workspace)/settings/settings-client.tsx",
    ]) {
      const client = source(path);
      expect(client, path).toContain('"use client"');
      expect(client, path).toContain("useSWR");
      expect(client, path).toContain("initialData");
    }
    expect(source("src/components/workspace-data-provider.tsx")).toContain("provider");
  });

  it("uses one authenticated composite request for detail, reminders and settings refreshes", () => {
    for (const path of [
      "src/app/api/invoices/[id]/page-data/route.ts",
      "src/app/api/reminders/page-data/route.ts",
      "src/app/api/settings/page-data/route.ts",
    ]) {
      const route = source(path);
      expect(route.match(/getRequestIdentity\(\)/g), path).toHaveLength(1);
      expect(route, path).toContain('"server-timing"');
    }
    expect(source("src/lib/auth.ts")).toContain("cache(() => getRequestIdentity())");
  });

  it("provides interruptible loading UI and intent-based invoice prefetching", () => {
    expect(source("src/app/(workspace)/loading.tsx")).toContain("PageSkeleton");
    expect(source("src/app/(workspace)/invoices/[id]/loading.tsx")).toContain("PageSkeleton");
    const invoices = source("src/app/(workspace)/invoices/invoices-client.tsx");
    expect(invoices).toContain("router.prefetch(`/invoices/${id}`)");
    expect(invoices).toContain("onMouseEnter={() => prefetchInvoice(invoice.id)}");
    expect(invoices).toContain("onFocus={() => prefetchInvoice(invoice.id)}");
  });
});
