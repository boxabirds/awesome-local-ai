import type { MiddlewareHandler } from 'hono';
import type { AppEnv } from '../app.ts';

/** Assigns every request a fresh id, exposed as the X-Request-Id response header and in error logs. */
export const requestId: MiddlewareHandler<AppEnv> = async (c, next) => {
  c.set('requestId', crypto.randomUUID());
  await next();
};
