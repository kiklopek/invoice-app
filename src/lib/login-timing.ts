// Fixed names and durations only, local to DevTools. No credentials, tokens,
// account identifiers or telemetry requests are recorded.
export async function measureLoginOperation<T>(phase: "credentials" | "environment", operation: () => Promise<T>): Promise<T> {
  const started = performance.now();
  try {
    return await operation();
  } finally {
    try {
      performance.clearMeasures(`splatno:login:${phase}`);
      performance.measure(`splatno:login:${phase}`, { start: started, end: performance.now() });
    } catch {
      // Optional diagnostics must never affect authentication.
    }
  }
}

export function markLoginRedirect() {
  try {
    performance.clearMarks("splatno:login:redirect");
    performance.mark("splatno:login:redirect");
  } catch {
    // Navigation timing on the destination measures the subsequent page load.
  }
}
