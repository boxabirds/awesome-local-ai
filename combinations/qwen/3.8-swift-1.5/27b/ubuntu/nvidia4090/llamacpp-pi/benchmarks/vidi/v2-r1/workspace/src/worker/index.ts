import { isValidBoardId } from '../shared/board-id';
import { BoardRoom } from './board-room';

export interface Env {
  BOARD_ROOM: DurableObjectNamespace<BoardRoom>;
  ASSETS: Fetcher;
  TEST_HOOKS?: string;
}

const worker = {
  async fetch(req: Request, env: Env): Promise<Response> {
    const url = new URL(req.url);

    // Route /api/rooms/:boardId to the BoardRoom Durable Object
    if (url.pathname.startsWith('/api/rooms/')) {
      const boardId = url.pathname.slice('/api/rooms/'.length);

      if (!isValidBoardId(boardId)) {
        return new Response('Bad Request', { status: 400 });
      }

      const upgradeHeader = req.headers.get('Upgrade');
      if (upgradeHeader !== 'websocket') {
        return new Response('Upgrade Required', { status: 426 });
      }

      const id = env.BOARD_ROOM.idFromName(boardId);
      const stub = env.BOARD_ROOM.get(id);
      return stub.fetch(req);
    }

    // Test storage endpoint: /__test/storage/:boardId
    if (url.pathname.startsWith('/__test/storage/')) {
      const boardId = url.pathname.slice('/__test/storage/'.length);

      if (!isValidBoardId(boardId)) {
        return new Response('Bad Request', { status: 400 });
      }

      const id = env.BOARD_ROOM.idFromName(boardId);
      const stub = env.BOARD_ROOM.get(id);
      const testReq = new Request(`http://internal/__test/storage`, {
        method: req.method,
        headers: req.headers,
        body: req.body,
      });
      return stub.fetch(testReq);
    }

    // Test hooks endpoints (only when TEST_HOOKS is enabled)
    if (env.TEST_HOOKS === '1' && url.pathname.startsWith('/__test/')) {
      return handleTestHooks(req, env);
    }

    // Everything else goes to static assets
    if (env.ASSETS) {
      return env.ASSETS.fetch(req);
    }
    // Fallback for test environments without assets binding
    return new Response('<html><head><title>vidi6</title></head><body><div id="root"></div></body></html>', {
      status: 200,
      headers: { 'Content-Type': 'text/html' },
    });
  },
} satisfies ExportedHandler<Env>;

async function handleTestHooks(req: Request, env: Env): Promise<Response> {
  const url = new URL(req.url);

  // POST /__test/boards/:id/corrupt-snapshot
  const corruptMatch = url.pathname.match(/^\/__test\/boards\/([A-Za-z0-9_-]{22})\/corrupt-snapshot$/);
  if (corruptMatch && req.method === 'POST') {
    const boardId = corruptMatch[1];
    const id = env.BOARD_ROOM.idFromName(boardId);
    const stub = env.BOARD_ROOM.get(id);

    // Get the original chunk 0
    const getReq = new Request('http://internal/__test/storage', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ operation: 'get-snapshot-chunk', data: { idx: 0 } }),
    });
    const getResp = await stub.fetch(getReq);
    const getData = await getResp.json();

    if (!getData.ok || !getData.data) {
      return Response.json({ error: 'no snapshot chunk 0' }, { status: 404 });
    }

    const originalBytes: number[] = getData.data;

    // Corrupt by flipping all bytes
    const corrupted = originalBytes.map((b: number) => b ^ 0xFF);

    const corruptReq = new Request('http://internal/__test/storage', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ operation: 'corrupt-snapshot-chunk', data: { idx: 0, damagedBytes: corrupted } }),
    });
    await stub.fetch(corruptReq);

    // Save original for repair
    const b64 = Buffer.from(originalBytes).toString('base64');
    const saveReq = new Request('http://internal/__test/storage', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ operation: 'execute', data: { query: 'INSERT OR REPLACE INTO storage_meta (key, value) VALUES (?, ?)', params: ['__test_original_chunk0', b64] } }),
    });
    await stub.fetch(saveReq);

    return Response.json({ ok: true });
  }

  // POST /__test/boards/:id/repair
  const repairMatch = url.pathname.match(/^\/__test\/boards\/([A-Za-z0-9_-]{22})\/repair$/);
  if (repairMatch && req.method === 'POST') {
    const boardId = repairMatch[1];
    const id = env.BOARD_ROOM.idFromName(boardId);
    const stub = env.BOARD_ROOM.get(id);

    // Get the saved original
    const getReq = new Request('http://internal/__test/storage', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ operation: 'query', data: { query: "SELECT value FROM storage_meta WHERE key = '__test_original_chunk0'" } }),
    });
    const getResp = await stub.fetch(getReq);
    const getData = await getResp.json();

    if (!getData.ok || !getData.rows || getData.rows.length === 0) {
      return Response.json({ error: 'no saved original' }, { status: 404 });
    }

    const originalBytes = Array.from(Buffer.from(getData.rows[0].value, 'base64'));

    const repairReq = new Request('http://internal/__test/storage', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ operation: 'restore-snapshot-chunk', data: { idx: 0, bytes: originalBytes } }),
    });
    await stub.fetch(repairReq);

    return Response.json({ ok: true });
  }

  return new Response('Not Found', { status: 404 });
}

export default worker;
export { BoardRoom };
