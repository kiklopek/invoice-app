import { readFile, writeFile } from "node:fs/promises";
import sharp from "sharp";

// Canonical green ribbon: web, mail, PDF, sender avatar and browser icons.
const masterUrl = new URL("../public/brand/splatno-mark.svg", import.meta.url);
const master = await readFile(masterUrl);
const paths = master.toString().match(/<path[^>]+\/>/g)?.join("");
if (!paths) throw new Error("Missing canonical Splatno ribbon paths.");
const frame = (size, radius = 0) => {
  const scale = size * .7 / 134;
  const x = (size - 100 * scale) / 2;
  const y = (size - 134 * scale) / 2;
  return `<svg xmlns="http://www.w3.org/2000/svg" version="1.2" baseProfile="tiny-ps" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}"><title>Splatno</title><rect width="${size}" height="${size}" rx="${radius}" fill="#ffffff"/><g transform="translate(${x} ${y}) scale(${scale})">${paths}</g></svg>`;
};
const source = Buffer.from(frame(96, 23));
await writeFile(new URL("../public/brand/splatno-favicon.svg", import.meta.url), source);
await writeFile(new URL("../public/brand/splatno-mark.png", import.meta.url), await sharp(master).resize(512, 512, { fit: "contain", background: { r: 0, g: 0, b: 0, alpha: 0 } }).png().toBuffer());
await writeFile(new URL("../public/brand/splatno-auth-mark.png", import.meta.url), await sharp(master).png().toBuffer());
const avatar = Buffer.from(frame(512));
await writeFile(new URL("../public/brand/splatno-email-avatar.svg", import.meta.url), avatar);
await writeFile(new URL("../public/brand/splatno-email-avatar.png", import.meta.url), await sharp(avatar).png().toBuffer());
const render = (size) => sharp(source, { density: 384 }).resize(size, size).png().toBuffer();

await writeFile(new URL("../public/icon.png", import.meta.url), await render(96));
await writeFile(new URL("../public/apple-icon.png", import.meta.url), await render(180));

// ICO entries contain PNG images, supported by modern browsers and Windows.
const sizes = [16, 32, 48, 96];
const images = await Promise.all(sizes.map(render));
const directory = Buffer.alloc(6 + sizes.length * 16);
directory.writeUInt16LE(1, 2);
directory.writeUInt16LE(sizes.length, 4);
let offset = directory.length;
for (const [index, size] of sizes.entries()) {
  const entry = 6 + index * 16;
  directory[entry] = size;
  directory[entry + 1] = size;
  directory.writeUInt16LE(1, entry + 4);
  directory.writeUInt16LE(32, entry + 6);
  directory.writeUInt32LE(images[index].length, entry + 8);
  directory.writeUInt32LE(offset, entry + 12);
  offset += images[index].length;
}
await writeFile(new URL("../public/favicon.ico", import.meta.url), Buffer.concat([directory, ...images]));
console.log("Generated current Splatno ribbon: brand PNG, mail/PDF mark, sender avatar, favicon, app and Apple icons.");
