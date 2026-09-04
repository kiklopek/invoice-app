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

/** @type {import('next').NextConfig} */
const nextConfig = {
  outputFileTracingRoot: path.join(__dirname),
  serverExternalPackages: ["@napi-rs/canvas", "sharp"],
  outputFileTracingIncludes: {
    "/api/invoices/extract": ocrRuntimeFiles,
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
