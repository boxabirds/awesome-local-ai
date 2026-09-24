/**
 * Worker entry: `/api/rooms/:boardId` WebSocket upgrades go to that board's BoardRoom Durable
 * Object; everything else is served from the static client assets (SPA fallback).
 */
import { isValidBoardId } from '../shared/board-id';
import type { BoardRoom } from './board-room';
import { handleTestHook } from './test-hooks';

export { BoardRoom } from './board-room';

export interface Env {
  BOARD_ROOM: DurableObjectNamespace<BoardRoom>;
  ASSETS: Fetcher;
  /** '1' only in e2e test servers: enables the routes in test-hooks.ts. Never set in production. */
  TEST_HOOKS?: string;
}

const ROOMS_PREFIX = '/api/rooms/';
const HTTP_BAD_REQUEST = 400;
const HTTP_UPGRADE_REQUIRED = 426;

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    const { pathname } = new URL(req.url);
    if (!pathname.startsWith(ROOMS_PREFIX)) return (await handleTestHook(req, env)) ?? env.ASSETS.fetch(req);

    const boardId = pathname.slice(ROOMS_PREFIX.length);
    // Checked before any Durable Object is addressed, so junk ids never create an instance.
    if (!isValidBoardId(boardId)) return new Response('Invalid board id', { status: HTTP_BAD_REQUEST });
    if (req.headers.get('Upgrade')?.toLowerCase() !== 'websocket') {
      return new Response('Expected a WebSocket upgrade', {
        status: HTTP_UPGRADE_REQUIRED,
        headers: { Upgrade: 'websocket' },
      });
    }
    // One object per board (isolation). No participant counting: capacity is a soft target.
    const room = env.BOARD_ROOM.get(env.BOARD_ROOM.idFromName(boardId));
    return room.fetch(req);
  },
} satisfies ExportedHandler<Env>;
