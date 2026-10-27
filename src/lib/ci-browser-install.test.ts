import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

// Compare the projects actually enabled in the normal CI environment with
// its installed engines. A text search also includes conditional release-only
// projects and incorrectly requires Firefox when RELEASE_AUDIT is disabled.
async function enabledProjects(releaseAudit = false) {
  vi.stubEnv("RELEASE_AUDIT", String(releaseAudit));
  vi.resetModules();
  const { default: config } = await import("../../playwright.config");
  return config.projects ?? [];
}

async function requiredEngines(releaseAudit = false): Promise<Set<string>> {
  const engines = new Set<string>();
  for (const project of await enabledProjects(releaseAudit)) {
    const use = project.use as { browserName?: string; defaultBrowserType?: string } | undefined;
    engines.add(use?.browserName ?? use?.defaultBrowserType ?? "chromium");
  }
  return engines;
}

function installedEngines(): Set<string> {
  const workflow = readFileSync(join(process.cwd(), ".github/workflows/ci.yml"), "utf8");
  const match = /playwright install --with-deps ([a-z ]+)/.exec(workflow);
  return new Set(match ? match[1].trim().split(/\s+/) : []);
}

afterEach(() => vi.unstubAllEnvs());

describe("CI instaluje prohlížeče pro aktivní projekty v playwright.config.ts", () => {
  it("zjišťuje aspoň jeden projekt a aspoň jednu instalovanou závislost, jinak testuje fikci", async () => {
    expect((await enabledProjects()).length).toBeGreaterThan(0);
    expect(installedEngines().size).toBeGreaterThan(0);
  });

  it("každý engine běžného CI projektu se instaluje", async () => {
    const required = await requiredEngines();
    const installed = installedEngines();
    for (const engine of required) {
      expect(installed.has(engine), `playwright.config.ts potřebuje "${engine}", ale ci.yml ho neinstaluje -- ${[...installed].join(", ")}`).toBe(true);
    }
  });

  it("Firefox zůstává součástí samostatného release auditu", async () => {
    expect(await requiredEngines()).toEqual(new Set(["chromium", "webkit"]));
    expect(await requiredEngines(true)).toEqual(new Set(["chromium", "webkit", "firefox"]));
  });
});
