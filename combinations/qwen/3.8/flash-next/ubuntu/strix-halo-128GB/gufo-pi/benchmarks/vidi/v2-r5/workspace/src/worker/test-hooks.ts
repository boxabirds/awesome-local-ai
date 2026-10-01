import type { Env } from './index';
import { isValidBoardId } from '../shared/board-id';

/**
 * Test-only routes. Only available when env.TEST_HOOKS === '1'.
 * These routes allow E2E tests to corrupt and repair board storage,
 * and seed legacy boards.
 */
export async function handleTestHook(
  request: Request,
  env: Env,
  url: URL,
): Promise<Response | null> {
  if (env.TEST_HOOKS !== '1') return null;

  const corruptMatch = url.pathname.match(/^\/__test\/boards\/([^/]+)\/corrupt-snapshot$/);
  if (corruptMatch && request.method === 'POST') {
    const boardId = corruptMatch[1]!;
    if (!isValidBoardId(boardId)) return new Response('Bad Request', { status: 400 });

    const docId = env.BOARD_ROOM.idFromName(boardId);
    const stub = env.BOARD_ROOM.get(docId);
    const res = await stub.fetch(new Request('https://internal/corrupt-snapshot', { method: 'POST' }));
    return res;
  }

  const repairMatch = url.pathname.match(/^\/__test\/boards\/([^/]+)\/repair$/);
  if (repairMatch && request.method === 'POST') {
    const boardId = repairMatch[1]!;
    if (!isValidBoardId(boardId)) return new Response('Bad Request', { status: 400 });

    const docId = env.BOARD_ROOM.idFromName(boardId);
    const stub = env.BOARD_ROOM.get(docId);
    const res = await stub.fetch(new Request('https://internal/repair', { method: 'POST' }));
    return res;
  }

  // Seed a legacy board: creates tables and writes updates without created_at
  const seedLegacyMatch = url.pathname.match(/^\/__test\/boards\/([^/]+)\/seed-legacy$/);
  if (seedLegacyMatch && request.method === 'POST') {
    const boardId = seedLegacyMatch[1]!;
    if (!isValidBoardId(boardId)) return new Response('Bad Request', { status: 400 });

    const body = await request.json() as { updates: string[] };
    const docId = env.BOARD_ROOM.idFromName(boardId);
    const stub = env.BOARD_ROOM.get(docId);
    const res = await stub.fetch(new Request('https://internal/seed-legacy', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }));
    return res;
  }

  // Initialize a board with a specific id (test-only, for e2e tests that pre-generate ids)
  const initMatch = url.pathname.match(/^\/__test\/boards\/([^/]+)\/initialize$/);
  if (initMatch && request.method === 'POST') {
    const boardId = initMatch[1]!;
    if (!isValidBoardId(boardId)) return new Response('Bad Request', { status: 400 });

    const docId = env.BOARD_ROOM.idFromName(boardId);
    const stub = env.BOARD_ROOM.get(docId);
    const result = await stub.initialize();
    return new Response(JSON.stringify({ result }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  // Force compaction on a board (test-only)
  const compactMatch = url.pathname.match(/^\/__test\/boards\/([^/]+)\/compact$/);
  if (compactMatch && request.method === 'POST') {
    const boardId = compactMatch[1]!;
    if (!isValidBoardId(boardId)) return new Response('Bad Request', { status: 400 });

    const docId = env.BOARD_ROOM.idFromName(boardId);
    const stub = env.BOARD_ROOM.get(docId);
    const res = await stub.fetch(new Request('https://internal/compact', { method: 'POST' }));
    return res;
  }

  // Reload the in-memory doc from storage (test-only, simulates DO eviction)
  const reloadMatch = url.pathname.match(/^\/__test\/boards\/([^/]+)\/reload$/);
  if (reloadMatch && request.method === 'POST') {
    const boardId = reloadMatch[1]!;
    if (!isValidBoardId(boardId)) return new Response('Bad Request', { status: 400 });

    const docId = env.BOARD_ROOM.idFromName(boardId);
    const stub = env.BOARD_ROOM.get(docId);
    const res = await stub.fetch(new Request('https://internal/reload', { method: 'POST' }));
    return res;
  }

  return null;
}
