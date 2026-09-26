import type { MiddlewareHandler } from 'hono';
import type { AppEnv } from '../app.ts';

export const CONTENT_SECURITY_POLICY = "default-src 'self'; connect-src 'self' wss:; frame-ancestors 'none'";

const NO_STORE_PREFIXES = ['/api', '/health', '/test'];

/** Paths whose responses may hold private data and must never be cached. Hashed assets stay cacheable. */
function isNoStorePath(path: string): boolean {
  return NO_STORE_PREFIXES.some((prefix) => path === prefix || path.startsWith(`${prefix}/`));
}

/**
 * Applies the baseline protections to any response (API, error, SPA or asset). Returns a new Response
 * (except for a 101 WebSocket upgrade, returned as is), so immutable responses (e.g. from ASSETS) can be finalized. Status and body are preserved;
 * baseline headers override anything the handler set.
 */
export function finalizeResponse(res: Response, ctx: { requestId: string; path: string }): Response {
  // A 101 carries the client end of a WebSocket; rebuilding it would drop `webSocket`. Pass it through untouched.
  if (res.status === 101) return res;
  const out = new Response(res.body, res);
  out.headers.set('X-Request-Id', ctx.requestId);
  out.headers.set('X-Content-Type-Options', 'nosniff');
  out.headers.set('X-Frame-Options', 'DENY');
  out.headers.set('Content-Security-Policy', CONTENT_SECURITY_POLICY);
  out.headers.set('Referrer-Policy', 'no-referrer');
  if (isNoStorePath(ctx.path)) out.headers.set('Cache-Control', 'no-store');
  return out;
}

/** Outermost middleware: finalizes whatever response the rest of the pipeline produced (including errors). */
export const securityHeaders: MiddlewareHandler<AppEnv> = async (c, next) => {
  await next();
  if (c.res.status === 101) return;
  const finalized = finalizeResponse(c.res, { requestId: c.get('requestId'), path: new URL(c.req.url).pathname });
  // Clear first: Hono's res setter would otherwise copy the old response's headers over the new ones.
  c.res = undefined;
  c.res = finalized;
};
