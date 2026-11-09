import type { Metadata } from "next";
import { getDictionary } from "@/i18n/dictionaries";
import type { Locale } from "@/i18n/locales";
import { PLANS } from "@/lib/plans";

const DEFAULT_ORIGIN = "https://www.splatno.com";

/** Use the public production origin, never the request host or a preview URL. */
export function siteOrigin(): string {
  try {
    const url = new URL(process.env.APP_BASE_URL || DEFAULT_ORIGIN);
    if (url.protocol !== "https:" || url.username || url.password ||
      url.hostname === "localhost" || url.hostname.endsWith(".vercel.app")) return DEFAULT_ORIGIN;
    // All owned Splatno aliases use the chosen public .com origin, even
    // while an existing deployment still has the older APP_BASE_URL.
    if (["splatno.cz", "www.splatno.cz", "splatno.com", "www.splatno.com"].includes(url.hostname)) return DEFAULT_ORIGIN;
    return url.origin;
  } catch {
    return DEFAULT_ORIGIN;
  }
}

export function publicIndexingEnabled(): boolean {
  return process.env.NODE_ENV === "production" &&
    (!process.env.VERCEL_ENV || process.env.VERCEL_ENV === "production");
}

export function siteUrl(path: string): string {
  return new URL(path, siteOrigin()).href;
}

export const privateRobots: Metadata["robots"] = {
  index: false,
  follow: false,
  noarchive: true,
};

export function landingMetadata(locale: Locale): Metadata {
  const { meta } = getDictionary(locale);
  const path = locale === "cs" ? "/" : "/en";
  const image = {
    url: siteUrl(`/og/${locale}`), width: 1200, height: 630,
    alt: meta.landingTitle,
  };
  return {
    title: meta.landingTitle,
    description: meta.landingDescription,
    alternates: {
      canonical: siteUrl(path),
      languages: { cs: siteUrl("/"), en: siteUrl("/en"), "x-default": siteUrl("/") },
    },
    robots: publicIndexingEnabled()
      ? { index: true, follow: true, "max-image-preview": "large", "max-snippet": -1 }
      : privateRobots,
    openGraph: {
      siteName: "Splatno", type: "website", url: siteUrl(path),
      title: meta.landingTitle, description: meta.landingDescription,
      locale: locale === "cs" ? "cs_CZ" : "en_GB",
      alternateLocale: locale === "cs" ? "en_GB" : "cs_CZ",
      images: [image],
    },
    twitter: {
      card: "summary_large_image", title: meta.landingTitle,
      description: meta.landingDescription, images: [image],
    },
    ...searchEngineVerification(),
  };
}

/**
 * Ownership tokens for Google Search Console and Bing Webmaster Tools, set in the
 * deployment environment (GOOGLE_SITE_VERIFICATION, BING_SITE_VERIFICATION).
 * A Domain property verified by DNS needs neither; the meta tags are the
 * alternative for a URL-prefix property.
 */
function searchEngineVerification(): Pick<Metadata, "verification"> {
  const google = process.env.GOOGLE_SITE_VERIFICATION?.trim();
  const bing = process.env.BING_SITE_VERIFICATION?.trim();
  if (!google && !bing) return {};
  return {
    verification: {
      ...(google ? { google } : {}),
      ...(bing ? { other: { "msvalidate.01": bing } } : {}),
    },
  };
}

export function landingStructuredData(locale: Locale) {
  const { meta, landing: { faq } } = getDictionary(locale);
  const url = siteUrl(locale === "cs" ? "/" : "/en");
  return {
    "@context": "https://schema.org",
    "@graph": [
      {
        "@type": "WebSite", "@id": siteUrl("/#website"),
        name: "Splatno", url: siteUrl("/"), inLanguage: ["cs", "en"],
      },
      {
        "@type": "WebPage", "@id": `${url}#webpage`, url,
        name: meta.landingTitle, description: meta.landingDescription, inLanguage: locale,
        isPartOf: { "@id": siteUrl("/#website") },
        about: { "@id": siteUrl("/#software") },
      },
      {
        "@type": "Organization", "@id": siteUrl("/#organization"),
        name: "Splatno", url: siteUrl("/"),
        // Google needs a square logo of at least 112 px.
        logo: { "@type": "ImageObject", url: siteUrl("/apple-icon.png"), width: 180, height: 180 },
      },
      {
        "@type": "SoftwareApplication", "@id": siteUrl("/#software"),
        name: "Splatno", url: siteUrl("/"), applicationCategory: "BusinessApplication",
        operatingSystem: "Web", description: meta.landingDescription,
        image: siteUrl(`/og/${locale}`), inLanguage: ["cs", "en"],
        publisher: { "@id": siteUrl("/#organization") },
        // The published price list (CZK per month, VAT excluded), from lib/plans.
        offers: {
          "@type": "AggregateOffer", priceCurrency: "CZK",
          lowPrice: Math.min(...PLANS.map((plan) => plan.monthlyCzk)),
          highPrice: Math.max(...PLANS.map((plan) => plan.monthlyCzk)),
          offerCount: PLANS.length,
          offers: PLANS.map((plan) => ({
            "@type": "Offer", name: `Splatno ${plan.name}`, url: `${url}#cenik`,
            price: plan.monthlyCzk, priceCurrency: "CZK",
            priceSpecification: {
              "@type": "UnitPriceSpecification", price: plan.monthlyCzk, priceCurrency: "CZK",
              valueAddedTaxIncluded: false, billingDuration: "P1M", unitCode: "MON",
            },
          })),
        },
      },
      {
        // The same questions and answers the page shows in its FAQ section.
        "@type": "FAQPage", "@id": `${url}#faq`, inLanguage: locale,
        isPartOf: { "@id": `${url}#webpage` },
        mainEntity: faq.items.map((item) => ({
          "@type": "Question", name: item.question,
          acceptedAnswer: { "@type": "Answer", text: item.answer },
        })),
      },
    ],
  };
}

export function serializeJsonLd(value: unknown): string {
  return JSON.stringify(value).replace(/</g, "\\u003c");
}
