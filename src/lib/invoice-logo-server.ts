import "server-only";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import sharp from "sharp";
import { createServiceClient } from "./supabase-server";
import {
  LOGO_BUCKET,
  logoObjectPath,
  MAX_LOGO_BYTES,
} from "./company-logo-file";

let fallback: Promise<Uint8Array> | undefined;
const normalize = async (bytes: Uint8Array) =>
  new Uint8Array(
    await sharp(bytes, { limitInputPixels: 4096 * 4096 })
      .resize({
        width: 256,
        height: 128,
        fit: "inside",
        withoutEnlargement: true,
      })
      .png()
      .toBuffer(),
  );
/** Only the existing managed logo or a local brand asset; never fetch arbitrary URLs. */
export async function invoiceLogoBytes(
  source?: string | null,
): Promise<Uint8Array> {
  try {
    const organization = source?.match(
      /^\/logo\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})(?:\?v=\d+)?$/i,
    )?.[1];
    if (organization) {
      const { data, error } = await createServiceClient()
        .storage.from(LOGO_BUCKET)
        .download(
          logoObjectPath(organization),
          {},
          { signal: AbortSignal.timeout(3000) },
        );
      if (!error && data && data.size <= MAX_LOGO_BYTES)
        return await normalize(new Uint8Array(await data.arrayBuffer()));
    } else if (
      source &&
      /^\/brand\/[a-z0-9-]+\.(?:png|jpe?g|webp)$/i.test(source)
    ) {
      return await normalize(
        new Uint8Array(
          readFileSync(join(process.cwd(), "public", source.slice(1))),
        ),
      );
    }
  } catch {
    /* Unavailable branding never prevents a valid invoice from being downloaded. */
  }
  fallback ??= normalize(
    new Uint8Array(
      readFileSync(join(process.cwd(), "public/brand/splatno-auth-mark.png")),
    ),
  );
  return fallback;
}
