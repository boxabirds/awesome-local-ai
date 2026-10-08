/** Worker entry point for story 3 */

import { isValidBoardId } from '@shared/board-id';
export { BoardRoom } from './board-room';

export interface Env {
  BOARD_ROOM: DurableObjectNamespace;
}

export default {
  async fetch(
    request: Request,
    env: Env,
    ctx: ExecutionContext,
  ): Promise<Response> {
    const url = new URL(request.url);

    // Route WebSocket upgrades to board room
    if (url.pathname.startsWith('/api/rooms/')) {
      const boardId = url.pathname.slice('/api/rooms/'.length);

      // Validate board id
      if (!isValidBoardId(boardId)) {
        return new Response('Bad Request: invalid board id', { status: 400 });
      }

      // Check for Upgrade header
      const upgrade = request.headers.get('upgrade')?.toLowerCase();
      if (upgrade !== 'websocket') {
        return new Response('Upgrade Required', { status: 426 });
      }

      // Get or create the BoardRoom Durable Object instance
      const roomId = env.BOARD_ROOM.idFromName(boardId);
      const room = env.BOARD_ROOM.get(roomId);

      // Delegate the upgrade to the Durable Object
      return room.fetch(request);
    }

    // All other routes — serve static assets
    return new Response('', {
      status: 200,
      headers: { 'Content-Type': 'text/html' },
    });
  },
};
