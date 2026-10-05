import { readFile, writeFile } from "node:fs/promises";
import sharp from "sharp";

// Keep browser, search and home-screen icons based on the same vector master.
// The company logo and the other brand assets are independent of these icons.
const source = await readFile(new URL("../public/brand/splatno-favicon.svg", import.meta.url));
const render = (size) => sharp(source, { density: 384 }).resize(size, size).png().toBuffer();

await writeFile(new URL("../src/app/icon.png", import.meta.url), await render(96));
await writeFile(new URL("../src/app/apple-icon.png", import.meta.url), await render(180));

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
await writeFile(new URL("../src/app/favicon.ico", import.meta.url), Buffer.concat([directory, ...images]));
console.log("Generated Splatno favicon (16/32/48/96 px), icon (96 px) and Apple icon (180 px).");
