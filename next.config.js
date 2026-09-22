const path = require("path");

const isDev = process.env.NODE_ENV === "development";
const csp = `
  default-src 'self';
  script-src 'self' 'unsafe-inline'${isDev ? " 'unsafe-eval'" : ""};
  style-src 'self' 'unsafe-inline';
  img-src 'self' blob: data: https://*.supabase.co;
  font-src 'self';
  connect-src 'self' https://*.supabase.co wss://*.supabase.co;
  object-src 'none';
  base-uri 'self';
  form-action 'self';
  frame-ancestors 'none';
  ${isDev ? "" : "upgrade-insecure-requests;"}
`;

const ocrRuntimeFiles = [
  "./node_modules/@tesseract.js-data/ces/4.0.0/ces.traineddata.gz",
  "./node_modules/@tesseract.js-data/eng/4.0.0/eng.traineddata.gz",
];

// Faktura v PDF vklada Liberation Sans, aby se cestina netransliterovala
// ("Dvorak" misto "Dvořák"). Font se cte za behu z pdfjs-dist, ktery nic
// staticky neimportuje, takze by ho trasovani nenaslo a generovani PDF by
// v produkci spadlo. Musi byt u KAZDE routy, ktera PDF vytvari.
const invoicePdfFonts = [
  "./node_modules/pdfjs-dist/standard_fonts/LiberationSans-Regular.ttf",
  "./node_modules/pdfjs-dist/standard_fonts/LiberationSans-Bold.ttf",
];

/** @type {import('next').NextConfig} */
const nextConfig = {
  // Keep localhost visually equivalent to production and prevent the floating
  // development portal from covering mobile controls. Compile/runtime errors
  // are still shown by Next.js when this indicator is disabled.
  devIndicators: false,
  allowedDevOrigins: ["127.0.0.1"],
  outputFileTracingRoot: path.join(__dirname),
  serverExternalPackages: ["@napi-rs/canvas", "sharp", "tesseract.js", "pdfjs-dist"],
  outputFileTracingIncludes: {
    "/api/invoices/extract": ocrRuntimeFiles,
    "/api/invoices/[id]/pdf": invoicePdfFonts,
    "/api/invoices/[id]/send": invoicePdfFonts,
    "/api/invoices/[id]/reminders/[reminderId]/retry": invoicePdfFonts,
    "/api/cron/check-due": invoicePdfFonts,
  },
  async headers() {
    return [{
      source: "/(.*)",
      headers: [
        { key: "Content-Security-Policy", value: csp.replace(/\s{2,}/g, " ").trim() },
        { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
        { key: "X-Content-Type-Options", value: "nosniff" },
        { key: "X-Frame-Options", value: "DENY" },
        { key: "X-Robots-Tag", value: "noindex, nofollow, noarchive" },
        { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
      ],
    }];
  },
};

module.exports = nextConfig;
