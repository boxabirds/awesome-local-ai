import type { MiddlewareHandler } from 'hono';
import type { AppEnv } from '../app';
import { finalizeResponse } from './security-headers';

/** Outermost middleware: assigns the request id and finalizes every response on the way out. */
export const requestId: MiddlewareHandler<AppEnv> = async (c, next) => {
  const id = crypto.randomUUID();
  c.set('requestId', id);
  await next();
  const finalized = finalizeResponse(c.res, { requestId: id, path: c.req.path });
  // Hono's `c.res` setter merges the previous response's headers over the new one, which would
  // let a handler's own Referrer-Policy win. Clear it first so the finalized headers stand.
  c.res = undefined;
  c.res = finalized;
};
