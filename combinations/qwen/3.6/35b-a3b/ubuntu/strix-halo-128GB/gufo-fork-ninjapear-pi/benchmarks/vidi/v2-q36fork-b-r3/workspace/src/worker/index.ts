/** Worker entry point for story 4 — persistent boards */

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

    // Route /api/rooms/* 
    if (url.pathname.startsWith('/api/rooms/')) {
      const boardIdPath = url.pathname.split('?')[0].slice('/api/rooms/'.length);

      // Validate board id
      if (!isValidBoardId(boardIdPath)) {
        return new Response('Bad Request: invalid board id', { status: 400 });
      }

      // Get or create the BoardRoom Durable Object instance
      const roomId = env.BOARD_ROOM.idFromName(boardIdPath);
      const room = env.BOARD_ROOM.get(roomId);

      // Delegate to the Durable Object
      return room.fetch(request);
    }

    // All other routes — serve static assets
    return new Response('', {
      status: 200,
      headers: { 'Content-Type': 'text/html' },
    });
  },
};
