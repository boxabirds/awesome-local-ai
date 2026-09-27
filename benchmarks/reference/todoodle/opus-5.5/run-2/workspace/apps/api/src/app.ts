import { Hono } from 'hono';
import type { AppVariables, Env } from './env';
import { errorResponse, logRequestError } from './lib/errors';
import { requestId } from './middleware/request-id';
import { validate } from './middleware/validate';
import { workspaceAuth } from './middleware/workspace-auth';
import { countRoutes } from './routes/counts';
import { health } from './routes/health';
import { liveRoutes } from './routes/live';
import { rememberedRoutes } from './routes/remembered';
import { taskRoutes } from './routes/tasks';
import { testRoutes } from './routes/test';
import { workspaceRoutes } from './routes/workspaces';

export type AppEnv = { Bindings: Env; Variables: AppVariables };

export function createApp() {
  const app = new Hono<AppEnv>();

  app.use('*', requestId);
  app.use('*', validate);

  app.route('/health', health);
  app.route('/api/health', health);
  app.route('/test', testRoutes);
  // The live socket runs its Upgrade and Origin checks before workspace-auth (see routes/live.ts).
  app.route('/api', liveRoutes);
  // Every workspace-scoped route (stories 2 to 8) sits behind workspace-auth.
  app.use('/api/w/:workspaceId', workspaceAuth);
  app.use('/api/w/:workspaceId/*', workspaceAuth);
  app.route('/api/remembered', rememberedRoutes);
  app.route('/api/w/:workspaceId/tasks', taskRoutes);
  app.route('/api/w/:workspaceId/counts', countRoutes);
  app.route('/api', workspaceRoutes);

  app.all('/api', () => errorResponse('not_found', 404));
  app.all('/api/*', () => errorResponse('not_found', 404));

  // Everything else is the SPA or a static asset.
  app.all('*', (c) => c.env.ASSETS.fetch(c.req.raw));

  app.onError((err, c) => {
    logRequestError({
      requestId: c.get('requestId'),
      method: c.req.method,
      pathname: c.req.path,
      status: 500,
      errorName: err.name,
      errorMessage: err.message,
    });
    return errorResponse('internal', 500);
  });

  return app;
}

export const app = createApp();
