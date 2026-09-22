import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const proxy = () => readFileSync(join(process.cwd(), "src/proxy.ts"), "utf8");

// Vsechny segmenty ve (workspace) jsou stranky za prihlasenim. Kdyz nektery
// chybi v proxy, nepřihlaseny uzivatel nedostane redirect na /login, ale
// spadne az v page-data loaderu do chybove stranky -- tak to bylo
// u /customers. Seznam se proto odvozuje ze skutecnych adresaru, ne z ruky.
const workspaceSegments = () =>
  readdirSync(join(process.cwd(), "src/app/(workspace)"), { withFileTypes: true })
    .filter(entry => entry.isDirectory() && !entry.name.startsWith("_"))
    .map(entry => entry.name);

const listAfter = (source: string, marker: string) => {
  const start = source.indexOf(marker);
  if (start < 0) return [];
  const open = source.indexOf("[", start);
  const close = source.indexOf("]", open);
  return [...source.slice(open, close).matchAll(/"([^"]+)"/g)].map(match => match[1]);
};

describe("proxy route coverage", () => {
  it("guards every workspace segment", () => {
    const protectedPaths = listAfter(proxy(), "const protectedRoute");
    for (const segment of workspaceSegments()) {
      expect(protectedPaths).toContain(`/${segment}`);
    }
  });

  it("matches every workspace segment in the middleware matcher", () => {
    const matcher = listAfter(proxy(), "matcher:");
    for (const segment of workspaceSegments()) {
      expect(matcher).toContain(`/${segment}/:path*`);
    }
  });

  // Obe pole musi zustat v synchronizaci: matcher rozhoduje, jestli se
  // middleware vubec spusti, protectedRoute az co uvnitr udela. Chybejici
  // zaznam v kteremkoli z nich znamena nechranenou stranku.
  it("keeps both lists in sync with each other", () => {
    const source = proxy();
    const protectedPaths = listAfter(source, "const protectedRoute").filter(path => path !== "/mfa");
    const matcher = listAfter(source, "matcher:");
    for (const path of protectedPaths) {
      expect(matcher).toContain(`${path}/:path*`);
    }
  });
});

describe("returnTo handling", () => {
  // api-client.ts uz /login?returnTo=... generuje, ale prihlasovaci stranka
  // ho drive vubec necetla -- uzivatel se po vyprseni session nikdy nevratil
  // tam, kam mířil. Proxy ho musi doplnit i pri vlastnim redirectu.
  it("preserves the requested path when redirecting to login", () => {
    expect(proxy()).toContain("returnTo");
  });

  it("only follows same-site relative paths", () => {
    // Otevreny redirect je realne riziko: "//evil.example" je pro prohlizec
    // absolutni URL. Validace musi odmitnout schema i protokolove-relativni tvar.
    const login = readFileSync(join(process.cwd(), "src/lib/safe-return-path.ts"), "utf8");
    expect(login).toContain('startsWith("/")');
    expect(login).toContain('startsWith("//")');
  });
});
