const SECURITY_HEADERS: Record<string, string> = {
  "X-Content-Type-Options": "nosniff",
  "X-Frame-Options": "DENY",
  "Referrer-Policy": "strict-origin-when-cross-origin",
  "Content-Security-Policy": "frame-ancestors 'none'",
};

export const REQUEST_ID_HEADER = "X-Request-Id";
export const MAX_BODY_BYTES = 1024 * 1024;

export function newRequestId(): string {
  return crypto.randomUUID();
}

/** Adds security headers and the request id to an API response. */
export function finalize(response: Response, requestId: string): Response {
  const out = new Response(response.body, response);
  for (const [key, value] of Object.entries(SECURITY_HEADERS)) out.headers.set(key, value);
  out.headers.set(REQUEST_ID_HEADER, requestId);
  // API responses are per-request state; never let an intermediary cache them.
  if (!out.headers.has("Cache-Control")) out.headers.set("Cache-Control", "no-store");
  return out;
}

export function corsHeaders(allowedOrigin: string | undefined): Record<string, string> {
  if (!allowedOrigin) return {};
  return {
    "Access-Control-Allow-Origin": allowedOrigin,
    "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Max-Age": "86400",
    Vary: "Origin",
  };
}

export function json(body: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(body), {
    ...init,
    headers: { "Content-Type": "application/json; charset=utf-8", ...(init.headers ?? {}) },
  });
}

export function errorResponse(status: number, code: string, message: string): Response {
  return json({ error: { code, message } }, { status });
}

/** Rejects malformed or oversized requests before any routing work happens. */
export async function validateRequest(request: Request): Promise<Response | null> {
  const allowedMethods = ["GET", "POST", "OPTIONS", "HEAD"];
  if (!allowedMethods.includes(request.method)) {
    return errorResponse(405, "method_not_allowed", "Method not allowed");
  }

  if (request.method === "POST") {
    const contentType = request.headers.get("Content-Type") ?? "";
    if (!contentType.includes("application/json")) {
      return errorResponse(415, "unsupported_media_type", "Expected application/json");
    }
    const declaredLength = Number(request.headers.get("Content-Length") ?? "0");
    if (declaredLength > MAX_BODY_BYTES) {
      return errorResponse(413, "payload_too_large", "Request body too large");
    }
  }

  return null;
}
