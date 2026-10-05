import { createRequire } from "node:module";
import { describe, expect, it } from "vitest";

// Resolve the real dependency used by Next's lint tooling, also on clean pnpm installs.
const configRequire = createRequire(import.meta.resolve("eslint-config-next"));
const pluginRequire = createRequire(configRequire.resolve("@next/eslint-plugin-next"));
const globRequire = createRequire(pluginRequire.resolve("fast-glob"));
const matchRequire = createRequire(globRequire.resolve("micromatch"));
const braces = matchRequire("braces");

describe("braces: local mitigation for CVE-2026-93687", () => {
  const methods = ["parse", "compile", "expand", "stringify"] as const;

  it.each(methods)("%s rejects deeply nested patterns with a controlled error", method => {
    // Below the existing maxLength limit: without the patch this exhausts the stack.
    for (const pattern of ["{".repeat(3000) + "x" + "}".repeat(3000), "(".repeat(3000) + "x" + ")".repeat(3000), "{".repeat(3000) + "x"]) {
      expect(() => braces[method](pattern)).toThrow(/Brace nesting exceeds maximum depth/);
    }
  });

  it.each(["compile", "expand", "stringify"])("%s also limits callers supplying an AST", method => {
    let ast: { type: string; nodes?: unknown[]; value?: string } = { type: "text", value: "x" };
    for (let i = 0; i < 3000; i++) ast = { type: "paren", nodes: [ast] };
    ast = { type: "root", nodes: [ast] };
    expect(() => braces[method](ast)).toThrow(/Brace nesting exceeds maximum depth/);
  });

  it("preserves ordinary glob patterns and numeric ranges", () => {
    expect(braces.expand("src/{app,lib}/*.{ts,tsx}")).toEqual(["src/app/*.ts", "src/app/*.tsx", "src/lib/*.ts", "src/lib/*.tsx"]);
    expect(braces.expand("file-{1..3}.txt")).toEqual(["file-1.txt", "file-2.txt", "file-3.txt"]);
    expect(braces.compile("{a,{b,c}}")).toBe("(a|(b|c))");
    expect(braces.stringify(braces.parse("src/{app,lib}"))).toBe("src/{app,lib}");
  });
});
