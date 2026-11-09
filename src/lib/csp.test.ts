import { createRequire } from "node:module";
import type { NextConfig } from "next";
import { unstable_getResponseFromNextConfig } from "next/experimental/testing/server";
import { describe, expect, it } from "vitest";

const require = createRequire(import.meta.url);
const nextConfig = () => require("../../next.config.js") as NextConfig;

async function csp(path: string) {
  const response = await unstable_getResponseFromNextConfig({ url: `https://www.splatno.com${path}`, nextConfig: nextConfig() });
  const header = response.headers.get("content-security-policy") ?? "";
  return Object.fromEntries(header.split(";").map((part) => part.trim()).filter(Boolean).map((part) => {
    const [name, ...values] = part.split(/\s+/);
    return [name, values];
  }));
}

describe("content security policy", () => {
  it("lets the page frame only its own documents and PDFs it built in the browser (report printing)", async () => {
    const policy = await csp("/reports");
    expect(policy["frame-src"]).toEqual(["'self'", "blob:"]);
  });

  it("still forbids other sites from framing Splatno and keeps the strict defaults", async () => {
    const policy = await csp("/reports");
    expect(policy["frame-ancestors"]).toEqual(["'none'"]);
    expect(policy["default-src"]).toEqual(["'self'"]);
    expect(policy["object-src"]).toEqual(["'none'"]);
  });
});
