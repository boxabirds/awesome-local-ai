import { isValidBoardId } from '../shared/board-id';
export { BoardRoom } from './board-room';

export interface Env {
  BOARD_ROOM: DurableObjectNamespace;
  ASSETS: Fetcher;
  TEST_HOOKS?: string;
}

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    const url = new URL(req.url);
    const match = url.pathname.match(/^\/api\/rooms\/([^/]+)$/);
    if (match) {
      const boardId = match[1];
      if (!isValidBoardId(boardId)) {
        return new Response('Bad Request', { status: 400 });
      }
      const upgradeHeader = req.headers.get('Upgrade');
      if (upgradeHeader !== 'websocket') {
        return new Response('Upgrade Required', { status: 426 });
      }
      const doId = env.BOARD_ROOM.idFromName(boardId);
      const stub = env.BOARD_ROOM.get(doId);
      return stub.fetch(req);
    }
    // Test-only storage corruption/repair endpoints
    if (env.TEST_HOOKS === '1' && url.pathname === '/api/test-hooks/corrupt-board') {
      const boardId = url.searchParams.get('boardId');
      if (!boardId || !isValidBoardId(boardId)) {
        return new Response('Bad Request', { status: 400 });
      }
      const doId = env.BOARD_ROOM.idFromName(boardId);
      const stub = env.BOARD_ROOM.get(doId);
      return stub.fetch(new Request('http://internal/test-corrupt', { method: 'POST' }));
    }
    if (env.TEST_HOOKS === '1' && url.pathname === '/api/test-hooks/repair-board') {
      const boardId = url.searchParams.get('boardId');
      if (!boardId || !isValidBoardId(boardId)) {
        return new Response('Bad Request', { status: 400 });
      }
      const doId = env.BOARD_ROOM.idFromName(boardId);
      const stub = env.BOARD_ROOM.get(doId);
      return stub.fetch(new Request('http://internal/test-repair', { method: 'POST' }));
    }
    if (env.TEST_HOOKS === '1' && url.pathname === '/api/test-hooks/fail-next-append') {
      const boardId = url.searchParams.get('boardId');
      if (!boardId || !isValidBoardId(boardId)) {
        return new Response('Bad Request', { status: 400 });
      }
      const doId = env.BOARD_ROOM.idFromName(boardId);
      const stub = env.BOARD_ROOM.get(doId);
      return stub.fetch(new Request('http://internal/test-fail-append', { method: 'POST' }));
    }
    if (env.TEST_HOOKS === '1' && url.pathname === '/api/test-hooks/fail-next-load') {
      const boardId = url.searchParams.get('boardId');
      if (!boardId || !isValidBoardId(boardId)) {
        return new Response('Bad Request', { status: 400 });
      }
      const doId = env.BOARD_ROOM.idFromName(boardId);
      const stub = env.BOARD_ROOM.get(doId);
      return stub.fetch(new Request('http://internal/test-fail-load', { method: 'POST' }));
    }

    return env.ASSETS.fetch(req);
  },
};
