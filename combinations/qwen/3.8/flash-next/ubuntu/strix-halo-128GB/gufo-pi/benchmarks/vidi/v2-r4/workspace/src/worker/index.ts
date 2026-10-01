import { isValidBoardId } from '../shared/board-id';
export { BoardRoom } from './board-room';

export interface Env {
  BOARD_ROOM: DurableObjectNamespace;
  ASSETS: Fetcher;
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
    return env.ASSETS.fetch(req);
  },
};
