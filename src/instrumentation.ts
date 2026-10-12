import type { Instrumentation } from "next";

function safeError(error: unknown) {
  if (error instanceof Error) {
    const digest = "digest" in error && typeof error.digest === "string" && /^[a-f0-9]{1,64}$/i.test(error.digest) ? error.digest : undefined;
    const safeNames = ["Error", "TypeError", "RangeError", "SyntaxError", "ReferenceError", "AuthApiError"];
    return { name: safeNames.includes(error.name) ? error.name : "Error", digest };
  }
  return { name: "UnknownError" };
}

export function register() {
  if (process.env.NODE_ENV === "production" && process.env.EMAIL_MFA_BYPASS_EMAILS?.trim()) {
    throw new Error("EMAIL_MFA_BYPASS_EMAILS must be empty in production");
  }
}

export const onRequestError: Instrumentation.onRequestError = async (error, request, context) => {
  const rawId = request.headers["x-vercel-id"] ?? request.headers["x-request-id"];
  const requestId = typeof rawId === "string" && /^(?:[a-z0-9]{3,5}::[a-z0-9-]{1,100}|[0-9a-f-]{36})$/i.test(rawId) ? rawId : undefined;
  console.error(JSON.stringify({
    level: "error",
    message: "Unhandled request error",
    timestamp: new Date().toISOString(),
    request_id: requestId,
    method: request.method,
    // Raw paths can contain recovery tokens, invitation tokens and searches.
    path: context.routePath,
    route: context.routePath,
    route_type: context.routeType,
    router_kind: context.routerKind,
    error: safeError(error),
  }));
};
