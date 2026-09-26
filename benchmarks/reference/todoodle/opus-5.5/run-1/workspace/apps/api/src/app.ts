import { Hono } from 'hono';
import type { Env, Variables } from './env.ts';
import { errorResponse, logRequestError } from './lib/errors.ts';
import { requestId } from './middleware/request-id.ts';
import { securityHeaders } from './middleware/security-headers.ts';
import { validate } from './middleware/validate.ts';
import { workspaceAuth } from './middleware/workspace-auth.ts';
import { healthHandler } from './routes/health.ts';
import { testRoutes } from './routes/test.ts';
import { workspaceRoutes, workspacesRoutes } from './routes/workspaces.ts';

export type AppEnv = { Bindings: Env; Variables: Variables };

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

  app.route('/api/workspaces', workspacesRoutes);
  // Every workspace-scoped route sits behind workspace-auth. Later stories add theirs to workspaceRoutes.
  app.use('/api/w/:workspaceId', workspaceAuth);
  app.use('/api/w/:workspaceId/*', workspaceAuth);
  app.route('/api/w/:workspaceId', workspaceRoutes);

  app.all('/api', () => errorResponse('not_found', 404));
  app.all('/api/*', () => errorResponse('not_found', 404));

  // Everything that is not an API, health or test route is the SPA or a static asset.
  app.all('*', (c) => c.env.ASSETS.fetch(c.req.raw));

  app.onError((err, c) => {
    // Sanitised: never headers, cookies, bodies, stack traces or URL query/fragment.
    logRequestError({
      requestId: c.get('requestId'),
      method: c.req.method,
      pathname: new URL(c.req.url).pathname,
      status: 500,
      errorName: err.name,
      errorMessage: err.message,
    });
    return errorResponse('internal', 500);
  });

  return app;
}

export const app = createApp();
