import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";

const canonicalOrigin = "https://www.splatno.com";
const results = [];
async function follow(url, userAgent = "Splatno-Domain-Check/1.0") {
  const chain = [];
  for (let hop = 0; hop < 5; hop++) {
    const response = await fetch(url, { redirect: "manual", headers: { "user-agent": userAgent }, signal: AbortSignal.timeout(20_000) });
    chain.push({ url, status: response.status, location: response.headers.get("location"), robots: response.headers.get("x-robots-tag") });
    if ([301, 302, 303, 307, 308].includes(response.status)) {
      assert.ok([301, 308].includes(response.status), `${url}: redirect must be permanent`);
      url = new URL(response.headers.get("location"), url).href;
      continue;
    }
    return { response, chain };
  }
  throw new Error(`Too many redirects: ${url}`);
}

for (const origin of ["https://splatno.cz", "https://www.splatno.cz", "https://splatno.com", canonicalOrigin, "http://splatno.cz", "http://www.splatno.cz", "http://splatno.com", "http://www.splatno.com"]) {
  for (const path of ["/", "/en?utm_source=domain-check", "/robots.txt", "/sitemap.xml"]) {
    const { response, chain } = await follow(`${origin}${path}`);
    assert.equal(response.status, 200, `${origin}${path}`);
    assert.equal(new URL(chain.at(-1).url).href, `${canonicalOrigin}${path}`);
    assert.ok(!response.headers.get("x-robots-tag")?.includes("noindex"), `${origin}${path}`);
    const body = await response.text();
    if (path === "/sitemap.xml") {
      assert.ok(response.headers.get("content-type")?.includes("xml"));
      assert.deepEqual([...body.matchAll(/<loc>(.*?)<\/loc>/g)].map((match) => match[1]), [`${canonicalOrigin}/`, `${canonicalOrigin}/en`]);
    } else if (path === "/robots.txt") {
      assert.ok(body.includes(`Sitemap: ${canonicalOrigin}/sitemap.xml`));
    } else {
      const canonical = body.match(/<link\b[^>]*rel="canonical"[^>]*href="([^"]+)"/);
      assert.ok(canonical, `${origin}${path}: missing canonical`);
      assert.equal(new URL(canonical[1]).href, `${canonicalOrigin}${path.startsWith("/en") ? "/en" : "/"}`);
      assert.ok(body.includes('name="robots" content="index, follow'));
    }
    results.push({ source: `${origin}${path}`, chain, passed: true });
  }
}
for (const path of ["/", "/en"]) {
  const { response } = await follow(`${canonicalOrigin}${path}`, "Googlebot");
  assert.equal(response.status, 200);
  assert.ok(!response.headers.get("x-robots-tag")?.includes("noindex"));
  assert.ok((await response.text()).includes('name="robots" content="index, follow'));
}
for (const host of ["splatno.cz", "www.splatno.cz", "splatno.com", "www.splatno.com"]) {
  const { response } = await follow(`https://${host}/login`);
  assert.ok(response.headers.get("x-robots-tag")?.includes("noindex"));
}
await mkdir(".artifacts/seo", { recursive: true });
await writeFile(".artifacts/seo/domain-check.json", JSON.stringify({ checkedAt: new Date().toISOString(), canonicalOrigin, results }, null, 2));
console.log("DOMAIN SEO PASS: all .cz/.com aliases over HTTP/HTTPS, permanent redirects, preserved paths/queries, canonical URLs, robots, sitemap, Googlebot and private login.");
