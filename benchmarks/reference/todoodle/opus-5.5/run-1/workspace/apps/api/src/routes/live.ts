import type { Context, MiddlewareHandler } from 'hono';
import type { AppEnv } from '../app.ts';
import { errorResponse } from '../lib/errors.ts';

/**
 * Checks for GET /api/w/:workspaceId/live that run BEFORE workspace-auth. A WebSocket upgrade cannot
 * carry X-Todoodle-Client, so CSRF protection is an exact Origin match. Checking it first means a
 * hostile origin learns nothing about whether the workspace exists.
 */
export const liveUpgradeGuard: MiddlewareHandler<AppEnv> = async (c, next) => {
  if (c.req.header('Upgrade')?.toLowerCase() !== 'websocket') return errorResponse('upgrade_required', 426);
  if (c.req.header('Origin') !== new URL(c.req.url).origin) return errorResponse('forbidden_client', 403);
  await next();
};

/** After workspace-auth: hand the upgrade to this workspace's room, which answers 101. */
export function forwardToRoom(c: Context<AppEnv>): Promise<Response> {
  const room = c.env.WORKSPACE_ROOM.get(c.env.WORKSPACE_ROOM.idFromName(c.var.workspace.id));
  return room.fetch(c.req.raw);
}
