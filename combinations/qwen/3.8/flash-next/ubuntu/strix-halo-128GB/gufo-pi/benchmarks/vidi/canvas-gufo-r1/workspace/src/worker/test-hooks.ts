import { isValidBoardId } from '../shared/board-id';
import type { BoardRoom } from './board-room';

/**
 * Test-only routes for corrupting and repairing board storage.
 * These are enabled only when `env.TEST_HOOKS === '1'` and must never be
 * available in production.
 */
export async function handleTestHook(
  request: Request,
  env: { BOARD_ROOM: DurableObjectNamespace<BoardRoom>; TEST_HOOKS?: string; localLimiter?: { reset(): void } },
): Promise<Response | null> {
  const url = new URL(request.url);
  if (!url.pathname.startsWith('/__test/')) return null;
  if (env.TEST_HOOKS !== '1') return null;

  if (!url.pathname.startsWith('/__test/boards/')) return null;

  // POST /__test/boards/:id/corrupt-snapshot
  // POST /__test/boards/:id/repair
  // POST /__test/boards/:id/seed-legacy
  const match = url.pathname.match(
    /^\/__test\/boards\/([A-Za-z0-9_-]{22})\/(corrupt-snapshot|repair|seed-legacy)$/,
  );
  if (!match) return new Response('Not found', { status: 404 });

  const boardId = match[1]!;
  const action = match[2]!;

  if (!isValidBoardId(boardId)) {
    return new Response('Bad Request', { status: 400 });
  }

  if (request.method !== 'POST') {
    return new Response('Method Not Allowed', { status: 405 });
  }

  const doId = env.BOARD_ROOM.idFromName(boardId);
  const stub = env.BOARD_ROOM.get(doId);

  // We use a POST to the DO's fetch with a special path to trigger storage manipulation.
  // The DO doesn't need to understand these paths - we use runInDurableObject pattern
  // by forwarding a special request.
  const hookRequest = new Request(`http://internal/__test/${action}`, {
    method: 'POST',
  });

  const response = await stub.fetch(hookRequest);
  return response;
}
