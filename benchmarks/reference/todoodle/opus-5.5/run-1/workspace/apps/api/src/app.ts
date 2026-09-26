import { Hono } from 'hono';
import type { Env } from './env.ts';
import { errorResponse } from './lib/errors.ts';
import { requestId } from './middleware/request-id.ts';
import { securityHeaders } from './middleware/security-headers.ts';
import { validate } from './middleware/validate.ts';
import { healthHandler } from './routes/health.ts';
import { testRoutes } from './routes/test.ts';

export type AppEnv = { Bindings: Env; Variables: { requestId: string } };

export function createApp() {
  const app = new Hono<AppEnv>();

  app.use('*', securityHeaders);
  app.use('*', requestId);
  app.use('*', validate);

  for (const path of ['/health', '/api/health']) {
    app.get(path, healthHandler);
    app.all(path, () => errorResponse('method_not_allowed', 405));
  }

  app.route('/test', testRoutes);

  app.all('/api', () => errorResponse('not_found', 404));
  app.all('/api/*', () => errorResponse('not_found', 404));

  // Everything that is not an API, health or test route is the SPA or a static asset.
  app.all('*', (c) => c.env.ASSETS.fetch(c.req.raw));

  app.onError((err, c) => {
    // Log only what helps diagnose the failure. Never headers, cookies, bodies or URL query/fragment.
    console.error('unhandled error', {
      name: err.name,
      message: err.message,
      stack: err.stack,
      requestId: c.get('requestId'),
      method: c.req.method,
      path: new URL(c.req.url).pathname,
    });
    return errorResponse('internal', 500);
  });

  return app;
}

export const app = createApp();
