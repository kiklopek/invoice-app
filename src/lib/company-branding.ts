export const DEFAULT_COMPANY_LOGO = "/brand/splatno-mark.svg";
// Raster asset for mail clients that do not display SVG.
export const DEFAULT_EMAIL_LOGO = "/brand/splatno-auth-mark.png";
export const DEFAULT_EMAIL_LOGO_CID = "splatno-email-mark";
const DEFAULT_APP_URL = "https://www.splatno.cz";

export function safeCompanyLogoSource(value: string | null | undefined): string | null {
  const source = value?.trim();
  if (!source) return null;
  if (source.startsWith("/") && !source.startsWith("//") && !source.includes("\\")) return source;
  try {
    const url = new URL(source);
    return ["https:", "http:"].includes(url.protocol) ? url.toString() : null;
  } catch {
    return null;
  }
}

/** Absolute URL for sent mail; previews may keep local asset paths. */
export function companyEmailLogoSource(logoPath: string | null | undefined, baseUrl?: string | null): string {
  const source = safeCompanyLogoSource(logoPath) ?? DEFAULT_EMAIL_LOGO;
  if (baseUrl === undefined) return source;
  const base = safeCompanyLogoSource(baseUrl) ?? DEFAULT_APP_URL;
  try {
    return new URL(source, base).toString();
  } catch {
    return new URL(source, DEFAULT_APP_URL).toString();
  }
}

export function renderCompanyEmailLogo(logoPath: string | null | undefined, companyName: string, baseUrl?: string | null, inlineDefault = false) {
  let source = companyEmailLogoSource(logoPath, baseUrl);
  const isDefault = !safeCompanyLogoSource(logoPath) || source.endsWith(DEFAULT_EMAIL_LOGO);
  if (inlineDefault && isDefault) source = `cid:${DEFAULT_EMAIL_LOGO_CID}`;
  const width = isDefault ? 64 : 91;
  const height = isDefault ? 86 : 85;
  const escape = (value: string) => value.replaceAll("&", "&amp;").replaceAll('"', "&quot;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
  return `<img src="${escape(source)}" width="${width}" height="${height}" alt="${escape(isDefault ? "Splatno" : companyName)}" style="display:block;width:${width}px;height:${height}px;border:0;outline:none;text-decoration:none;object-fit:contain;">`;
}
