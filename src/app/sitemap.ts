import type { MetadataRoute } from "next";
import { publicIndexingEnabled, siteUrl } from "@/lib/seo";

export default function sitemap(): MetadataRoute.Sitemap {
  if (!publicIndexingEnabled()) return [];
  // Only published product pages. Legal documents are still marked as drafts.
  return ["/", "/en"].map((path) => ({
    url: siteUrl(path),
    alternates: { languages: { cs: siteUrl("/"), en: siteUrl("/en"), "x-default": siteUrl("/") } },
  }));
}
