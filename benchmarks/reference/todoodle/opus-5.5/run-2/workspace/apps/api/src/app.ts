import { Hono } from 'hono';
import type { Env } from './env';
import { errorResponse } from './lib/errors';
import { requestId } from './middleware/request-id';
import { validate } from './middleware/validate';
import { health } from './routes/health';
import { testRoutes } from './routes/test';

export type AppEnv = { Bindings: Env; Variables: { requestId: string } };

export function createApp() {
  const app = new Hono<AppEnv>();

  app.use('*', requestId);
  app.use('*', validate);

  app.route('/health', health);
  app.route('/api/health', health);
  app.route('/test', testRoutes);

  app.all('/api', () => errorResponse('not_found', 404));
  app.all('/api/*', () => errorResponse('not_found', 404));

  // Everything else is the SPA or a static asset.
  app.all('*', (c) => c.env.ASSETS.fetch(c.req.raw));

  app.onError((err, c) => {
    // Only error details and request coordinates: never headers, cookies, bodies or fragments.
    console.error('unhandled error', {
      name: err.name,
      message: err.message,
      stack: err.stack,
      requestId: c.get('requestId'),
      method: c.req.method,
      path: c.req.path,
    });
    return errorResponse('internal', 500);
  });

  return app;
}

export const app = createApp();
