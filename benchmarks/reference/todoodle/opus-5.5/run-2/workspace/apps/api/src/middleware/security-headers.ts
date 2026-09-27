const BASELINE_HEADERS: Record<string, string> = {
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'Content-Security-Policy': "default-src 'self'; connect-src 'self' wss:; frame-ancestors 'none'",
  // Workspace links are credentials: never leak them through the Referer header.
  'Referrer-Policy': 'no-referrer',
};

const PRIVATE_PATH_PREFIXES = ['/api', '/health', '/test'];

function isPrivatePath(path: string): boolean {
  return PRIVATE_PATH_PREFIXES.some((prefix) => path === prefix || path.startsWith(`${prefix}/`));
}

/**
 * Applies the baseline protections to any response (API, asset or SPA). Baseline values always
 * override whatever the handler set; status and body are preserved.
 */
export function finalizeResponse(res: Response, ctx: { requestId: string; path: string }): Response {
  // A WebSocket upgrade passes through untouched: rebuilding it would drop `webSocket`.
  if (res.status === 101) return res;
  // Copy: responses from fetch/ASSETS have immutable headers.
  const out = new Response(res.body, res);
  for (const [name, value] of Object.entries(BASELINE_HEADERS)) out.headers.set(name, value);
  out.headers.set('X-Request-Id', ctx.requestId);
  if (isPrivatePath(ctx.path)) out.headers.set('Cache-Control', 'no-store');
  return out;
}
