import sharp from "sharp";
import { detectLogoType, MAX_LOGO_BYTES, MAX_LOGO_DIMENSION } from "./company-logo-file";

/** A file signature alone also matches truncated or otherwise corrupt images. */
export async function isDecodableCompanyLogo(data: Uint8Array) {
  if (!data.length || data.length > MAX_LOGO_BYTES || !detectLogoType(data)) return false;
  try {
    const image = sharp(data, { limitInputPixels: MAX_LOGO_DIMENSION ** 2, failOn: "warning" });
    const metadata = await image.metadata();
    if (!metadata.width || !metadata.height || metadata.width > MAX_LOGO_DIMENSION || metadata.height > MAX_LOGO_DIMENSION) return false;
    await image.resize(1, 1).toBuffer();
    return true;
  } catch {
    return false;
  }
}
