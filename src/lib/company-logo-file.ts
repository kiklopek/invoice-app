// Nahrané logo firmy. Formát se pozná podle obsahu souboru (ne podle
// přípony nebo hlavičky od prohlížeče) a povolené jsou jen bitmapy: SVG ani
// nic jiného, v čem by se dal schovat skript, se nepřijme.

export const MAX_LOGO_BYTES = 512 * 1024;
export const LOGO_BUCKET = "company-logos";
export type LogoType = "image/png" | "image/jpeg" | "image/webp";

export function detectLogoType(data: Uint8Array): LogoType | null {
  const starts = (...signature: number[]) => signature.every((value, index) => data[index] === value);
  if (data.length >= 8 && starts(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a)) return "image/png";
  if (data.length >= 3 && starts(0xff, 0xd8, 0xff)) return "image/jpeg";
  if (data.length >= 12 && starts(0x52, 0x49, 0x46, 0x46) && data[8] === 0x57 && data[9] === 0x45 && data[10] === 0x42 && data[11] === 0x50) return "image/webp";
  return null;
}

export function logoObjectPath(organizationId: string) {
  return `${organizationId}/logo`;
}

/** Cesta uložená v organizations.logo_path; ?v= mění adresu po každé změně loga. */
export function logoPathFor(organizationId: string, version: number) {
  return `/logo/${organizationId}?v=${version}`;
}
