import { isValidBoardId } from '../shared/board-id';
import type { Env } from './index';

// Test-only storage corruption/repair routes, registered only when
// env.TEST_HOOKS === '1' (never set in production config). Used by the
// "Broken board" e2e workflow (TC-24):
//   POST /__test/boards/:id/compact           force snapshot compaction
//   POST /__test/boards/:id/corrupt-snapshot  damage snapshot chunk 0
//   POST /__test/boards/:id/repair            restore the saved original
const HOOK_PATH = /^\/__test\/boards\/([^/]+)\/(compact|corrupt-snapshot|repair|rows)$/;

export async function handleTestHook(
  request: Request,
  env: Env,
  url: URL
): Promise<Response | null> {
  if (env.TEST_HOOKS !== '1') return null;
  const match = HOOK_PATH.exec(url.pathname);
  if (match === null) return null;
  if (request.method !== 'POST') {
    return new Response('Method not allowed\n', { status: 405 });
  }
  const boardId = match[1];
  if (!isValidBoardId(boardId)) {
    return new Response('Invalid board id\n', { status: 400 });
  }
  const stub = env.BOARD_ROOM.get(env.BOARD_ROOM.idFromName(boardId));
  switch (match[2]) {
    case 'compact':
      await stub.testCompact();
      break;
    case 'corrupt-snapshot':
      await stub.testCorruptSnapshot();
      break;
    case 'repair':
      await stub.testRepairSnapshot();
      break;
    case 'rows': {
      const rows = await stub.testRowCount();
      return Response.json(rows);
    }
  }
  return new Response('ok\n');
}
