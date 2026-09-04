import "server-only";

type LogValue = string | number | boolean | null | undefined;
type LogContext = Record<string, LogValue>;

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

function clean(context: LogContext) {
  return Object.fromEntries(Object.entries(context).filter(([, value]) => value !== undefined));
}

export function requestId(request: Request) {
  return request.headers.get("x-vercel-id") ??
    request.headers.get("x-request-id") ??
    crypto.randomUUID();
}

export function logInfo(message: string, context: LogContext = {}) {
  console.log(JSON.stringify({ level: "info", message, timestamp: new Date().toISOString(), ...clean(context) }));
}

export function logError(message: string, error: unknown, context: LogContext = {}) {
  console.error(JSON.stringify({
    level: "error",
    message,
    error: errorMessage(error),
    timestamp: new Date().toISOString(),
    ...clean(context),
  }));
}
