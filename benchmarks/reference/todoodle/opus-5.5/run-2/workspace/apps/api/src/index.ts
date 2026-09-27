import { app } from './app';
import type { Env } from './env';

export { WorkspaceRoom } from './live/WorkspaceRoom';

export default {
  fetch(request, env, ctx) {
    return app.fetch(request, env, ctx);
  },
} satisfies ExportedHandler<Env>;
