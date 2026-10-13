import type { MetadataRoute } from "next";
import { publicIndexingEnabled, siteUrl } from "@/lib/seo";

export default function robots(): MetadataRoute.Robots {
  return {
    // HTML pages remain crawlable so crawlers can read their noindex directive.
    // Authentication protects company data independently of crawler rules.
    rules: { userAgent: "*", allow: "/", disallow: ["/api/", "/auth/", "/logo/"] },
    ...(publicIndexingEnabled() ? { sitemap: siteUrl("/sitemap.xml") } : {}),
  };
}
