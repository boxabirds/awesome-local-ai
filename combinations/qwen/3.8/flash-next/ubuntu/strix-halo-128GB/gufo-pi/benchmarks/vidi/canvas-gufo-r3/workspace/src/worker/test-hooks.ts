/**
 * Test-only hooks for e2e persistence testing.
 * These routes are registered only when env.TEST_HOOKS === '1'.
 * They are NEVER available in production.
 */
import * as Y from 'yjs';
import type { Env } from './env';
import { chunkBytes } from './board-store-pure';
import { initDoc, createSticky } from '@shared/board-model';
import { resetFallbackLimiter } from './create-board';
import { newBoardId } from '@shared/board-id';

/**
 * Handle test-only routes under /api/test/.
 * Returns null if the path doesn't match a test route.
 */
export async function handleTestRoute(
  request: Request,
  env: Env,
  url: URL,
): Promise<Response | null> {
  const prefix = '/api/test/';
  if (!url.pathname.startsWith(prefix)) return null;

  const parts = url.pathname.slice(prefix.length).split('/');
  const boardId = parts[0];
  const action = parts[1];

  // Handle global actions (no board ID required)
  if (boardId === 'global' && action === 'reset-rate-limiter') {
    resetFallbackLimiter();
    return Response.json({ ok: true });
  }

  // Create a board without rate limiting (for test helpers)
  if (boardId === '_create' && action === 'init') {
    const id = newBoardId();
    const doId = env.BOARD_ROOM.idFromName(id);
    const stub = env.BOARD_ROOM.get(doId);
    await stub.initialize();
    return Response.json({ id });
  }

  if (!boardId || !action) return new Response('Bad test request', { status: 400 });

  const id = env.BOARD_ROOM.idFromName(boardId);
  const stub = env.BOARD_ROOM.get(id);

  switch (action) {
    case 'corrupt-snapshot':
      return stub.fetch(new Request('https://internal/test/corrupt-snapshot', {
        method: 'POST',
      }));

    case 'repair':
      return stub.fetch(new Request('https://internal/test/repair', {
        method: 'POST',
      }));

    case 'seed':
      return stub.fetch(new Request('https://internal/test/seed?notes=' + (url.searchParams.get('notes') || '25'), {
        method: 'POST',
      }));

    case 'seed-legacy':
      return stub.fetch(new Request('https://internal/test/seed-legacy?notes=' + (url.searchParams.get('notes') || '3'), {
        method: 'POST',
      }));

    default:
      return new Response('Unknown test action', { status: 404 });
  }
}
