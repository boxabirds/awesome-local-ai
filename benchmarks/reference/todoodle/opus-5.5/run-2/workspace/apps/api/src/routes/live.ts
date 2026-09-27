import { Hono } from 'hono';
import type { AppEnv } from '../app';
import { errorResponse } from '../lib/errors';
import { workspaceAuth } from '../middleware/workspace-auth';

/**
 * GET /api/w/:id/live: the workspace's live socket. Mounted before the app-wide workspace-auth so
 * the Origin check runs first (a hostile origin learns nothing about existence). WebSocket
 * upgrades can't carry X-Todoodle-Client, so the exact same-origin match is the CSRF defence.
 */
export const liveRoutes = new Hono<AppEnv>();

liveRoutes.get(
  '/w/:workspaceId/live',
  async (c, next) => {
    if (c.req.header('Upgrade')?.toLowerCase() !== 'websocket') return errorResponse('upgrade_required', 426);
    if (c.req.header('Origin') !== new URL(c.req.url).origin) return errorResponse('forbidden_client', 403);
    await next();
  },
  workspaceAuth,
  (c) => {
    const room = c.env.WORKSPACE_ROOM;
    return room.get(room.idFromName(c.get('workspace').id)).fetch(c.req.raw);
  },
);
