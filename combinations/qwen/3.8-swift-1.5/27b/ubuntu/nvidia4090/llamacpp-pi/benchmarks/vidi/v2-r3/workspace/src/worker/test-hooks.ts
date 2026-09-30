import { isValidBoardId } from '../shared/board-id';
import { handleCreateBoardRequest } from './create-board';

type EnvLike = { BOARD_ROOM: DurableObjectNamespace; TEST_HOOKS?: string };

/**
 * Test-only hooks (enabled with TEST_HOOKS=1 in the wrangler config).
 *
 * POST /__test/api/boards                 → create-board with a failing initialize (TC-12)
 * POST /__test/boards/:id/seed-legacy     → seed legacy data without created_at (TC-08, TC-31)
 * POST /__test/boards/:id/corrupt-snapshot → story 4 broken-board e2e
 * POST /__test/boards/:id/repair-snapshot  → story 4 broken-board e2e
 */
export async function handleTestHooks(
  req: Request,
  env: EnvLike,
): Promise<Response | null> {
  if (env.TEST_HOOKS !== '1') return null;

  const url = new URL(req.url);

  // TC-12: failing initialize() → 500 create_failed
  if (url.pathname === '/__test/api/boards' && req.method === 'POST') {
    return handleCreateBoardRequest(env as never, () =>
      Promise.reject(new Error('injected initialize failure')),
    );
  }

  // Story 4: corrupt / repair the board snapshot (broken-board e2e)
  const corruptMatch = url.pathname.match(/^\/__test\/boards\/([^/]+)\/corrupt-snapshot$/);
  if (corruptMatch && req.method === 'POST') {
    const id = env.BOARD_ROOM.idFromName(decodeURIComponent(corruptMatch[1]));
    const resp = await env.BOARD_ROOM.get(id).fetch(
      new Request('http://internal/__corrupt_snapshot', { method: 'POST' }),
    );
    return new Response(await resp.text(), {
      status: 200,
      headers: { 'Content-Type': 'text/plain' },
    });
  }
  const repairMatch = url.pathname.match(/^\/__test\/boards\/([^/]+)\/repair-snapshot$/);
  if (repairMatch && req.method === 'POST') {
    const id = env.BOARD_ROOM.idFromName(decodeURIComponent(repairMatch[1]));
    const resp = await env.BOARD_ROOM.get(id).fetch(
      new Request('http://internal/__repair_snapshot', { method: 'POST' }),
    );
    return new Response(await resp.text(), {
      status: 200,
      headers: { 'Content-Type': 'text/plain' },
    });
  }

  // TC-08 / TC-31: seed a legacy board (updates rows, no created_at)
  const seedMatch = url.pathname.match(/^\/__test\/boards\/([^/]+)\/seed-legacy$/);
  if (seedMatch && req.method === 'POST') {
    const boardId = decodeURIComponent(seedMatch[1]);
    if (!isValidBoardId(boardId)) {
      return new Response('Bad board id', { status: 400 });
    }
    const id = env.BOARD_ROOM.idFromName(boardId);
    const stub = env.BOARD_ROOM.get(id) as DurableObjectStub;
    const resp = await stub.fetch(
      new Request('http://internal/__seed_legacy', { method: 'POST' }),
    );
    return new Response(await resp.text(), {
      status: 200,
      headers: { 'Content-Type': 'text/plain' },
    });
  }

  return null;
}
