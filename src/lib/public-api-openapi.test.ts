import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { API_KEY_SCOPES } from "./api-key-policy";
import { publicApiOpenApi } from "./public-api-openapi";
import { GET } from "@/app/api/v1/openapi/route";

function routeFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) =>
    entry.isDirectory()
      ? routeFiles(join(directory, entry.name))
      : entry.name === "route.ts"
        ? [join(directory, entry.name)]
        : [],
  );
}

describe("public API OpenAPI contract", () => {
  it("documents every exported public endpoint and its required permission", () => {
    const operations = publicApiOpenApi.paths as Record<
      string,
      Record<string, { "x-required-scope"?: string }>
    >;
    for (const file of routeFiles("src/app/api/v1")) {
      const path = file
        .replace("src/app/api/v1", "")
        .replace("/route.ts", "")
        .replace(/\[([^\]]+)\]/g, "{$1}");
      const source = readFileSync(file, "utf8");
      for (const match of source.matchAll(
        /export async function (GET|POST|PATCH|DELETE|PUT)\(/g,
      )) {
        const method = match[1].toLowerCase();
        expect(
          operations[path]?.[method],
          `${method.toUpperCase()} ${path}`,
        ).toBeDefined();
      }
      const scopes = [
        ...source.matchAll(/publicApi\(request,\s*"([^"]+)"/g),
      ].map((match) => match[1]);
      const documented = Object.values(operations[path] ?? {})
        .map((operation) => operation["x-required-scope"])
        .filter(Boolean);
      for (const scope of scopes) expect(documented).toContain(scope);
    }
  });

  it("resolves all local schema references and uses unique operation identifiers", () => {
    const document = publicApiOpenApi as unknown as Record<string, unknown>;
    const ids: string[] = [];
    const walk = (value: unknown) => {
      if (!value || typeof value !== "object") return;
      for (const [name, child] of Object.entries(value)) {
        if (name === "$ref") {
          expect(typeof child).toBe("string");
          const resolved = String(child)
            .replace(/^#\//, "")
            .split("/")
            .reduce<unknown>(
              (node, key) => (node as Record<string, unknown>)?.[key],
              document,
            );
          expect(resolved, String(child)).toBeDefined();
        } else if (name === "operationId") ids.push(String(child));
        else if (name === "x-required-scope")
          expect(API_KEY_SCOPES).toContain(child);
        else walk(child);
      }
    };
    walk(document);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids.length).toBeGreaterThan(10);
  });

  it("serves a public JSON specification with no authentication requirement", async () => {
    const response = await GET();
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("application/json");
    const document = await response.json();
    expect(document.openapi).toBe("3.1.0");
    expect(document.paths["/openapi"].get.security).toEqual([]);
  });
});
