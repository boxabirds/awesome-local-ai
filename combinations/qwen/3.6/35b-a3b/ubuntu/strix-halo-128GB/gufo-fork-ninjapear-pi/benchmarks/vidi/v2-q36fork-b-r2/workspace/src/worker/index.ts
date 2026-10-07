import { isValidBoardId, newBoardId } from '../shared/board-id';
export { BoardRoom } from './board-room';
export { isValidBoardId, newBoardId };

const BOARD_ROOM = 'BOARD_ROOM' as unknown as string;

export default {
  async fetch(
    request: Request,
    env: { BOARD_ROOM?: DurableObjectNamespace },
    _ctx: { waitUntil: (p: Promise<void>) => void },
  ): Promise<Response> {
    const url = new URL(request.url);

    // Route WebSocket upgrades to /api/rooms/:boardId
    if (url.pathname.startsWith('/api/rooms/')) {
      const boardId = url.pathname.slice('/api/rooms/'.length);
      if (!isValidBoardId(boardId)) {
        return new Response('Bad Request — invalid board id', { status: 400 });
      }
      if (!request.headers.get('Upgrade')?.toLowerCase().includes('websocket')) {
        return new Response(
          'Upgrade Required — WebSocket connection expected',
          { status: 426 },
        );
      }
      const room = env.BOARD_ROOM!.get(
        env.BOARD_ROOM!.idFromName(boardId),
      );
      return room.fetch(request);
    }

    // Everything else served as static assets (SPA fallback)
    // In production, ASSETS binding handles this. Here we let miniflare serve them.
    return new Response('Assets not configured', { status: 500 });
  },
};
