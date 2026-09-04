import type { Instrumentation } from "next";

function safeError(error: unknown) {
  if (error instanceof Error) {
    return { name: error.name, message: error.message };
  }
  return { name: "UnknownError", message: String(error) };
}

export function register() {
  if (process.env.NODE_ENV === "production" && process.env.EMAIL_MFA_BYPASS_EMAILS?.trim()) {
    throw new Error("EMAIL_MFA_BYPASS_EMAILS must be empty in production");
  }
}

export const onRequestError: Instrumentation.onRequestError = async (error, request, context) => {
  const requestId = request.headers["x-vercel-id"] ?? request.headers["x-request-id"];
  console.error(JSON.stringify({
    level: "error",
    message: "Unhandled request error",
    timestamp: new Date().toISOString(),
    request_id: requestId,
    method: request.method,
    path: request.path,
    route: context.routePath,
    route_type: context.routeType,
    router_kind: context.routerKind,
    error: safeError(error),
  }));
};
