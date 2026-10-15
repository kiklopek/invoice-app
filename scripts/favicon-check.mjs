import assert from "node:assert/strict";

// Pass a local origin before deployment; defaults check both public domains.
const origins = process.argv.slice(2);
if (!origins.length) origins.push("https://splatno.cz", "https://splatno.com");
for (const origin of origins) {
  for (const path of ["/", "/en"]) {
    const response = await fetch(new URL(path, origin), { signal: AbortSignal.timeout(20_000) });
    assert.equal(response.status, 200, `${origin}${path}`);
    const html = await response.text();
    const links = [...html.matchAll(/<link\b[^>]*rel="(?:icon|shortcut icon|apple-touch-icon)"[^>]*>/g)].map(([tag]) => tag);
    const png = links.find((tag) => tag.includes('rel="icon"') && tag.includes('type="image/png"'));
    assert.ok(png?.includes('href="/icon.png"') && png.includes('sizes="96x96"'), `${origin}${path}: missing stable 96px favicon`);
    assert.ok(links.some((tag) => tag.includes('href="/favicon.ico"')), `${origin}${path}: missing ICO fallback`);
    assert.ok(links.some((tag) => tag.includes('rel="apple-touch-icon"') && tag.includes('href="/apple-icon.png"')), `${origin}${path}: missing Apple icon`);
    const home = new URL(response.url);
    for (const [file, type, size] of [["/icon.png", "image/png", 96], ["/apple-icon.png", "image/png", 180], ["/favicon.ico", "image/x-icon", null]]) {
      const icon = await fetch(new URL(file, home), { headers: { "user-agent": "Googlebot-Image/1.0" }, signal: AbortSignal.timeout(20_000) });
      assert.equal(icon.status, 200, `${home.origin}${file}`);
      const contentType = icon.headers.get("content-type") ?? "";
      assert.ok(contentType.includes(type) || (!size && contentType.includes("image/vnd.microsoft.icon")), `${file}: incorrect content type`);
      // Development/preview deployments deliberately block indexing.
      if (!home.hostname.match(/^(localhost|127\.)/)) assert.ok(!icon.headers.get("x-robots-tag")?.includes("noindex"), `${file}: blocked from indexing`);
      const bytes = Buffer.from(await icon.arrayBuffer());
      if (size) {
        assert.equal(bytes.subarray(1, 4).toString(), "PNG");
        assert.equal(bytes.readUInt32BE(16), size);
        assert.equal(bytes.readUInt32BE(20), size);
      } else {
        assert.equal(bytes.readUInt16LE(2), 1);
        const sizes = Array.from({ length: bytes.readUInt16LE(4) }, (_, index) => [bytes[6 + index * 16], bytes[7 + index * 16]]);
        assert.ok(sizes.some(([width, height]) => width === 96 && height === 96));
      }
    }
    console.log(`FAVICON PASS ${home.href}: stable metadata, accessible PNG/ICO/Apple files and correct dimensions.`);
  }
}
