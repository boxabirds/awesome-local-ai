import type { Env } from './index';
import { isValidBoardId } from '../shared/board-id';

/**
 * Test-only routes. Only available when env.TEST_HOOKS === '1'.
 * These routes allow E2E tests to corrupt and repair board storage.
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

  return null;
}
