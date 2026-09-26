import { app } from './app.ts';
import type { Env } from './env.ts';

// Durable Object classes must be exported from the Worker entry so wrangler can bind them.
export { WorkspaceRoom } from './live/WorkspaceRoom.ts';

export default {
  fetch(request, env, ctx) {
    return app.fetch(request, env, ctx);
  },
} satisfies ExportedHandler<Env>;
