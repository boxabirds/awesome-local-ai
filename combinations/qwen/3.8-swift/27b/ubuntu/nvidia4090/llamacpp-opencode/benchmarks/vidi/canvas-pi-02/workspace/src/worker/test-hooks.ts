// Test hooks for the persistence e2e suite: POST /_test/:boardId/corrupt-snapshot
// and /_test/:boardId/repair-snapshot, which damage and restore the board's
// snapshot chunk 0 and force the room to reload from storage on its next
// connection. These routes exist ONLY when env.TEST_HOOKS === '1'
// (wrangler.e2e.jsonc); a production build (wrangler.jsonc) gets 404 here, so
// the hooks cannot be triggered in production (persist.load_failure e2e).

import type { BoardRoom } from './board-room';

export async function testHookRoute(
  req: Request,
  boardRoom: DurableObjectStub<BoardRoom>,
): Promise<Response> {
  const url = new URL(req.url);
  const parts = url.pathname.split('/').filter(Boolean);
  // /_test/:boardId/corrupt-snapshot | /_test/:boardId/repair-snapshot
  if (parts.length !== 3 || parts[0] !== '_test') {
    return json(404, { error: 'unknown test hook' });
  }
  const action = parts[2];
  if (action === 'state') {
    if (req.method !== 'GET') {
      return json(405, { error: 'use GET' });
    }
    const state = await boardRoom.testGetState();
    return json(200, state);
  }
  if (req.method !== 'POST') {
    return json(405, { error: 'use POST' });
  }
  if (action === 'compact') {
    const done = await boardRoom.testCompact();
    return json(200, { ok: done, compacted: done });
  }
  if (action === 'corrupt-snapshot') {
    const chunks = await boardRoom.testCorruptSnapshot();
    return json(200, { ok: chunks > 0, chunksCorrupted: chunks });
  }
  if (action === 'repair-snapshot') {
    const chunks = await boardRoom.testRepairSnapshot();
    return json(200, { ok: chunks > 0, chunksRestored: chunks });
  }
  return json(404, { error: `unknown test hook '${action}'` });
}

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}
