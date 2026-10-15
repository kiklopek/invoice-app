import "server-only";

import { readFile } from "node:fs/promises";
import { join } from "node:path";

// CID keeps the current logo visible without relying on a deployed asset URL.
export async function authCodeLogoAttachment() {
  return {
    filename: "splatno.png",
    content: await readFile(join(process.cwd(), "public/brand/splatno-auth-mark.png")),
    contentId: "splatno-auth-mark",
    contentType: "image/png",
  };
}
