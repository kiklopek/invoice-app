import { createRequire } from "node:module";
import type { NextConfig } from "next";
import { getRedirectUrl, unstable_getResponseFromNextConfig } from "next/experimental/testing/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import robots from "@/app/robots";
import sitemap from "@/app/sitemap";
import { getDictionary } from "@/i18n/dictionaries";
import { landingMetadata, landingStructuredData, publicIndexingEnabled, serializeJsonLd, siteOrigin } from "./seo";

const require = createRequire(import.meta.url);
function nextConfig(): NextConfig {
  const path = require.resolve("../../next.config.js");
  delete require.cache[path];
  return require(path) as NextConfig;
}

beforeEach(() => {
  vi.stubEnv("NODE_ENV", "production");
  vi.stubEnv("VERCEL_ENV", "production");
  vi.stubEnv("APP_BASE_URL", "https://www.splatno.com");
});
afterEach(() => vi.unstubAllEnvs());

describe("search indexing policy", () => {
  it("allows product pages, crawler files and public assets in production", async () => {
    const config = nextConfig();
    for (const path of ["/", "/?utm_source=test", "/en", "/en/", "/en?utm_source=test", "/robots.txt", "/sitemap.xml", "/og/cs", "/og/en", "/brand/splatno-mark.png", "/landing/mascot-wave.webp", "/_next/image?url=test", "/_next/static/test.js", "/favicon.ico", "/icon.png", "/apple-icon.png"]) {
      const response = await unstable_getResponseFromNextConfig({ url: `https://www.splatno.com${path}`, nextConfig: config });
      expect(response.headers.get("x-robots-tag"), path).toBeNull();
    }
  });

  it("keeps company pages, account pages, drafts and API responses out of search", async () => {
    const config = nextConfig();
    for (const path of ["/dashboard", "/invoices", "/invoices/123", "/customers", "/settings", "/reports", "/reminders", "/predplatne", "/onboarding", "/provoz", "/login", "/register", "/hlavica", "/hlavica/registrace", "/mfa", "/forgot-password", "/reset-password", "/pozvanka/secret", "/auth/callback", "/api/invoices/123/pdf", "/logo/123", "/podminky", "/ochrana-osobnich-udaju", "/en/private", "/unknown"]) {
      const response = await unstable_getResponseFromNextConfig({ url: `https://www.splatno.com${path}`, nextConfig: config });
      expect(response.headers.get("x-robots-tag"), path).toContain("noindex");
    }
  });

  it.each(["preview", "development"])("does not index a %s deployment built in production mode", async (environment) => {
    vi.stubEnv("VERCEL_ENV", environment);
    expect(publicIndexingEnabled()).toBe(false);
    expect(landingMetadata("cs").robots).toMatchObject({ index: false });
    expect(sitemap()).toEqual([]);
    expect(robots().sitemap).toBeUndefined();
    const response = await unstable_getResponseFromNextConfig({ url: "https://preview.vercel.app/", nextConfig: nextConfig() });
    expect(response.headers.get("x-robots-tag")).toContain("noindex");
  });

  it("does not index local development even with production environment variables", () => {
    vi.stubEnv("NODE_ENV", "development");
    expect(publicIndexingEnabled()).toBe(false);
    expect(sitemap()).toEqual([]);
  });

  it("supports production hosting outside Vercel", () => {
    vi.stubEnv("VERCEL_ENV", "");
    expect(publicIndexingEnabled()).toBe(true);
  });
});

describe("public page SEO", () => {
  it.each(["splatno.cz", "www.splatno.cz", "splatno.com"])("redirects %s directly to .com while preserving paths and queries", async (host) => {
    for (const path of ["/", "/en", "/sitemap.xml", "/invoices/123?tab=payments", "/auth/callback?code=example&next=%2Fdashboard"]) {
      const response = await unstable_getResponseFromNextConfig({ url: `https://${host}${path}`, nextConfig: nextConfig() });
      expect(response.status).toBe(308);
      expect(getRedirectUrl(response)).toBe(`https://www.splatno.com${path}`);
    }
  });

  it.each(["www.splatno.com", "localhost:3100", "preview.vercel.app"])("does not redirect %s back to itself or away from development", async (host) => {
    const response = await unstable_getResponseFromNextConfig({ url: `https://${host}/en`, nextConfig: nextConfig() });
    expect(getRedirectUrl(response)).toBeNull();
  });

  it.each(["cs", "en"] as const)("uses matching titles, canonical URLs and share previews for %s", (locale) => {
    const { meta } = getDictionary(locale);
    const metadata = landingMetadata(locale);
    const canonical = `https://www.splatno.com${locale === "cs" ? "/" : "/en"}`;
    expect(metadata.title).toBe(meta.landingTitle);
    expect(metadata.description).toBe(meta.landingDescription);
    expect(metadata.alternates).toMatchObject({ canonical, languages: { cs: "https://www.splatno.com/", en: "https://www.splatno.com/en", "x-default": "https://www.splatno.com/" } });
    expect(metadata.openGraph).toMatchObject({ title: meta.landingTitle, description: meta.landingDescription, url: canonical, locale: locale === "cs" ? "cs_CZ" : "en_GB", images: [{ url: `https://www.splatno.com/og/${locale}`, width: 1200, height: 630 }] });
    expect(metadata.twitter).toMatchObject({ card: "summary_large_image", title: meta.landingTitle });
    expect(metadata.robots).toMatchObject({ index: true });
    expect(landingStructuredData(locale)["@graph"][1]).toMatchObject({ url: canonical, inLanguage: locale, description: meta.landingDescription });
  });

  it("lists only published canonical pages and advertises the sitemap", () => {
    expect(sitemap().map((entry) => entry.url)).toEqual(["https://www.splatno.com/", "https://www.splatno.com/en"]);
    expect(robots().sitemap).toBe("https://www.splatno.com/sitemap.xml");
    // Crawlers must be able to see noindex on login and draft legal pages.
    expect(robots().rules).toMatchObject({ allow: "/", disallow: ["/api/", "/auth/", "/logo/"] });
  });

  it.each(["invalid", "http://localhost:3000", "https://preview.vercel.app", "https://user:secret@example.com"])("never uses an unsafe origin: %s", (origin) => {
    vi.stubEnv("APP_BASE_URL", origin);
    expect(siteOrigin()).toBe("https://www.splatno.com");
  });

  it("normalizes a configured production origin", () => {
    vi.stubEnv("APP_BASE_URL", "https://example.com/path?query=1#anchor");
    expect(siteOrigin()).toBe("https://example.com");
    expect(landingMetadata("en").alternates?.canonical).toBe("https://example.com/en");
  });

  it.each(["https://splatno.cz", "https://www.splatno.cz/", "https://splatno.com", "https://www.splatno.com/"])("uses the canonical .com host for every Splatno configuration: %s", (origin) => {
    vi.stubEnv("APP_BASE_URL", origin);
    expect(siteOrigin()).toBe("https://www.splatno.com");
    expect(sitemap().map((entry) => entry.url)).toEqual(["https://www.splatno.com/", "https://www.splatno.com/en"]);
  });

  it("escapes script terminators without changing structured data", () => {
    const value = { description: '</script><script>alert("x")</script>' };
    const serialized = serializeJsonLd(value);
    expect(serialized).not.toContain("<");
    expect(JSON.parse(serialized)).toEqual(value);
  });
});
