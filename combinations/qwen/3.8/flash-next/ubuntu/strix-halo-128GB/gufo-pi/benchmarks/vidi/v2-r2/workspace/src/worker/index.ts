import { isValidBoardId } from '@shared/board-id';
import { createBoard } from './create-board';
import { BoardRoom } from './board-room';

export interface Env {
  BOARD_ROOM: DurableObjectNamespace<BoardRoom>;
  ASSETS: Fetcher;
  // Set to '1' to enable the /__test/* control routes (used by e2e persistence and
  // broken-board specs). Never set in production.
  TEST_HOOKS?: string;
}

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    const url = new URL(req.url);

    // Test-only control routes, enabled when TEST_HOOKS=1 (e2e persistence specs).
    if (env.TEST_HOOKS === "1") {
      const hook = url.pathname.match(/^\/__(?:test)\/([a-z-]+)$/);
      if (hook) {
        const room = url.searchParams.get("room");
        if (!room || !isValidBoardId(room)) {
          return Response.json({ ok: false, error: "bad room" }, { status: 400 });
        }
        const stub = env.BOARD_ROOM.get(env.BOARD_ROOM.idFromName(room));
        switch (hook[1]) {
          case "seed": {
            const count = Number(url.searchParams.get("count") ?? "100");
            const seed = Number(url.searchParams.get("seed") ?? "1");
            const notes = await stub.__testSeed(count, seed);
            return Response.json({ ok: true, notes });
          }
          case "note-count":
            return Response.json({ ok: true, notes: await stub.__testNoteCount() });
          case "corrupt-snapshot":
            await stub.__testCorruptSnapshot();
            return Response.json({ ok: true });
          case "repair-snapshot":
            await stub.__testRepairSnapshot();
            return Response.json({ ok: true });
          case "reload":
            await stub.__testReload();
            return Response.json({ ok: true, state: await stub.__testGetState() });
          case "state":
            return Response.json({
              ok: true,
              state: await stub.__testGetState(),
              loadMs: await stub.__testLoadMs(),
              notes: await stub.__testNoteCount(),
            });
          default:
            return Response.json({ ok: false, error: "unknown hook" }, { status: 404 });
        }
      }
    }

    // Board creation / existence API (story 5).
    if (url.pathname === '/api/boards') {
      if (req.method !== 'POST') {
        return new Response('Method Not Allowed', { status: 405 });
      }
      const result = await createBoard(env);
      if (result.ok) {
        return Response.json({ id: result.id }, { status: 201 });
      }
      return Response.json({ error: 'create_failed' }, { status: 500 });
    }

    const boardMatch = url.pathname.match(/^\/api\/boards\/([^/]+)$/);
    if (boardMatch) {
      const boardId = decodeURIComponent(boardMatch[1]);
      // Malformed ids are rejected before touching the namespace, so they never
      // instantiate a Durable Object (TC-07). Unknown ids return the same 404
      // (no distinction, nothing leaked).
      if (!isValidBoardId(boardId)) {
        return Response.json({ error: 'not_found' }, { status: 404 });
      }
      const stub = env.BOARD_ROOM.get(env.BOARD_ROOM.idFromName(boardId));
      const exists = await stub.exists();
      if (!exists) {
        return Response.json({ error: 'not_found' }, { status: 404 });
      }
      return Response.json({ id: boardId }, { status: 200 });
    }

    // Route /api/rooms/:boardId to the Durable Object
    const match = url.pathname.match(/^\/api\/rooms\/([^/]+)$/);
    if (match) {
      const boardId = match[1];
      if (!isValidBoardId(boardId)) {
        return new Response('Not Found: unknown board', { status: 404 });
      }
      if (req.headers.get('Upgrade')?.toLowerCase() !== 'websocket') {
        return new Response('Upgrade Required', { status: 426 });
      }
      const doId = env.BOARD_ROOM.idFromName(boardId);
      const stub = env.BOARD_ROOM.get(doId);
      return stub.fetch(req);
    }

    // Everything else goes to static assets
    return env.ASSETS.fetch(req);
  },
};

export { BoardRoom };
