/**
 * Test-only storage corruption/repair endpoints.
 * These routes are registered ONLY when `env.TEST_HOOKS === '1'`,
 * which is set only in the e2e wrangler environment, never in production.
 */

import type { Env } from './index';

/**
 * Handle test-only routes. Returns null if the path doesn't match a test route.
 * Only call when TEST_HOOKS is set.
 */
export async function handleTestHook(
  request: Request,
  env: Env,
  url: URL,
): Promise<Response | null> {
  // POST /__test/boards/:id/corrupt-snapshot
  const corruptMatch = url.pathname.match(/^\/__test\/boards\/([^/]+)\/corrupt-snapshot$/);
  if (corruptMatch && request.method === 'POST') {
    const boardId = corruptMatch[1];
    const doId = env.BOARD_ROOM.idFromName(boardId);
    const stub = env.BOARD_ROOM.get(doId);
    const res = await stub.fetch(new Request('http://internal/__test/corrupt-snapshot', {
      method: 'POST',
    }));
    return res;
  }

  // POST /__test/boards/:id/repair-snapshot
  const repairMatch = url.pathname.match(/^\/__test\/boards\/([^/]+)\/repair-snapshot$/);
  if (repairMatch && request.method === 'POST') {
    const boardId = repairMatch[1];
    const doId = env.BOARD_ROOM.idFromName(boardId);
    const stub = env.BOARD_ROOM.get(doId);
    const res = await stub.fetch(new Request('http://internal/__test/repair-snapshot', {
      method: 'POST',
    }));
    return res;
  }

  // POST /__test/boards/:id/reset-state (simulates DO eviction: clears in-memory state)
  const resetMatch = url.pathname.match(/^\/__test\/boards\/([^/]+)\/reset-state$/);
  if (resetMatch && request.method === 'POST') {
    const boardId = resetMatch[1];
    const doId = env.BOARD_ROOM.idFromName(boardId);
    const stub = env.BOARD_ROOM.get(doId);
    const res = await stub.fetch(new Request('http://internal/__test/reset-state', {
      method: 'POST',
    }));
    return res;
  }

  // GET /__test/boards/:id/storage-stats
  const statsMatch = url.pathname.match(/^\/__test\/boards\/([^/]+)\/storage-stats$/);
  if (statsMatch && request.method === 'GET') {
    const boardId = statsMatch[1];
    const doId = env.BOARD_ROOM.idFromName(boardId);
    const stub = env.BOARD_ROOM.get(doId);
    const res = await stub.fetch(new Request('http://internal/__test/storage-stats', {
      method: 'GET',
    }));
    return res;
  }

  // POST /__test/boards/:id/force-compaction
  const compactionMatch = url.pathname.match(/^\/__test\/boards\/([^/]+)\/force-compaction$/);
  if (compactionMatch && request.method === 'POST') {
    const boardId = compactionMatch[1];
    const doId = env.BOARD_ROOM.idFromName(boardId);
    const stub = env.BOARD_ROOM.get(doId);
    const res = await stub.fetch(new Request('http://internal/__test/force-compaction', {
      method: 'POST',
    }));
    return res;
  }

  return null;
}
