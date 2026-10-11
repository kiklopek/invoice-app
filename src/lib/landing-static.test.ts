import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { getDictionary } from "@/i18n/dictionaries";
import { cs } from "@/i18n/dictionaries/cs";
import { en } from "@/i18n/dictionaries/en";

const source = (path: string) => readFileSync(join(process.cwd(), path), "utf8");

// Landing se generuje dopředu (statická `/` a `/en`). Stačí jedno čtení cookies
// nebo hlaviček a stránka se začne skládat při každém požadavku -- návštěvník
// pak nejdřív vidí kořenové loading.tsx „Načítám aplikaci…“ (rychlostní test:
// mobil LCP 4,8 s).
const LANDING_FILES = [
  "src/app/(landing)/page.tsx",
  "src/app/(landing)/en/page.tsx",
  "src/app/(landing)/layout.tsx",
  "src/components/landing/landing-page.tsx",
];

describe("landing page je statická", () => {
  it("existuje česká `/` i anglická `/en`", () => {
    for (const file of LANDING_FILES) expect(existsSync(join(process.cwd(), file)), file).toBe(true);
    expect(source("src/app/(landing)/page.tsx")).toContain('<LandingPage locale="cs" />');
    expect(source("src/app/(landing)/en/page.tsx")).toContain('<LandingPage locale="en" />');
  });

  it("nečte cookies, hlavičky ani jazyk požadavku", () => {
    for (const file of LANDING_FILES.filter((path) => existsSync(join(process.cwd(), path)))) {
      const code = source(file);
      expect(code, file).not.toContain("@/i18n/server");
      expect(code, file).not.toContain("next/headers");
      expect(code, file).not.toMatch(/\bcookies\(/);
      expect(code, file).not.toMatch(/\bheaders\(/);
      expect(code, file).not.toContain("generateMetadata");
    }
    expect(source("src/components/landing/landing-page.tsx")).not.toMatch(/export async function LandingPage/);
  });

  it("landing není obalená načítací obrazovkou", () => {
    // Kořenové loading.tsx obalí do Suspense i předgenerovanou landing: HTML pak
    // začíná „Načítám aplikaci…“ a přednačtení písem se do něj vůbec nedostane
    // (vzniká až uvnitř hranice). Načítací obrazovka patří jen skupinám, které
    // se skládají při požadavku.
    expect(existsSync(join(process.cwd(), "src/app/loading.tsx"))).toBe(false);
    for (const group of ["(auth)", "(onboarding)", "(operator)", "(workspace)"]) {
      expect(existsSync(join(process.cwd(), "src/app", group, "loading.tsx")), group).toBe(true);
    }
  });

  it("písma jsou v layoutu landing (jen tam je Next přednačte), ručně psané se nepřednačítá", () => {
    // Next přednačítá písmo jen ze souboru stránky nebo layoutu. Deklarace v
    // komponentě dávala prázdný manifest písem a předgenerované HTML pak Inter
    // stahovalo až z CSS (mobil: start 1,3 s místo 0,25 s).
    const layout = source("src/app/(landing)/layout.tsx");
    expect(layout).toMatch(/Inter\(\{/);
    expect(layout).toMatch(/Caveat\(\{/);
    const caveat = layout.slice(layout.indexOf("Caveat({"), layout.indexOf("});", layout.indexOf("Caveat({")));
    expect(caveat).toContain("preload: false");
    expect(source("src/components/landing/landing-page.tsx")).not.toContain("next/font");
  });

  it("skrytý maskot se nestahuje předem", () => {
    const landing = source("src/components/landing/landing-page.tsx");
    for (const name of ["heroMascot", "trustMascot"]) {
      const at = landing.indexOf(`styles.${name}`);
      // Komentáře u atributů se nepočítají, jde o skutečné vlastnosti obrázku.
      const tag = landing.slice(landing.lastIndexOf("<Image", at), landing.indexOf("/>", at)).replace(/\/\/.*$/gm, "");
      expect(tag, name).not.toContain('loading="eager"');
      expect(tag, name).not.toMatch(/\bpreload\b|\bpriority\b/);
      expect(tag, name).toContain('fetchPriority="high"');
    }
  });

  it("slovník jde vzít bez serverového modulu", () => {
    expect(getDictionary("cs")).toBe(cs);
    expect(getDictionary("en")).toBe(en);
  });
});
