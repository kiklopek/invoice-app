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

/**
 * Reads a short-lived Supabase access token used only while bootstrapping a
 * freshly-created browser session. The token is still verified by Supabase on
 * the server; this helper deliberately performs no JWT decoding or trust.
 */
export function getBearerAccessToken(request: Request) {
  const authorization = request.headers.get("authorization")?.trim();
  if (!authorization) return null;
  const match = /^Bearer\s+([^\s]+)$/i.exec(authorization);
  return match?.[1] ?? null;
}
