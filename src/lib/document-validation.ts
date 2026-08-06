export const MAX_DOCUMENT_BYTES = 10 * 1024 * 1024;

export const documentTypes = new Map([
  ["image/jpeg", "jpg"],
  ["image/png", "png"],
  ["image/webp", "webp"],
  ["application/pdf", "pdf"],
]);

export function hasExpectedDocumentSignature(bytes: Uint8Array, mime: string) {
  if (mime === "image/jpeg") return bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
  if (mime === "image/png") return bytes.slice(0, 8).every((byte, index) => byte === [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a][index]);
  if (mime === "application/pdf") return new TextDecoder().decode(bytes.slice(0, 5)) === "%PDF-";
  if (mime === "image/webp") return new TextDecoder().decode(bytes.slice(0, 4)) === "RIFF" && new TextDecoder().decode(bytes.slice(8, 12)) === "WEBP";
  return false;
}

export function validateDocumentMetadata(mime: string, size: number) {
  if (!documentTypes.has(mime)) return "Podporujeme PDF, JPG, PNG a WEBP.";
  if (!Number.isInteger(size) || size < 16 || size > MAX_DOCUMENT_BYTES) return "Dokument musí mít 16 B až 10 MB.";
  return null;
}

