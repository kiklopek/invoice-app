import { readFile, mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

// Read-only HTTP benchmark. Optional Playwright storage state is loaded from
// a local file, never passed on the command line or copied into the report.
// Example: node scripts/benchmark-performance.mjs --base-url https://staging.example --storage-state .artifacts/staging-session.json
const args = new Map();
for (let index = 2; index < process.argv.length; index += 2) args.set(process.argv[index], process.argv[index + 1]);
const base = new URL(args.get("--base-url") ?? "http://127.0.0.1:3011");
if (!["http:", "https:"].includes(base.protocol) || base.username || base.password || base.search || base.hash) throw new Error("Use an HTTP(S) base URL without credentials or query parameters.");
const samples = Number(args.get("--samples") ?? 30);
const concurrency = Number(args.get("--concurrency") ?? 8);
if (!Number.isInteger(samples) || samples < 5 || samples > 200 || !Number.isInteger(concurrency) || concurrency < 1 || concurrency > 16) throw new Error("Samples must be 5–200 and concurrency 1–16.");
const output = path.resolve(args.get("--output") ?? ".artifacts/performance-audit/http-benchmark.json");
let cookies = [];
if (args.has("--storage-state")) {
  const state = JSON.parse(await readFile(args.get("--storage-state"), "utf8"));
  const now = Date.now() / 1000;
  cookies = (state.cookies ?? []).filter((cookie) => {
    const domain = String(cookie.domain ?? "").replace(/^\./, "");
    return domain && (base.hostname === domain || base.hostname.endsWith(`.${domain}`))
      && (!cookie.secure || base.protocol === "https:") && (cookie.expires <= 0 || cookie.expires > now);
  });
}
const routes = ["/login", "/register", "/settings", "/api/settings/page-data", "/api/settings/bank-accounts"];
const allowedStages = new Set(["auth", "data", "response", "total", "claims", "auth_user", "membership", "auth_http", "db", "storage", "proxy"]);

function summary(values) {
  const sorted = [...values].sort((a, b) => a - b);
  const percentile = (fraction) => Number(sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * fraction) - 1)].toFixed(2));
  return { samples: sorted.length, p50_ms: percentile(.5), p95_ms: percentile(.95), p99_ms: percentile(.99) };
}

async function request(route) {
  const started = performance.now();
  const url = new URL(route, base);
  const cookieHeader = cookies.filter((cookie) => url.pathname.startsWith(cookie.path ?? "/")).map((cookie) => `${cookie.name}=${cookie.value}`).join("; ");
  const response = await fetch(url, {
    redirect: "manual", signal: AbortSignal.timeout(30_000),
    headers: cookieHeader ? { cookie: cookieHeader } : {},
  });
  const ttfb = performance.now() - started;
  const bytes = (await response.arrayBuffer()).byteLength;
  const timing = {};
  for (const span of (response.headers.get("server-timing") ?? "").split(",")) {
    const match = /^\s*([a-z_]+);dur=([\d.]+)/.exec(span);
    if (match && allowedStages.has(match[1])) timing[match[1]] = Number(match[2]);
  }
  return { status: response.status, ttfb, duration: performance.now() - started, bytes, cache_control: response.headers.get("cache-control"), timing };
}

const result = { target: base.origin, captured_at: new Date().toISOString(), session_file_supplied: args.has("--storage-state"), cookies_sent: cookies.length > 0, scope: "read-only HTTP requests; no credentials, cookies, bodies or personal data stored", routes: {} };
for (const route of routes) {
  const first = await request(route);
  const rows = [];
  for (let index = 0; index < samples; index++) rows.push(await request(route));
  const concurrent = [];
  for (let batch = 0; batch < 5; batch++) concurrent.push(...await Promise.all(Array.from({ length: concurrency }, () => request(route))));
  const stages = [...new Set(rows.flatMap((row) => Object.keys(row.timing)))];
  const record = {
    first_request_ms: Number(first.duration.toFixed(2)), statuses: [...new Set(rows.map((row) => row.status))],
    duration: summary(rows.map((row) => row.duration)), ttfb: summary(rows.map((row) => row.ttfb)),
    concurrent: { concurrency, ...summary(concurrent.map((row) => row.duration)) },
    stages: Object.fromEntries(stages.map((stage) => [stage, summary(rows.map((row) => row.timing[stage]).filter((value) => value !== undefined))])),
    response_bytes: first.bytes, cache_control: first.cache_control,
  };
  result.routes[route] = record;
  console.log(route, JSON.stringify(record));
}
await mkdir(path.dirname(output), { recursive: true });
await writeFile(output, JSON.stringify(result, null, 2));
console.log(`Saved metrics to ${path.relative(process.cwd(), output)}`);
