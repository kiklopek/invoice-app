import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";

// Exkluzivita R. Hlavica (vlastní vstup s logem) je záměrně na jednom místě:
// src/lib/tenant-entries.ts. Všude jinde se konkrétní firma bere z dat. Kdyby
// se jméno rozlezlo po kódu, každá další výjimka by tiše měnila chování i
// ostatním firmám -- přesně to se stalo s pevnou doménou @hlavica.cz.
const ALLOWED = [
  "src/lib/tenant-entries.ts",
  // Stránky vstupu splatno.cz/hlavica.
  "src/app/(auth)/hlavica/",
  // Testovací účet bez 2FA (zůstává podle rozhodnutí provozovatele).
  "src/lib/email-mfa-core.ts",
];

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return sourceFiles(path);
    if (!/\.(ts|tsx)$/.test(name) || /\.test\.tsx?$/.test(name) || name.includes("__test-helpers__")) return [];
    return [path];
  });
}

// Komentáře smí firmu jmenovat (vysvětlují proč), kód ne.
function withoutComments(source: string) {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:"'`])\/\/.*$/gm, "$1");
}

describe("R. Hlavica only in its own module", () => {
  it("does not name the company in code outside the allowed places", () => {
    const offenders = sourceFiles(join(process.cwd(), "src"))
      .map((path) => relative(process.cwd(), path))
      .filter((path) => !ALLOWED.some((allowed) => path.startsWith(allowed)))
      .filter((path) => {
        let code = withoutComments(readFileSync(path, "utf8"));
        // Next.js vyžaduje v proxy statický matcher; jinde v proxy firma být nesmí.
        if (path === "src/proxy.ts") code = code.replace(/matcher:\s*\[[\s\S]*?\]/, "");
        return /hlavica/i.test(code);
      });
    expect(offenders).toEqual([]);
  });
});
