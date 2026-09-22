import { readFileSync } from "node:fs";
import { join } from "node:path";
import { devices } from "@playwright/test";
import { describe, expect, it } from "vitest";

// Skutečný incident (22. 9.): CI instaloval jen "chromium", ale
// playwright.config.ts má projekt desktop-safari na WebKitu. Nebylo to
// 35 nesouvisejících selhání -- byla to jedna chybějící závislost, a
// protože padal KAŽDÝ test na tom prohlížeči, vypadalo to jako plošná
// regrese, ne jako chybějící instalační krok. Test porovná, jaké enginy
// projekty v playwright.config.ts skutečně potřebují, s tím, co
// `playwright install` v ci.yml doopravdy stahuje.

function projectDeviceNames(): string[] {
  const config = readFileSync(join(process.cwd(), "playwright.config.ts"), "utf8");
  return [...config.matchAll(/\.\.\.devices\["([^"]+)"\]/g)].map(match => match[1]);
}

function requiredEngines(): Set<string> {
  const engines = new Set<string>();
  for (const name of projectDeviceNames()) {
    const engine = (devices as Record<string, { defaultBrowserType?: string }>)[name]?.defaultBrowserType;
    if (engine) engines.add(engine);
  }
  return engines;
}

function installedEngines(): Set<string> {
  const workflow = readFileSync(join(process.cwd(), ".github/workflows/ci.yml"), "utf8");
  const match = /playwright install --with-deps ([a-z ]+)/.exec(workflow);
  return new Set(match ? match[1].trim().split(/\s+/) : []);
}

describe("CI instaluje prohlížeče pro všechny projekty v playwright.config.ts", () => {
  it("zjišťuje aspoň jeden projekt a aspoň jednu instalovanou závislost, jinak testuje fikci", () => {
    expect(projectDeviceNames().length).toBeGreaterThan(0);
    expect(installedEngines().size).toBeGreaterThan(0);
  });

  it("každý engine, který nějaký projekt potřebuje, se v CI instaluje", () => {
    const required = requiredEngines();
    const installed = installedEngines();
    for (const engine of required) {
      expect(installed.has(engine), `playwright.config.ts potřebuje "${engine}", ale ci.yml ho neinstaluje -- ${[...installed].join(", ")}`).toBe(true);
    }
  });
});
