export function isSameOriginMutation(request: Request) {
  const origin = request.headers.get("origin");
  if (!origin) return true;
  try {
    const source = new URL(origin);
    const target = new URL(request.url);
    if (source.origin === target.origin) return true;
    // Next's development server can normalize 127.0.0.1 to localhost.
    // Never relax origin checks for public hosts or production requests.
    const loopback = new Set(["localhost", "127.0.0.1", "[::1]"]);
    return process.env.NODE_ENV !== "production"
      && loopback.has(source.hostname) && loopback.has(target.hostname)
      && source.protocol === target.protocol && source.port === target.port;
  } catch {
    return false;
  }
}
